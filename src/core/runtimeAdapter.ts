/**
 * AGENT Core Engine — Runtime Adapter Interface
 *
 * The coordinator communicates with the outside world exclusively
 * through this interface. The Core Engine never executes Windows
 * actions, model inference, or hardware access directly.
 *
 * The existing loopback RuntimeClient may be adapted behind this
 * interface. No functionality is duplicated.
 */

import type {
  ActionResult,
  ActionDispatchRequest,
  AuthorizationResult,
  CapabilityId,
  CapabilityRecord,
  CapabilityStatus,
  EvidenceSource,
  MissionId,
  MissionScope,
  ResourceInfo,
  VerificationResult,
} from './types';

// ---------------------------------------------------------------------------
// Runtime Adapter
// ---------------------------------------------------------------------------

export interface RuntimeAdapter {
  /** Returns whether the runtime is currently connected. */
  isConnected(): boolean;

  /** Returns the connection status string for diagnostics. */
  getConnectionStatus(): 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';

  /**
   * Queries the runtime for available capabilities.
   * Returns validated evidence records — never fabricated.
   */
  queryCapabilities(): Promise<CapabilityRecord[]>;

  /**
   * Requests authorization for a mission scope and planned actions.
   * This is the ONLY source of authorization. The planner cannot
   * authorize, and the frontend cannot authorize.
   */
  requestAuthorization(
    missionId: MissionId,
    scope: MissionScope,
    plannedCapabilities: readonly CapabilityId[],
  ): Promise<AuthorizationResult>;

  /**
   * Dispatches a single action to the runtime for execution.
   * Returns the actual result — never fabricated success.
   */
  dispatchAction(request: ActionDispatchRequest): Promise<ActionResult>;

  /**
   * Requests the runtime to verify that an action's effect occurred.
   * Returns evidence-backed verification — never assumed.
   */
  verifyAction(
    missionId: MissionId,
    action: ActionDispatchRequest,
    result: ActionResult,
  ): Promise<VerificationResult>;

  /**
   * Requests current resource information from the runtime.
   * Returns only what the runtime actually measured.
   */
  queryResources(): Promise<ResourceInfo>;

  /**
   * Notifies the runtime of mission start (for logging/diagnostics).
   */
  onMissionStart(missionId: MissionId): Promise<void>;

  /**
   * Notifies the runtime of mission completion (for logging/diagnostics).
   */
  onMissionComplete(missionId: MissionId): Promise<void>;

  /**
   * Requests cancellation of the current operation.
   * The runtime may or may not be able to stop the underlying operation.
   * Returns true if the runtime acknowledged cancellation.
   */
  requestCancellation(missionId: MissionId): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Null Runtime Adapter (default when no runtime is connected)
// ---------------------------------------------------------------------------

export class NullRuntimeAdapter implements RuntimeAdapter {
  isConnected(): boolean {
    return false;
  }

  getConnectionStatus(): 'DISCONNECTED' {
    return 'DISCONNECTED';
  }

  async queryCapabilities(): Promise<CapabilityRecord[]> {
    return [];
  }

  async requestAuthorization(
    _missionId: MissionId,
    _scope: MissionScope,
    _plannedCapabilities: readonly CapabilityId[],
  ): Promise<AuthorizationResult> {
    return {
      decision: 'UNKNOWN',
      reason: 'No runtime connected — cannot authorize',
      grantedBy: 'none',
      timestamp: Date.now(),
    };
  }

  async dispatchAction(_request: ActionDispatchRequest): Promise<ActionResult> {
    return {
      status: 'FAILURE',
      evidence: 'No runtime connected — action was not executed',
      timestamp: Date.now(),
      errorMessage: 'runtime_not_connected',
    };
  }

  async verifyAction(
    _missionId: MissionId,
    _action: ActionDispatchRequest,
    _result: ActionResult,
  ): Promise<VerificationResult> {
    return {
      status: 'UNVERIFIED',
      evidence: 'No runtime connected — cannot verify',
      timestamp: Date.now(),
    };
  }

  async queryResources(): Promise<ResourceInfo> {
    return {
      modelAvailable: null,
      modelLoadingState: 'unknown',
    };
  }

  async onMissionStart(_missionId: MissionId): Promise<void> {}

  async onMissionComplete(_missionId: MissionId): Promise<void> {}

  async requestCancellation(_missionId: MissionId): Promise<boolean> {
    return false;
  }
}
