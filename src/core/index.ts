/**
 * AGENT Core Engine — Barrel Export
 *
 * Public API surface for the Core Engine module.
 */

// Types
export type {
  MissionId,
  MissionRequest,
  MissionScope,
  ScopeLevel,
  MissionState,
  CapabilityId,
  CapabilityStatus,
  EvidenceSource,
  CapabilityRecord,
  PlannedAction,
  PlanningResult,
  PlannerAvailability,
  AuthorizationDecision,
  AuthorizationResult,
  ActionDispatchRequest,
  ActionResultStatus,
  ActionResult,
  VerificationStatus,
  VerificationResult,
  MissionOutcome,
  MissionReport,
  FailureReason,
  StructuredFailure,
  UnavailableReason,
  HumanControlSignal,
  EngineStatus,
  RuntimeConnectionStatus,
  ResourceInfo,
  ModelLoadingState,
  MissionHistoryEntry,
  MissionMemorySnapshot,
} from './types';

export { LIFECYCLE_PHASES, TERMINAL_STATES } from './types';

// Capability registry
export {
  CapabilityRegistry,
  getCapabilityRegistry,
} from './capabilityRegistry';

// Resource manager
export { ResourceManager, getResourceManager } from './resourceManager';

// Mission memory
export { MissionMemory, getMissionMemory } from './missionMemory';

// Runtime adapter
export type { RuntimeAdapter } from './runtimeAdapter';
export { NullRuntimeAdapter } from './runtimeAdapter';

// State machine
export { MissionStateMachine } from './missionStateMachine';

// Human control
export { HumanControlState } from './humanControl';

// Planner
export type { Planner } from './planner';
export { StubPlanner } from './planner';

// Coordinator
export type { CoordinatorConfig } from './coordinator';
export {
  CoreCoordinator,
  getCoordinator,
  setCoordinator,
} from './coordinator';
