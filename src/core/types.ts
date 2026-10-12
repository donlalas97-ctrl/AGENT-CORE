/**
 * AGENT Core Engine — Type Contracts
 *
 * All type definitions for the core orchestration engine.
 * These are contracts only — implementation behavior is provided
 * by the runtime adapter, planner, and coordinator modules.
 */

// ---------------------------------------------------------------------------
// Mission identification
// ---------------------------------------------------------------------------

export type MissionId = string;

export interface MissionRequest {
  readonly id: MissionId;
  readonly prompt: string;
  readonly scope: MissionScope;
  readonly createdAt: number;
  readonly maxActions: number;
  readonly maxDurationMs: number;
}

// ---------------------------------------------------------------------------
// Mission scope
// ---------------------------------------------------------------------------

export type ScopeLevel =
  | 'read_only'
  | 'local_app_control'
  | 'system_config'
  | 'unrestricted';

export interface MissionScope {
  readonly level: ScopeLevel;
  readonly allowedCapabilities: readonly CapabilityId[];
  readonly targetDescription: string;
}

// ---------------------------------------------------------------------------
// Mission lifecycle state
// ---------------------------------------------------------------------------

export type MissionState =
  | 'IDLE'
  | 'UNDERSTAND'
  | 'SCOPE_CHECK'
  | 'OBSERVE'
  | 'PLAN'
  | 'AUTHORIZATION_CHECK'
  | 'ACT'
  | 'VERIFY'
  | 'REPORT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Ordered lifecycle phases (terminal states excluded from transitions). */
export const LIFECYCLE_PHASES: readonly MissionState[] = [
  'IDLE',
  'UNDERSTAND',
  'SCOPE_CHECK',
  'OBSERVE',
  'PLAN',
  'AUTHORIZATION_CHECK',
  'ACT',
  'VERIFY',
  'REPORT',
  'COMPLETED',
] as const;

export const TERMINAL_STATES: readonly MissionState[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export type CapabilityId =
  | 'local_llm_inference'
  | 'mission_planning'
  | 'windows_app_control'
  | 'read_only_observation'
  | 'document_intelligence'
  | 'local_speech_recognition'
  | 'wake_word_detection'
  | 'text_to_speech'
  | 'owner_speaker_verification'
  | 'resource_aware_model_routing';

export type CapabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export type EvidenceSource =
  | 'runtime_probe'
  | 'runtime_handshake'
  | 'runtime_capability_query'
  | 'manual_override'
  | 'none';

export interface CapabilityRecord {
  readonly id: CapabilityId;
  readonly status: CapabilityStatus;
  readonly evidenceSource: EvidenceSource;
  readonly reason?: string;
  readonly requiresRuntime: boolean;
  readonly lastConfirmedAt?: number;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlannedAction {
  readonly id: string;
  readonly capability: CapabilityId;
  readonly description: string;
  readonly scope: ScopeLevel;
}

export interface PlanningResult {
  readonly actions: readonly PlannedAction[];
  readonly rationale: string;
  readonly requiresCapabilities: readonly CapabilityId[];
}

export interface PlannerAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export type AuthorizationDecision =
  | 'AUTHORIZED'
  | 'DENIED'
  | 'UNKNOWN';

export interface AuthorizationResult {
  readonly decision: AuthorizationDecision;
  readonly reason: string;
  readonly grantedBy: 'runtime' | 'planner' | 'frontend' | 'none';
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

export interface ActionDispatchRequest {
  readonly action: PlannedAction;
  readonly missionId: MissionId;
}

export type ActionResultStatus =
  | 'SUCCESS'
  | 'FAILURE'
  | 'UNKNOWN';

export interface ActionResult {
  readonly status: ActionResultStatus;
  readonly evidence: string;
  readonly timestamp: number;
  readonly errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerificationStatus =
  | 'VERIFIED'
  | 'UNVERIFIED'
  | 'FAILED';

export interface VerificationResult {
  readonly status: VerificationStatus;
  readonly evidence: string;
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Mission report
// ---------------------------------------------------------------------------

export type MissionOutcome =
  | 'SUCCESS'
  | 'FAILURE'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface MissionReport {
  readonly missionId: MissionId;
  readonly outcome: MissionOutcome;
  readonly state: MissionState;
  readonly verification: VerificationStatus;
  readonly actionsExecuted: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly summary: string;
  readonly failureReason?: string;
}

// ---------------------------------------------------------------------------
// Structured failure reasons
// ---------------------------------------------------------------------------

export type FailureReason =
  | 'capability_unavailable'
  | 'authorization_denied'
  | 'authorization_unknown'
  | 'planner_unavailable'
  | 'runtime_disconnected'
  | 'runtime_timeout'
  | 'runtime_malformed_response'
  | 'verification_failed'
  | 'action_limit_exceeded'
  | 'duration_limit_exceeded'
  | 'invalid_state_transition'
  | 'cancelled'
  | 'unknown_outcome';

export interface StructuredFailure {
  readonly reason: FailureReason;
  readonly detail: string;
  readonly atPhase: MissionState;
}

export type UnavailableReason =
  | 'not_connected_to_runtime'
  | 'runtime_does_not_support'
  | 'not_implemented'
  | 'hardware_unavailable'
  | 'model_not_loaded';

// ---------------------------------------------------------------------------
// Human control (precedence: STOP > TAKE_CONTROL > PAUSE)
// ---------------------------------------------------------------------------

export type HumanControlSignal =
  | 'STOP'
  | 'TAKE_CONTROL'
  | 'PAUSE'
  | 'RESUME'
  | 'NONE';

// ---------------------------------------------------------------------------
// Engine status
// ---------------------------------------------------------------------------

export type EngineStatus =
  | 'READY'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'RUNNING'
  | 'UNKNOWN';

export type RuntimeConnectionStatus =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Resource information (only populated by trusted runtime)
// ---------------------------------------------------------------------------

export interface ResourceInfo {
  readonly availableRamMB?: number;
  readonly cpuUtilizationPercent?: number;
  readonly modelAvailable: boolean | null;
  readonly modelId?: string;
  readonly modelLoadingState?: ModelLoadingState;
  readonly capabilityReadiness?: Partial<Record<CapabilityId, boolean>>;
}

export type ModelLoadingState =
  | 'not_loaded'
  | 'loading'
  | 'loaded'
  | 'error'
  | 'unknown';

// ---------------------------------------------------------------------------
// Mission memory
// ---------------------------------------------------------------------------

export interface MissionHistoryEntry {
  readonly missionId: MissionId;
  readonly outcome: MissionOutcome;
  readonly verification: VerificationStatus;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly actionCount: number;
  readonly failureReason?: FailureReason;
}

export interface MissionMemorySnapshot {
  readonly currentState: MissionState;
  readonly recentMissions: readonly MissionHistoryEntry[];
  readonly entryCount: number;
  readonly retentionLimit: number;
}
