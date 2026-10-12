# AGENT Core Engine

## Core Architecture

The AGENT Core Engine is a compact, modular, local-first AI orchestration engine built in TypeScript. It coordinates mission execution through a strict lifecycle while remaining independent of React components and UI rendering.

The engine is organized under `src/core/` with the following modules:

| Module | File | Responsibility |
|--------|------|----------------|
| Type Contracts | `types.ts` | All typed interfaces for missions, capabilities, authorization, actions, verification, reports, resources, and memory |
| Capability Registry | `capabilityRegistry.ts` | Typed registry of capability definitions and validated availability evidence |
| Resource Manager | `resourceManager.ts` | Lightweight resource-info contracts (RAM, CPU, model state) populated only by trusted runtime |
| Mission Memory | `missionMemory.ts` | Bounded in-memory mission state and history with retention limits |
| Runtime Adapter | `runtimeAdapter.ts` | Interface for all external communication; NullRuntimeAdapter default |
| State Machine | `missionStateMachine.ts` | Bounded mission lifecycle state machine with transition validation |
| Human Control | `humanControl.ts` | STOP > TAKE_CONTROL > PAUSE precedence signals |
| Planner | `planner.ts` | Planning interface and StubPlanner; cannot authorize execution |
| Coordinator | `coordinator.ts` | Single core coordinator driving the full mission lifecycle |
| Barrel Export | `index.ts` | Public API surface for the Core Engine module |

## Module Responsibilities

### Coordinator (`coordinator.ts`)
The `CoreCoordinator` is the single orchestration point. It:
- Drives the mission lifecycle from UNDERSTAND through REPORT.
- Delegates all external actions through the `RuntimeAdapter` interface.
- Never executes Windows actions, model inference, or hardware access directly.
- Enforces all safety boundaries (see below).
- Is independent of React — the frontend reads its status via accessor methods.

### Runtime Adapter (`runtimeAdapter.ts`)
The `RuntimeAdapter` interface is the sole boundary between the Core Engine and the outside world. The `NullRuntimeAdapter` is the default — it reports disconnected, returns UNKNOWN authorization, and refuses all actions. The existing loopback RuntimeClient can be adapted behind this interface without duplicating functionality.

### Capability Registry (`capabilityRegistry.ts`)
Holds static capability definitions (metadata) and dynamic availability records. Availability is populated ONLY from validated runtime evidence sources (`runtime_probe`, `runtime_handshake`, `runtime_capability_query`). A capability is never marked AVAILABLE because its UI page exists. `manual_override` can only set UNAVAILABLE or UNKNOWN.

### Planner (`planner.ts`)
Decomposes a mission prompt into a bounded sequence of actions. The planner CANNOT authorize execution — it only produces a plan. The `StubPlanner` is used when no local LLM is available.

### State Machine (`missionStateMachine.ts`)
Enforces the ordered lifecycle with a transition table. Invalid transitions throw. Cancellation is allowed from any non-terminal state. Reset is allowed only from terminal states.

### Human Control (`humanControl.ts`)
Preserves the STOP > TAKE_CONTROL > PAUSE precedence. These signals always override autonomous execution.

### Resource Manager (`resourceManager.ts`)
Holds resource info contracts. All fields default to UNKNOWN/undefined. Data is populated only when a trusted runtime supplies it. No hardware measurements are fabricated.

### Mission Memory (`missionMemory.ts`)
Bounded in-memory history with a configurable retention limit (default: 50 entries). Does NOT persist secrets, tokens, raw audio, biometric templates, or unrestricted conversation history. Does NOT claim durable persistence.

## Mission Lifecycle

The mission lifecycle follows this ordered sequence:

```
UNDERSTAND → SCOPE_CHECK → OBSERVE → PLAN → AUTHORIZATION_CHECK → ACT → VERIFY → REPORT → COMPLETED
```

Terminal states: `COMPLETED`, `FAILED`, `CANCELLED`.

Each phase:
1. **UNDERSTAND** — Mission request received and acknowledged.
2. **SCOPE_CHECK** — Validates that requested capabilities are known to the registry.
3. **OBSERVE** — Queries the runtime for current capability availability.
4. **PLAN** — The planner decomposes the prompt into actions. Fails if required capabilities are unavailable or the planner is not available.
5. **AUTHORIZATION_CHECK** — Requests authorization from the runtime. Fails closed on DENIED, UNKNOWN, or non-runtime authorization sources.
6. **ACT** — Dispatches each action through the runtime adapter. Per-action capability gates are checked. Each action is followed by verification.
7. **VERIFY** — All actions must be verified by the runtime before reporting success.
8. **REPORT** — Produces a structured mission report with outcome, verification status, and execution metadata.
9. **COMPLETED** — Terminal success state.

## Safety and Authorization Boundaries

### Authorization
- **Only the runtime can authorize.** The planner cannot authorize, and the frontend cannot authorize.
- The coordinator checks `grantedBy === 'runtime'` and rejects authorization from `planner`, `frontend`, or `none`.
- A missing or uncertain authorization decision (`UNKNOWN`) fails closed.
- A denied authorization (`DENIED`) fails immediately.
- Frontend button state is never interpreted as backend authorization.

### Execution Safety
- No plan is executed until authorization is confirmed by the trusted runtime.
- Per-action capability gates are checked before each dispatch.
- Runtime timeouts, disconnections, and malformed responses are treated as explicit failures.
- Unknown action outcomes are treated as failures, not successes.
- No automatic retry of mutating operations.
- Action count and mission duration are bounded by the mission request.

### Verification
- Success is never reported without runtime verification evidence.
- `UNVERIFIED` verification status prevents success reporting (fail closed).
- `FAILED` verification status causes immediate mission failure.

### Cancellation
- Cancellation is supported from any non-terminal state.
- Cancellation does not falsely claim the underlying runtime operation has stopped.
- The runtime's `requestCancellation` return value indicates whether it acknowledged the cancellation.

### Human Control
- STOP > TAKE_CONTROL > PAUSE precedence is preserved.
- An active STOP or TAKE_CONTROL signal halts mission execution immediately.
- These signals are checked at every lifecycle phase advance.

## Capability Registry

### Defined Capabilities
| ID | Label | Requires Runtime | Default Status |
|----|-------|-----------------|----------------|
| `local_llm_inference` | Local LLM Inference | Yes | UNKNOWN |
| `mission_planning` | Mission Planning | No | UNKNOWN |
| `windows_app_control` | Windows Application Control | Yes | UNAVAILABLE |
| `read_only_observation` | Read-Only Observation | Yes | UNKNOWN |
| `document_intelligence` | Document Intelligence | Yes | UNKNOWN |
| `local_speech_recognition` | Local Speech Recognition | Yes | UNAVAILABLE |
| `wake_word_detection` | Wake-Word Detection | Yes | UNAVAILABLE |
| `text_to_speech` | Text-to-Speech | Yes | UNAVAILABLE |
| `owner_speaker_verification` | Owner Speaker Verification | Yes | UNAVAILABLE |
| `resource_aware_model_routing` | Resource-Aware Model Routing | Yes | UNKNOWN |

These are capability definitions, not claims that implementations exist. Availability is populated only from validated runtime evidence.

### Evidence Sources
| Source | Can mark AVAILABLE | Trusted |
|--------|-------------------|---------|
| `runtime_probe` | Yes | Yes |
| `runtime_handshake` | Yes | Yes |
| `runtime_capability_query` | Yes | Yes |
| `manual_override` | No (only UNAVAILABLE/UNKNOWN) | No |
| `none` | No | No |

## Resource-Management Design

The `ResourceManager` holds a `ResourceInfo` contract with:
- `availableRamMB` — optional, only when runtime reports it
- `cpuUtilizationPercent` — optional, only when runtime reports it
- `modelAvailable` — `true`, `false`, or `null` (unknown)
- `modelId` — optional model identifier
- `modelLoadingState` — `not_loaded`, `loading`, `loaded`, `error`, `unknown`
- `capabilityReadiness` — optional per-capability readiness map

When no runtime is connected, all fields are UNKNOWN/undefined. The engine is designed to request capabilities only when needed and does not assume AI components run continuously.

Conservative selection logic: `isCapabilityReady()` returns `true` only when the capability is explicitly marked ready in `capabilityReadiness` — it returns `false` (not throws) when data is absent.

## Mission-Memory Limits

- **Retention limit**: Default 50 entries. Configurable per instance.
- When the limit is exceeded, oldest entries are dropped.
- **Not persisted**: Memory is in-memory only. No durable persistence is claimed.
- **Does not store**: Secrets, authentication tokens, raw audio, biometric templates, or unrestricted conversation history.
- **Does not use**: Vector databases, external database dependencies, or cloud storage.

## Current Implemented Functionality

### Genuinely Functional
- Full mission lifecycle state machine with valid/invalid transition enforcement
- Capability registry with evidence-source validation
- Resource manager contracts with unknown-by-default fields
- Bounded mission memory with retention limits
- Human control signal precedence (STOP > TAKE_CONTROL > PAUSE)
- Core coordinator with all safety boundaries enforced
- Runtime adapter interface with NullRuntimeAdapter default
- Planner interface with StubPlanner
- Frontend status panel showing engine, runtime, mission, capability, resource, and verification states
- 83 unit tests covering all safety boundaries and edge cases
- Clear UI distinction between: frontend loaded, engine initialized, runtime connected, local AI available, mission authorized, mission verified

### Not Functional (Requires Windows Python Runtime)
- Actual local LLM inference
- Actual Windows application control
- Actual read-only screen/system observation
- Actual document intelligence processing
- Actual local speech recognition
- Actual wake-word detection
- Actual text-to-speech synthesis
- Actual owner speaker verification
- Actual resource measurements (RAM, CPU)
- Actual model loading and management
- Durable mission history persistence
- Runtime authorization of real operations
- Runtime verification of real action effects

## Known Limitations

1. **No runtime connected**: The default coordinator uses `NullRuntimeAdapter`, so all missions fail at authorization. This is correct behavior — the engine fails closed when no trusted runtime is available.
2. **Stub planner only**: The `StubPlanner` produces simple plans from available capabilities. A real planner requires local LLM inference, which depends on the Windows Python runtime.
3. **No durable persistence**: Mission history is in-memory only and is lost on page reload.
4. **No real capabilities**: All capabilities default to UNKNOWN or UNAVAILABLE. No runtime evidence has been supplied.
5. **No real authorization**: The `NullRuntimeAdapter` returns UNKNOWN for all authorization requests, causing fail-closed behavior.
6. **No real verification**: The `NullRuntimeAdapter` returns UNVERIFIED for all verification requests, preventing false success reporting.

## Next Integration Milestone

**Implement a WebSocket-based runtime adapter** that connects to the Windows Python AGENT runtime. This adapter would:
1. Establish a WebSocket connection to the local Python runtime.
2. Map `queryCapabilities()` to the runtime's capability probe endpoint.
3. Map `requestAuthorization()` to the runtime's authorization endpoint.
4. Map `dispatchAction()` to the runtime's action execution endpoint.
5. Map `verifyAction()` to the runtime's verification endpoint.
6. Map `queryResources()` to the runtime's resource reporting endpoint.
7. Handle connection loss, timeouts, and malformed responses as explicit failures.

This is the single highest-value next step because it unlocks real capability discovery, real authorization, real action execution, and real verification — transforming the Core Engine from a fail-closed foundation into an operational orchestration layer.
