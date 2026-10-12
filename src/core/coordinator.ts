/**
 * AGENT Core Engine — Coordinator
 *
 * The single core coordinator that drives the mission lifecycle:
 * UNDERSTAND → SCOPE_CHECK → OBSERVE → PLAN → AUTHORIZATION_CHECK
 * → ACT → VERIFY → REPORT → COMPLETED
 *
 * Safety boundaries enforced:
 * - Rejects invalid state transitions.
 * - Stops when required capabilities are unavailable.
 * - Never executes a plan without runtime authorization.
 * - Never allows planner output to authorize execution.
 * - Never interprets frontend button state as authorization.
 * - Preserves STOP > TAKE_CONTROL > PAUSE precedence.
 * - STOP and TAKE_CONTROL immediately revoke eligibility for new action dispatch.
 * - PAUSE prevents new action dispatch until safely resumed.
 * - Treats runtime timeouts, disconnections, malformed responses as failures.
 * - Never reports success without verification evidence.
 * - Does not auto-retry mutating operations.
 * - Bounds action count and mission duration.
 * - Supports cancellation without falsely claiming the operation stopped.
 * - Missing or uncertain authorization fails closed.
 * - One mission at a time — no concurrent execution.
 * - Stale results from a previous mission cannot overwrite the current mission's state.
 * - Pending async operations cannot silently regain execution authority after STOP or cancellation.
 */

import type {
  ActionDispatchRequest,
  ActionResult,
  AuthorizationResult,
  CapabilityId,
  CapabilityRecord,
  EngineStatus,
  HumanControlSignal,
  MissionId,
  MissionOutcome,
  MissionReport,
  MissionRequest,
  MissionState,
  PlanningResult,
  ResourceInfo,
  RuntimeConnectionStatus,
  StructuredFailure,
  VerificationResult,
  VerificationStatus,
} from './types';
import type { RuntimeAdapter } from './runtimeAdapter';
import type { Planner } from './planner';
import { CapabilityRegistry, getCapabilityRegistry } from './capabilityRegistry';
import { ResourceManager, getResourceManager } from './resourceManager';
import { MissionMemory, getMissionMemory } from './missionMemory';
import { MissionStateMachine } from './missionStateMachine';
import { HumanControlState } from './humanControl';
import { NullRuntimeAdapter } from './runtimeAdapter';
import { StubPlanner } from './planner';

// ---------------------------------------------------------------------------
// Coordinator Configuration
// ---------------------------------------------------------------------------

export interface CoordinatorConfig {
  readonly runtime: RuntimeAdapter;
  readonly planner: Planner;
  readonly capabilityRegistry: CapabilityRegistry;
  readonly resourceManager: ResourceManager;
  readonly missionMemory: MissionMemory;
  readonly humanControl: HumanControlState;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export class CoreCoordinator {
  private readonly runtime: RuntimeAdapter;
  private readonly planner: Planner;
  private readonly capabilities: CapabilityRegistry;
  private readonly resources: ResourceManager;
  private readonly memory: MissionMemory;
  private readonly humanControl: HumanControlState;
  private readonly stateMachine: MissionStateMachine = new MissionStateMachine();

  private currentMission: MissionRequest | null = null;
  private currentPlan: PlanningResult | null = null;
  private currentAuthorization: AuthorizationResult | null = null;
  private lastFailure: StructuredFailure | null = null;
  private lastReport: MissionReport | null = null;
  private lastVerification: VerificationResult | null = null;
  private actionsExecuted = 0;
  private missionStartedAt = 0;
  private cancelled = false;
  private activeMissionId: MissionId | null = null;

  constructor(config: CoordinatorConfig) {
    this.runtime = config.runtime;
    this.planner = config.planner;
    this.capabilities = config.capabilityRegistry;
    this.resources = config.resourceManager;
    this.memory = config.missionMemory;
    this.humanControl = config.humanControl;
  }

  // -------------------------------------------------------------------------
  // Engine status
  // -------------------------------------------------------------------------

  getEngineStatus(): EngineStatus {
    if (this.stateMachine.getState() === 'IDLE' && !this.runtime.isConnected()) {
      return 'BLOCKED';
    }
    if (this.stateMachine.isTerminal() && this.stateMachine.getState() === 'FAILED') {
      return 'DEGRADED';
    }
    if (!this.runtime.isConnected()) {
      return 'BLOCKED';
    }
    if (this.isRunning()) {
      return 'RUNNING';
    }
    if (this.stateMachine.getState() === 'IDLE' && this.runtime.isConnected()) {
      return 'READY';
    }
    return 'UNKNOWN';
  }

  getRuntimeConnectionStatus(): RuntimeConnectionStatus {
    return this.runtime.getConnectionStatus();
  }

  getMissionState(): MissionState {
    return this.stateMachine.getState();
  }

  isRunning(): boolean {
    const state = this.stateMachine.getState();
    return !this.stateMachine.isTerminal() && state !== 'IDLE';
  }

  // -------------------------------------------------------------------------
  // Availability checks
  // -------------------------------------------------------------------------

  isPlannerAvailable(): boolean {
    return this.planner.isAvailable();
  }

  isActionExecutionAvailable(): boolean {
    return (
      this.runtime.isConnected() &&
      this.capabilities.isAvailable('windows_app_control')
    );
  }

  getVerificationStatus(): VerificationStatus {
    if (!this.lastVerification) return 'UNVERIFIED';
    return this.lastVerification.status;
  }

  getResourceInfo(): ResourceInfo {
    return this.resources.getInfo();
  }

  getLastFailure(): StructuredFailure | null {
    return this.lastFailure;
  }

  getLastReport(): MissionReport | null {
    return this.lastReport;
  }

  getControlSignal(): HumanControlSignal {
    return this.humanControl.getSignal();
  }

  setControlSignal(signal: HumanControlSignal): void {
    this.humanControl.setSignal(signal);
  }

  // -------------------------------------------------------------------------
  // Mission execution
  // -------------------------------------------------------------------------

  /**
   * Executes a full mission lifecycle.
   * Returns a MissionReport upon reaching a terminal state.
   * Only one mission can execute at a time.
   */
  async executeMission(request: MissionRequest): Promise<MissionReport> {
    const missionId = request.id;

    // Concurrent mission guard — reject before mutating any state
    if (this.activeMissionId !== null) {
      return this.buildConcurrentRejectionReport(missionId);
    }

    this.resetForNewMission(request);
    this.missionStartedAt = Date.now();

    try {
      // UNDERSTAND
      if (this.isStale(missionId)) return this.buildStaleReport(missionId);
      this.advance('UNDERSTAND');

      // SCOPE_CHECK
      if (this.isStale(missionId)) return this.buildStaleReport(missionId);
      this.advance('SCOPE_CHECK');
      const scopeFailure = this.checkScope(request);
      if (scopeFailure) {
        return this.failMission(scopeFailure);
      }

      // OBSERVE — query capabilities from runtime
      if (this.isStale(missionId)) return this.buildStaleReport(missionId);
      this.advance('OBSERVE');
      await this.observeCapabilities();
      if (this.isStale(missionId)) return this.buildStaleReport(missionId);

      // PLAN
      this.advance('PLAN');
      const planFailure = await this.planMission(request);
      if (this.isStale(missionId)) return this.buildStaleReport(missionId);
      if (planFailure) {
        return this.failMission(planFailure);
      }

      // AUTHORIZATION_CHECK
      this.advance('AUTHORIZATION_CHECK');
      const authFailure = await this.checkAuthorization(request);
      if (this.isStale(missionId)) return this.buildStaleReport(missionId);
      if (authFailure) {
        return this.failMission(authFailure);
      }

      // ACT + VERIFY loop
      this.advance('ACT');
      const actFailure = await this.executeActions(request);
      if (this.isStale(missionId)) return this.buildStaleReport(missionId);
      if (actFailure) {
        return this.failMission(actFailure);
      }

      // VERIFY (transition from ACT to VERIFY, then to REPORT)
      this.advance('VERIFY');
      if (this.isStale(missionId)) return this.buildStaleReport(missionId);
      // REPORT
      this.advance('REPORT');
      return this.completeMission(request);

    } catch (err) {
      if (this.isStale(missionId)) {
        return this.buildStaleReport(missionId);
      }
      return this.failMission({
        reason: 'invalid_state_transition',
        detail: err instanceof Error ? err.message : String(err),
        atPhase: this.stateMachine.getState(),
      });
    }
  }

  /** Requests cancellation. Does not claim the underlying operation stopped. */
  async cancelMission(): Promise<void> {
    this.cancelled = true;
    this.stateMachine.cancel();
    const missionId = this.currentMission?.id;
    if (missionId) {
      this.activeMissionId = null;
      await this.runtime.requestCancellation(missionId).catch(() => false);
      if (this.currentMission) {
        this.memory.recordCompletion('CANCELLED', 'UNVERIFIED', 'cancelled');
        await this.runtime.onMissionComplete(missionId).catch(() => {});
      }
      this.currentMission = null;
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle steps
  // -------------------------------------------------------------------------

  /**
   * Returns true if the mission with the given id is no longer the active mission.
   * This happens when cancellation or a new mission submission has replaced it.
   * Stale results are discarded — they cannot overwrite the current mission's state.
   */
  private isStale(missionId: MissionId): boolean {
    return this.activeMissionId !== missionId;
  }

  private staleFailure(): StructuredFailure {
    return {
      reason: 'cancelled',
      detail: 'Mission was cancelled or superseded — stale result discarded',
      atPhase: this.stateMachine.getState(),
    };
  }

  private buildStaleReport(missionId: MissionId): MissionReport {
    return {
      missionId,
      outcome: 'CANCELLED',
      state: 'CANCELLED',
      verification: 'UNVERIFIED',
      actionsExecuted: 0,
      startedAt: 0,
      completedAt: Date.now(),
      summary: 'Mission was cancelled — stale result discarded',
      failureReason: 'cancelled',
    };
  }

  private buildConcurrentRejectionReport(missionId: MissionId): MissionReport {
    return {
      missionId,
      outcome: 'FAILURE',
      state: this.stateMachine.getState(),
      verification: 'UNVERIFIED',
      actionsExecuted: 0,
      startedAt: 0,
      completedAt: Date.now(),
      summary: `Rejected: another mission (${this.activeMissionId}) is already active`,
      failureReason: 'invalid_state_transition',
    };
  }

  private resetForNewMission(request: MissionRequest): void {
    if (this.stateMachine.getState() !== 'IDLE') {
      if (this.stateMachine.isTerminal()) {
        this.stateMachine.reset();
      } else {
        throw new Error(
          `Cannot start mission in state ${this.stateMachine.getState()}`,
        );
      }
    }
    this.currentMission = request;
    this.activeMissionId = request.id;
    this.currentPlan = null;
    this.currentAuthorization = null;
    this.lastFailure = null;
    this.lastVerification = null;
    this.actionsExecuted = 0;
    this.cancelled = false;
    this.missionStartedAt = 0;
    this.memory.beginMission(request.id);
  }

  private advance(target: MissionState): void {
    this.checkHumanControl();
    this.checkLimits();
    this.stateMachine.transitionTo(target);
    this.memory.setState(target);
  }

  /**
   * Checks human control signals at phase boundaries and before each action.
   * STOP and TAKE_CONTROL halt execution.
   * PAUSE prevents new action dispatch until the operator resumes.
   */
  private checkHumanControl(): void {
    if (this.humanControl.isHalted()) {
      throw new Error(
        `Human control signal ${this.humanControl.getSignal()} — mission halted`,
      );
    }
    if (this.humanControl.isPaused()) {
      throw new Error(
        'Human control signal PAUSE — mission paused, cannot dispatch new actions',
      );
    }
  }

  private checkLimits(): void {
    if (this.currentMission && this.missionStartedAt > 0) {
      const elapsed = Date.now() - this.missionStartedAt;
      if (elapsed > this.currentMission.maxDurationMs) {
        throw new Error(
          `Mission duration limit exceeded: ${elapsed}ms > ${this.currentMission.maxDurationMs}ms`,
        );
      }
    }
  }

  private checkScope(request: MissionRequest): StructuredFailure | null {
    // Validate that requested capabilities are known
    for (const capId of request.scope.allowedCapabilities) {
      try {
        this.capabilities.get(capId);
      } catch {
        return {
          reason: 'capability_unavailable',
          detail: `Unknown capability requested: ${capId}`,
          atPhase: 'SCOPE_CHECK',
        };
      }
    }
    return null;
  }

  private async observeCapabilities(): Promise<void> {
    if (!this.runtime.isConnected()) {
      return; // capabilities remain UNKNOWN/UNAVAILABLE
    }
    try {
      const records = await this.runtime.queryCapabilities();
      for (const rec of records) {
        this.capabilities.update(
          rec.id,
          rec.status,
          rec.evidenceSource,
          rec.reason,
          rec.lastConfirmedAt,
        );
      }
    } catch {
      // Capability query failure leaves existing statuses in place
    }
  }

  private async planMission(request: MissionRequest): Promise<StructuredFailure | null> {
    if (!this.planner.isAvailable()) {
      return {
        reason: 'planner_unavailable',
        detail: this.planner.getUnavailableReason() ?? 'Planner is not available',
        atPhase: 'PLAN',
      };
    }

    // Check that required capabilities are available before planning
    const unavailable = this.capabilities.getUnavailable(
      request.scope.allowedCapabilities,
    );
    if (unavailable.length > 0) {
      const names = unavailable.map((r) => r.id).join(', ');
      return {
        reason: 'capability_unavailable',
        detail: `Required capabilities unavailable: ${names}`,
        atPhase: 'PLAN',
      };
    }

    try {
      const availableCaps = request.scope.allowedCapabilities.filter((c) =>
        this.capabilities.isAvailable(c),
      );
      this.currentPlan = await this.planner.plan(
        request.prompt,
        request.scope,
        availableCaps,
      );
    } catch (err) {
      return {
        reason: 'planner_unavailable',
        detail: err instanceof Error ? err.message : String(err),
        atPhase: 'PLAN',
      };
    }

    return null;
  }

  private async checkAuthorization(request: MissionRequest): Promise<StructuredFailure | null> {
    if (!this.currentPlan) {
      return {
        reason: 'authorization_unknown',
        detail: 'No plan to authorize',
        atPhase: 'AUTHORIZATION_CHECK',
      };
    }

    if (!this.runtime.isConnected()) {
      return {
        reason: 'runtime_disconnected',
        detail: 'Cannot authorize — no runtime connected',
        atPhase: 'AUTHORIZATION_CHECK',
      };
    }

    try {
      this.currentAuthorization = await this.runtime.requestAuthorization(
        request.id,
        request.scope,
        this.currentPlan.requiresCapabilities,
      );
    } catch {
      return {
        reason: 'runtime_disconnected',
        detail: 'Runtime request for authorization failed',
        atPhase: 'AUTHORIZATION_CHECK',
      };
    }

    // Fail closed on missing or uncertain authorization
    if (this.currentAuthorization.decision === 'DENIED') {
      return {
        reason: 'authorization_denied',
        detail: this.currentAuthorization.reason,
        atPhase: 'AUTHORIZATION_CHECK',
      };
    }

    if (this.currentAuthorization.decision === 'UNKNOWN') {
      return {
        reason: 'authorization_unknown',
        detail: this.currentAuthorization.reason,
        atPhase: 'AUTHORIZATION_CHECK',
      };
    }

    // Verify authorization came from the runtime, not the planner or frontend
    if (this.currentAuthorization.grantedBy !== 'runtime') {
      return {
        reason: 'authorization_denied',
        detail: `Authorization granted by ${this.currentAuthorization.grantedBy}, not runtime — rejected`,
        atPhase: 'AUTHORIZATION_CHECK',
      };
    }

    return null;
  }

  private async executeActions(request: MissionRequest): Promise<StructuredFailure | null> {
    if (!this.currentPlan) {
      return {
        reason: 'unknown_outcome',
        detail: 'No plan to execute',
        atPhase: 'ACT',
      };
    }

    for (const action of this.currentPlan.actions) {
      this.checkHumanControl();
      this.checkLimits();

      if (this.actionsExecuted >= request.maxActions) {
        return {
          reason: 'action_limit_exceeded',
          detail: `Action limit reached: ${request.maxActions}`,
          atPhase: 'ACT',
        };
      }

      // Per-action capability gate
      if (!this.capabilities.isAvailable(action.capability)) {
        return {
          reason: 'capability_unavailable',
          detail: `Capability ${action.capability} is not available for action ${action.id}`,
          atPhase: 'ACT',
        };
      }

      const dispatchReq: ActionDispatchRequest = {
        action,
        missionId: request.id,
      };

      let result: ActionResult;
      try {
        result = await this.runtime.dispatchAction(dispatchReq);
      } catch {
        return {
          reason: 'runtime_disconnected',
          detail: `Runtime dispatch failed for action ${action.id}`,
          atPhase: 'ACT',
        };
      }

      // Stale guard: if the mission was cancelled or replaced during the await,
      // discard the result — it cannot regain execution authority
      if (this.isStale(request.id)) {
        return {
          reason: 'cancelled',
          detail: `Mission ${request.id} was cancelled or superseded during action ${action.id} — result discarded`,
          atPhase: 'ACT',
        };
      }

      // Treat unknown outcomes as failures
      if (result.status === 'FAILURE') {
        return {
          reason: 'unknown_outcome',
          detail: result.errorMessage ?? `Action ${action.id} failed`,
          atPhase: 'ACT',
        };
      }

      if (result.status === 'UNKNOWN') {
        return {
          reason: 'unknown_outcome',
          detail: `Action ${action.id} returned UNKNOWN status — treating as failure`,
          atPhase: 'ACT',
        };
      }

      this.actionsExecuted++;
      this.memory.incrementActionCount();

      // VERIFY each action
      let verification: VerificationResult;
      try {
        verification = await this.runtime.verifyAction(
          request.id,
          dispatchReq,
          result,
        );
      } catch {
        return {
          reason: 'verification_failed',
          detail: `Verification request failed for action ${action.id}`,
          atPhase: 'ACT',
        };
      }

      // Stale guard after verification await
      if (this.isStale(request.id)) {
        return {
          reason: 'cancelled',
          detail: `Mission ${request.id} was cancelled or superseded during verification of action ${action.id} — result discarded`,
          atPhase: 'ACT',
        };
      }

      this.lastVerification = verification;

      if (verification.status === 'FAILED') {
        return {
          reason: 'verification_failed',
          detail: verification.evidence,
          atPhase: 'ACT',
        };
      }

      if (verification.status === 'UNVERIFIED') {
        // Cannot report success without verification — fail closed
        return {
          reason: 'verification_failed',
          detail: `Action ${action.id} could not be verified — refusing to report success`,
          atPhase: 'ACT',
        };
      }

      // VERIFIED with empty evidence is not sufficient — require non-empty evidence
      if (verification.status === 'VERIFIED' && !verification.evidence.trim()) {
        return {
          reason: 'verification_failed',
          detail: `Action ${action.id} reported VERIFIED but provided no evidence — refusing to report success`,
          atPhase: 'ACT',
        };
      }
    }

    return null;
  }

  private completeMission(request: MissionRequest): MissionReport {
    this.stateMachine.transitionTo('COMPLETED');
    this.memory.setState('COMPLETED');

    const report: MissionReport = {
      missionId: request.id,
      outcome: 'SUCCESS',
      state: 'COMPLETED',
      verification: this.lastVerification?.status ?? 'UNVERIFIED',
      actionsExecuted: this.actionsExecuted,
      startedAt: this.missionStartedAt,
      completedAt: Date.now(),
      summary: `Mission completed with ${this.actionsExecuted} action(s)`,
    };

    this.memory.recordCompletion('SUCCESS', report.verification);
    this.runtime.onMissionComplete(request.id).catch(() => {});
    this.lastReport = report;
    this.activeMissionId = null;
    this.currentMission = null;

    return report;
  }

  private failMission(failure: StructuredFailure): MissionReport {
    this.lastFailure = failure;
    if (!this.stateMachine.isTerminal()) {
      this.stateMachine.fail();
    }

    const outcome: MissionOutcome = this.cancelled ? 'CANCELLED' : 'FAILURE';
    const report: MissionReport = {
      missionId: this.currentMission?.id ?? 'unknown',
      outcome,
      state: this.stateMachine.getState(),
      verification: this.lastVerification?.status ?? 'UNVERIFIED',
      actionsExecuted: this.actionsExecuted,
      startedAt: this.missionStartedAt,
      completedAt: Date.now(),
      summary: `Mission failed at ${failure.atPhase}: ${failure.reason}`,
      failureReason: failure.reason,
    };

    // Only record in memory if this mission is still the active one
    // (a stale mission's failure should not overwrite a new mission's history)
    if (this.activeMissionId === this.currentMission?.id) {
      this.memory.recordCompletion(outcome, report.verification, failure.reason);
      if (this.currentMission) {
        this.runtime.onMissionComplete(this.currentMission.id).catch(() => {});
      }
    }
    this.lastReport = report;
    this.activeMissionId = null;
    this.currentMission = null;

    return report;
  }
}

// ---------------------------------------------------------------------------
// Singleton coordinator (default with null runtime and stub planner)
// ---------------------------------------------------------------------------

let _coordinator: CoreCoordinator | null = null;

export function getCoordinator(): CoreCoordinator {
  if (!_coordinator) {
    _coordinator = new CoreCoordinator({
      runtime: new NullRuntimeAdapter(),
      planner: new StubPlanner(false),
      capabilityRegistry: getCapabilityRegistry(),
      resourceManager: getResourceManager(),
      missionMemory: getMissionMemory(),
      humanControl: new HumanControlState(),
    });
  }
  return _coordinator;
}

export function setCoordinator(coordinator: CoreCoordinator): void {
  _coordinator = coordinator;
}
