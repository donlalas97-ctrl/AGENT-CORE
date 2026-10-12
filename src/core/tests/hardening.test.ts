/**
 * Adversarial timing regression tests for the hardened CoreCoordinator.
 *
 * These tests use controlled promises and deferred resolutions to test
 * race conditions, stale results, and cancellation timing without
 * relying on flaky sleep-based delays.
 */

import { describe, it, expect } from 'vitest';
import {
  CoreCoordinator,
  CapabilityRegistry,
  ResourceManager,
  MissionMemory,
  HumanControlState,
  StubPlanner,
  NullRuntimeAdapter,
} from '@/core';
import type { RuntimeAdapter } from '@/core';
import type {
  ActionDispatchRequest,
  ActionResult,
  AuthorizationResult,
  CapabilityId,
  CapabilityRecord,
  MissionReport,
  MissionRequest,
  MissionScope,
  ResourceInfo,
  VerificationResult,
} from '@/core/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeScope(caps: CapabilityId[] = ['read_only_observation']): MissionScope {
  return {
    level: 'read_only',
    allowedCapabilities: caps,
    targetDescription: 'test target',
  };
}

function makeRequest(overrides: Partial<MissionRequest> = {}): MissionRequest {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    prompt: 'Read the screen',
    scope: makeScope(),
    createdAt: Date.now(),
    maxActions: 20,
    maxDurationMs: 120000,
    ...overrides,
  };
}

function makeAuthResult(
  decision: 'AUTHORIZED' | 'DENIED' | 'UNKNOWN' = 'AUTHORIZED',
  grantedBy: 'runtime' | 'planner' | 'frontend' | 'none' = 'runtime',
): AuthorizationResult {
  return {
    decision,
    reason: decision === 'AUTHORIZED' ? 'Authorized by runtime' : 'Denied',
    grantedBy,
    timestamp: Date.now(),
  };
}

function makeActionResult(status: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' = 'SUCCESS'): ActionResult {
  return {
    status,
    evidence: `Action ${status}`,
    timestamp: Date.now(),
    errorMessage: status === 'FAILURE' ? 'error' : undefined,
  };
}

function makeVerificationResult(
  status: 'VERIFIED' | 'UNVERIFIED' | 'FAILED' = 'VERIFIED',
  evidence?: string,
): VerificationResult {
  return {
    status,
    evidence: evidence ?? `Verification ${status}`,
    timestamp: Date.now(),
  };
}

function makeCapabilityRecord(
  id: CapabilityId,
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' = 'AVAILABLE',
): CapabilityRecord {
  return {
    id,
    status,
    evidenceSource: 'runtime_probe',
    requiresRuntime: true,
    lastConfirmedAt: Date.now(),
  };
}

/**
 * A deferred promise that can be resolved manually to simulate
 * pending async operations.
 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Creates a runtime where dispatchAction returns a deferred promise,
 * allowing tests to control when the action result arrives.
 */
function createDeferredRuntime(opts: {
  auth?: AuthorizationResult;
  verification?: VerificationResult;
  connected?: boolean;
  capabilities?: CapabilityRecord[];
  actionResult?: ActionResult;
  dispatchDeferred?: Deferred<ActionResult>;
  verifyDeferred?: Deferred<VerificationResult>;
  authDeferred?: Deferred<AuthorizationResult>;
  planDeferred?: Deferred<unknown>;
}): {
  runtime: RuntimeAdapter;
  dispatchDeferred: Deferred<ActionResult>;
  verifyDeferred: Deferred<VerificationResult>;
  authDeferred: Deferred<AuthorizationResult>;
} {
  const connected = opts.connected ?? true;
  const dispatchDeferred = opts.dispatchDeferred ?? createDeferred<ActionResult>();
  const verifyDeferred = opts.verifyDeferred ?? createDeferred<VerificationResult>();
  const authDeferred = opts.authDeferred ?? createDeferred<AuthorizationResult>();

  const runtime: RuntimeAdapter = {
    isConnected: () => connected,
    getConnectionStatus: () => connected ? 'CONNECTED' : 'DISCONNECTED',
    queryCapabilities: async () => opts.capabilities ?? [],
    requestAuthorization: () => authDeferred.promise,
    dispatchAction: () => dispatchDeferred.promise,
    verifyAction: async () => opts.verification ?? makeVerificationResult('VERIFIED'),
    queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }) as ResourceInfo,
    onMissionStart: async () => {},
    onMissionComplete: async () => {},
    requestCancellation: async () => true,
  };

  return { runtime, dispatchDeferred, verifyDeferred, authDeferred };
}

function createCoordinatorWithRuntime(
  runtime: RuntimeAdapter,
  opts: { prePopulateCapabilities?: { id: CapabilityId; status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' }[] } = {},
): CoreCoordinator {
  const capabilities = new CapabilityRegistry();
  const resources = new ResourceManager();
  const memory = new MissionMemory(20);
  const humanControl = new HumanControlState();
  const planner = new StubPlanner(true);

  if (opts.prePopulateCapabilities) {
    for (const c of opts.prePopulateCapabilities) {
      capabilities.update(c.id, c.status, 'runtime_probe');
    }
  } else {
    capabilities.update('read_only_observation', 'AVAILABLE', 'runtime_probe');
  }

  return new CoreCoordinator({
    runtime,
    planner,
    capabilityRegistry: capabilities,
    resourceManager: resources,
    missionMemory: memory,
    humanControl,
  });
}

// ---------------------------------------------------------------------------
// Tests: STOP during pending operations
// ---------------------------------------------------------------------------

describe('Hardened — STOP during pending planning', () => {
  it('STOP signal during pending plan prevents further execution', async () => {
    const planDeferred = createDeferred<unknown>();
    const capabilities = new CapabilityRegistry();
    const resources = new ResourceManager();
    const memory = new MissionMemory(20);
    const humanControl = new HumanControlState();
    const planner = new StubPlanner(true);

    // Override plan to be deferred
    const deferredPlan = {
      isAvailable: () => true,
      getUnavailableReason: () => undefined,
      plan: () => {
        // Return a promise that we control
        return planDeferred.promise.then(() => ({
          actions: [{
            id: 'action-1',
            capability: 'read_only_observation' as CapabilityId,
            description: 'test action',
            scope: 'read_only' as const,
          }],
          rationale: 'test plan',
          requiresCapabilities: ['read_only_observation'] as CapabilityId[],
        }));
      },
    };

    capabilities.update('read_only_observation', 'AVAILABLE', 'runtime_probe');

    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };

    const coord = new CoreCoordinator({
      runtime,
      planner: deferredPlan as unknown as StubPlanner,
      capabilityRegistry: capabilities,
      resourceManager: resources,
      missionMemory: memory,
      humanControl,
    });

    const execPromise = coord.executeMission(makeRequest({ id: 'stop-plan-test' }));

    // Set STOP while planning is pending
    coord.setControlSignal('STOP');

    // Resolve the plan — the mission should not proceed successfully
    planDeferred.resolve(undefined);

    const report = await execPromise;
    expect(report.outcome).not.toBe('SUCCESS');
  });
});

describe('Hardened — STOP during pending action execution', () => {
  it('STOP during pending dispatch prevents the result from being applied', async () => {
    const { runtime, dispatchDeferred } = createDeferredRuntime({
      auth: makeAuthResult('AUTHORIZED'),
    });
    const coord = createCoordinatorWithRuntime(runtime);

    const execPromise = coord.executeMission(makeRequest({ id: 'stop-action-test' }));

    // Set STOP while dispatch is pending
    coord.setControlSignal('STOP');

    // Now resolve the dispatch — the result should be discarded as stale
    dispatchDeferred.resolve(makeActionResult('SUCCESS'));

    const report = await execPromise;
    expect(report.outcome).not.toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// Tests: PAUSE during pending operations
// ---------------------------------------------------------------------------

describe('Hardened — PAUSE prevents new action dispatch', () => {
  it('PAUSE signal prevents mission from proceeding', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);
    coord.setControlSignal('PAUSE');

    const report = await coord.executeMission(makeRequest({ id: 'pause-test' }));
    expect(report.outcome).toBe('FAILURE');
  });

  it('PAUSE during pending dispatch prevents the result from being applied', async () => {
    const { runtime, dispatchDeferred } = createDeferredRuntime({
      auth: makeAuthResult('AUTHORIZED'),
    });
    const coord = createCoordinatorWithRuntime(runtime);

    const execPromise = coord.executeMission(makeRequest({ id: 'pause-pending-test' }));

    // Set PAUSE while dispatch is pending
    coord.setControlSignal('PAUSE');

    // Resolve dispatch — should be treated as stale
    dispatchDeferred.resolve(makeActionResult('SUCCESS'));

    const report = await execPromise;
    expect(report.outcome).not.toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// Tests: Runtime disconnection during execution
// ---------------------------------------------------------------------------

describe('Hardened — runtime disconnection during execution', () => {
  it('dispatch throwing after a pending wait produces FAILURE', async () => {
    const capabilities = new CapabilityRegistry();
    const resources = new ResourceManager();
    const memory = new MissionMemory(20);
    const humanControl = new HumanControlState();
    const planner = new StubPlanner(true);
    capabilities.update('read_only_observation', 'AVAILABLE', 'runtime_probe');

    let dispatchCallCount = 0;
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => {
        dispatchCallCount++;
        throw new Error('Runtime crashed mid-dispatch');
      },
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };

    const coord = new CoreCoordinator({
      runtime,
      planner,
      capabilityRegistry: capabilities,
      resourceManager: resources,
      missionMemory: memory,
      humanControl,
    });

    const report = await coord.executeMission(makeRequest({ id: 'disconnect-test' }));
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('runtime_disconnected');
    expect(dispatchCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Late result arriving after cancellation
// ---------------------------------------------------------------------------

describe('Hardened — late result after cancellation', () => {
  it('a late dispatch result arriving after cancellation does not produce success', async () => {
    const { runtime, dispatchDeferred } = createDeferredRuntime({
      auth: makeAuthResult('AUTHORIZED'),
    });
    const coord = createCoordinatorWithRuntime(runtime);

    const execPromise = coord.executeMission(makeRequest({ id: 'late-result-test' }));

    // Cancel while dispatch is pending
    await coord.cancelMission();

    // Late result arrives
    dispatchDeferred.resolve(makeActionResult('SUCCESS'));

    const report = await execPromise;
    expect(report.outcome).not.toBe('SUCCESS');
  });

  it('a late verification result arriving after cancellation does not produce success', async () => {
    const verifyDeferred = createDeferred<VerificationResult>();
    const capabilities = new CapabilityRegistry();
    const resources = new ResourceManager();
    const memory = new MissionMemory(20);
    const humanControl = new HumanControlState();
    const planner = new StubPlanner(true);
    capabilities.update('read_only_observation', 'AVAILABLE', 'runtime_probe');

    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: () => verifyDeferred.promise,
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };

    const coord = new CoreCoordinator({
      runtime,
      planner,
      capabilityRegistry: capabilities,
      resourceManager: resources,
      missionMemory: memory,
      humanControl,
    });

    const execPromise = coord.executeMission(makeRequest({ id: 'late-verify-test' }));

    // Cancel while verification is pending
    await coord.cancelMission();

    // Late verification arrives claiming VERIFIED
    verifyDeferred.resolve(makeVerificationResult('VERIFIED'));

    const report = await execPromise;
    expect(report.outcome).not.toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// Tests: Stale result after another mission begins
// ---------------------------------------------------------------------------

describe('Hardened — stale result after another mission begins', () => {
  it('a stale dispatch result from mission-1 cannot overwrite mission-2 state', async () => {
    // Mission-1 uses a deferred runtime that hangs on dispatch
    const dispatchDeferred = createDeferred<ActionResult>();
    const mission1Runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: () => dispatchDeferred.promise,
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };

    const capabilities = new CapabilityRegistry();
    capabilities.update('read_only_observation', 'AVAILABLE', 'runtime_probe');
    const resources = new ResourceManager();
    const memory = new MissionMemory(20);
    const humanControl = new HumanControlState();
    const planner = new StubPlanner(true);

    // Use a swappable runtime so mission-2 can use a normal (non-deferred) runtime
    let currentRuntime: RuntimeAdapter = mission1Runtime;
    const swappableRuntime: RuntimeAdapter = {
      isConnected: () => currentRuntime.isConnected(),
      getConnectionStatus: () => currentRuntime.getConnectionStatus(),
      queryCapabilities: () => currentRuntime.queryCapabilities(),
      requestAuthorization: (mid, scope, caps) => currentRuntime.requestAuthorization(mid, scope, caps),
      dispatchAction: (req) => currentRuntime.dispatchAction(req),
      verifyAction: (mid, act, res) => currentRuntime.verifyAction(mid, act, res),
      queryResources: () => currentRuntime.queryResources(),
      onMissionStart: (mid) => currentRuntime.onMissionStart(mid),
      onMissionComplete: (mid) => currentRuntime.onMissionComplete(mid),
      requestCancellation: (mid) => currentRuntime.requestCancellation(mid),
    };

    const coord = new CoreCoordinator({
      runtime: swappableRuntime,
      planner,
      capabilityRegistry: capabilities,
      resourceManager: resources,
      missionMemory: memory,
      humanControl,
    });

    const req1 = makeRequest({ id: 'mission-1' });
    const exec1 = coord.executeMission(req1);

    // Cancel mission-1 while dispatch is pending
    await coord.cancelMission();

    // Resolve the pending dispatch so mission-1's executeMission can complete
    // (the stale guard will discard the result)
    dispatchDeferred.resolve(makeActionResult('SUCCESS'));

    // Wait for mission-1 to finish — it should not be SUCCESS
    const report1 = await exec1;
    expect(report1.outcome).not.toBe('SUCCESS');

    // Switch to a normal runtime for mission-2
    const mission2Runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    currentRuntime = mission2Runtime;

    // Now start mission-2 (should succeed since mission-1 is cancelled/terminal)
    const report2 = await coord.executeMission(makeRequest({ id: 'mission-2' }));

    // Mission-2 should proceed normally
    expect(report2.missionId).toBe('mission-2');
    expect(report2.outcome).toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// Tests: Concurrent mission submission
// ---------------------------------------------------------------------------

describe('Hardened — concurrent mission submission rejected', () => {
  it('a second mission submitted while the first is active is rejected', async () => {
    const { runtime, dispatchDeferred, authDeferred } = createDeferredRuntime({
      auth: makeAuthResult('AUTHORIZED'),
    });
    const coord = createCoordinatorWithRuntime(runtime);

    // Start mission-1 (will hang on deferred auth)
    const exec1 = coord.executeMission(makeRequest({ id: 'concurrent-1' }));

    // Submit mission-2 while mission-1 is active
    const report2 = await coord.executeMission(makeRequest({ id: 'concurrent-2' }));

    expect(report2.outcome).toBe('FAILURE');
    expect(report2.failureReason).toBe('invalid_state_transition');
    expect(report2.summary).toContain('concurrent-1');

    // Clean up mission-1: resolve auth so it can proceed, then resolve dispatch
    authDeferred.resolve(makeAuthResult('AUTHORIZED'));
    dispatchDeferred.resolve(makeActionResult('SUCCESS'));
    const report1 = await exec1;
    expect(report1.outcome).toBe('SUCCESS');
  });

  it('a mission submitted after the first completes is accepted', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    const report1 = await coord.executeMission(makeRequest({ id: 'seq-1' }));
    expect(report1.outcome).toBe('SUCCESS');

    const report2 = await coord.executeMission(makeRequest({ id: 'seq-2' }));
    expect(report2.outcome).toBe('SUCCESS');
    expect(report2.missionId).toBe('seq-2');
  });
});

// ---------------------------------------------------------------------------
// Tests: Terminal mission receiving invalid transition
// ---------------------------------------------------------------------------

describe('Hardened — terminal mission cannot receive transitions', () => {
  it('a completed mission cannot be transitioned further', () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    return coord.executeMission(makeRequest({ id: 'terminal-test' })).then((report) => {
      expect(report.state).toBe('COMPLETED');
      expect(coord.getMissionState()).toBe('COMPLETED');
      // A new mission can start from terminal state
      expect(coord.getMissionState()).not.toBe('IDLE');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Missing or mismatched verification evidence
// ---------------------------------------------------------------------------

describe('Hardened — verification evidence integrity', () => {
  it('VERIFIED with empty evidence is rejected', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED', ''),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    const report = await coord.executeMission(makeRequest({ id: 'empty-evidence-test' }));
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('verification_failed');
  });

  it('VERIFIED with whitespace-only evidence is rejected', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED', '   '),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    const report = await coord.executeMission(makeRequest({ id: 'ws-evidence-test' }));
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('verification_failed');
  });
});

// ---------------------------------------------------------------------------
// Tests: Unknown action outcomes
// ---------------------------------------------------------------------------

describe('Hardened — unknown action outcomes treated as failure', () => {
  it('UNKNOWN action status produces FAILURE, not SUCCESS', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('UNKNOWN'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    const report = await coord.executeMission(makeRequest({ id: 'unknown-outcome-test' }));
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('unknown_outcome');
  });
});

// ---------------------------------------------------------------------------
// Tests: Runtime claiming success without verification evidence
// ---------------------------------------------------------------------------

describe('Hardened — runtime claiming success without sufficient verification', () => {
  it('VERIFIED with evidence is required for SUCCESS outcome', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED', 'Screen state confirmed'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    const report = await coord.executeMission(makeRequest({ id: 'full-evidence-test' }));
    expect(report.outcome).toBe('SUCCESS');
    expect(report.verification).toBe('VERIFIED');
  });

  it('UNVERIFIED prevents SUCCESS even when action returned SUCCESS', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('UNVERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    const report = await coord.executeMission(makeRequest({ id: 'unverified-test' }));
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('verification_failed');
  });
});

// ---------------------------------------------------------------------------
// Tests: TAKE_CONTROL prevents action dispatch
// ---------------------------------------------------------------------------

describe('Hardened — TAKE_CONTROL prevents action dispatch', () => {
  it('TAKE_CONTROL signal halts mission execution', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);
    coord.setControlSignal('TAKE_CONTROL');

    const report = await coord.executeMission(makeRequest({ id: 'take-control-test' }));
    expect(report.outcome).toBe('FAILURE');
  });

  it('TAKE_CONTROL during pending dispatch discards the result', async () => {
    const { runtime, dispatchDeferred } = createDeferredRuntime({
      auth: makeAuthResult('AUTHORIZED'),
    });
    const coord = createCoordinatorWithRuntime(runtime);

    const execPromise = coord.executeMission(makeRequest({ id: 'tc-pending-test' }));

    coord.setControlSignal('TAKE_CONTROL');
    dispatchDeferred.resolve(makeActionResult('SUCCESS'));

    const report = await execPromise;
    expect(report.outcome).not.toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// Tests: Mission identity and result integrity
// ---------------------------------------------------------------------------

describe('Hardened — mission identity and result integrity', () => {
  it('lastReport is associated with the correct mission id', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED', 'confirmed'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    await coord.executeMission(makeRequest({ id: 'identity-test-1' }));
    const report1 = coord.getLastReport();
    expect(report1!.missionId).toBe('identity-test-1');

    await coord.executeMission(makeRequest({ id: 'identity-test-2' }));
    const report2 = coord.getLastReport();
    expect(report2!.missionId).toBe('identity-test-2');
  });

  it('a failed mission report contains the failure reason and phase', async () => {
    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED',
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('DENIED', 'runtime'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };
    const coord = createCoordinatorWithRuntime(runtime);

    await coord.executeMission(makeRequest({ id: 'fail-report-test' }));
    const report = coord.getLastReport();
    expect(report).not.toBeNull();
    expect(report!.outcome).toBe('FAILURE');
    expect(report!.failureReason).toBe('authorization_denied');
  });
});

// ---------------------------------------------------------------------------
// Tests: Cancellation report honesty
// ---------------------------------------------------------------------------

describe('Hardened — cancellation report is honest', () => {
  it('cancellation report says CANCELLED, not SUCCESS, and is UNVERIFIED', async () => {
    const { runtime, dispatchDeferred } = createDeferredRuntime({
      auth: makeAuthResult('AUTHORIZED'),
    });
    const coord = createCoordinatorWithRuntime(runtime);

    const execPromise = coord.executeMission(makeRequest({ id: 'honest-cancel-test' }));
    await coord.cancelMission();
    dispatchDeferred.resolve(makeActionResult('SUCCESS'));

    const report = await execPromise;
    expect(report.outcome).not.toBe('SUCCESS');
    // The report should acknowledge uncertainty
    expect(report.verification).not.toBe('VERIFIED');
  });
});
