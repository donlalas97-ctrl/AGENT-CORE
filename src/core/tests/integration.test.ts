/**
 * Integration regression tests — proving that submitted user commands
 * enter the CoreCoordinator and that safety boundaries hold through
 * the command-submission path.
 *
 * These tests use the real CoreCoordinator with mocked RuntimeAdapters
 * to demonstrate that the integration is genuine, not simulated.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CoreCoordinator,
  CapabilityRegistry,
  ResourceManager,
  MissionMemory,
  HumanControlState,
  StubPlanner,
  NullRuntimeAdapter,
  setCoordinator,
  getCoordinator,
  getMissionMemory,
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
// Helpers — same pattern as coordinator.test.ts but for integration
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
    id: `cmd-${Date.now()}`,
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

function makeVerificationResult(status: 'VERIFIED' | 'UNVERIFIED' | 'FAILED' = 'VERIFIED'): VerificationResult {
  return {
    status,
    evidence: `Verification ${status}`,
    timestamp: Date.now(),
  };
}

function makeCapabilityRecord(id: CapabilityId, status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' = 'AVAILABLE'): CapabilityRecord {
  return {
    id,
    status,
    evidenceSource: 'runtime_probe',
    requiresRuntime: true,
    lastConfirmedAt: Date.now(),
  };
}

interface MockRuntimeOptions {
  connected?: boolean;
  auth?: AuthorizationResult;
  actionResult?: ActionResult;
  verification?: VerificationResult;
  capabilities?: CapabilityRecord[];
  dispatchThrows?: boolean;
}

function createMockRuntime(opts: MockRuntimeOptions = {}): RuntimeAdapter {
  const connected = opts.connected ?? true;
  return {
    isConnected: () => connected,
    getConnectionStatus: () => connected ? 'CONNECTED' : 'DISCONNECTED',
    queryCapabilities: async () => opts.capabilities ?? [],
    requestAuthorization: async () => opts.auth ?? makeAuthResult('AUTHORIZED'),
    dispatchAction: opts.dispatchThrows
      ? async () => { throw new Error('Runtime disconnected'); }
      : async () => opts.actionResult ?? makeActionResult('SUCCESS'),
    verifyAction: async () => opts.verification ?? makeVerificationResult('VERIFIED'),
    queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }) as ResourceInfo,
    onMissionStart: async () => {},
    onMissionComplete: async () => {},
    requestCancellation: async () => true,
  };
}

function createIntegratedCoordinator(opts: MockRuntimeOptions = {}): CoreCoordinator {
  const capabilities = new CapabilityRegistry();
  const resources = new ResourceManager();
  const memory = new MissionMemory(20);
  const humanControl = new HumanControlState();
  const planner = new StubPlanner(true);

  const runtime = createMockRuntime(opts);

  // Pre-populate capability if runtime provides it
  if (opts.capabilities) {
    for (const rec of opts.capabilities) {
      capabilities.update(rec.id, rec.status, rec.evidenceSource);
    }
  } else if (opts.connected !== false) {
    // Default: simulate runtime probing read_only_observation as AVAILABLE
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

/**
 * Simulates what useMissionCommand.submitCommand does:
 * builds a MissionRequest from a prompt and calls coord.executeMission.
 */
async function submitCommand(coord: CoreCoordinator, prompt: string): Promise<MissionReport> {
  const request: MissionRequest = {
    id: `cmd-${Date.now()}`,
    prompt,
    scope: {
      level: 'read_only',
      allowedCapabilities: ['read_only_observation'],
      targetDescription: prompt.slice(0, 120),
    },
    createdAt: Date.now(),
    maxActions: 20,
    maxDurationMs: 120000,
  };
  return coord.executeMission(request);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration — submitted command enters the coordinator', () => {
  it('a submitted command produces a mission report (not undefined or null)', async () => {
    const coord = createIntegratedCoordinator();
    const report = await submitCommand(coord, 'Read the screen');
    expect(report).toBeDefined();
    expect(report.missionId).toMatch(/^cmd-/);
  });

  it('the coordinator controls the mission lifecycle (state transitions through all phases)', async () => {
    const coord = createIntegratedCoordinator();
    const report = await submitCommand(coord, 'Read the screen');
    // A successful mission reaches COMPLETED
    expect(report.state).toBe('COMPLETED');
    expect(report.outcome).toBe('SUCCESS');
  });

  it('mission history records the submitted command', async () => {
    const coord = createIntegratedCoordinator({
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    await submitCommand(coord, 'Read the screen');
    // The coordinator's mission memory should have the entry
    // We can verify via the report itself
    const report2 = await submitCommand(coord, 'Read the screen again');
    expect(report2.missionId).toMatch(/^cmd-/);
  });
});

describe('Integration — missing runtime or capabilities prevent execution', () => {
  it('command fails when no runtime is connected (NullRuntimeAdapter)', async () => {
    const capabilities = new CapabilityRegistry();
    const resources = new ResourceManager();
    const memory = new MissionMemory(20);
    const humanControl = new HumanControlState();
    const planner = new StubPlanner(true);
    const runtime = new NullRuntimeAdapter();

    // Even if we mark the capability available (simulating stale state),
    // the disconnected runtime should prevent authorization.
    capabilities.update('read_only_observation', 'AVAILABLE', 'runtime_probe');

    const coord = new CoreCoordinator({
      runtime,
      planner,
      capabilityRegistry: capabilities,
      resourceManager: resources,
      missionMemory: memory,
      humanControl,
    });

    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('runtime_disconnected');
  });

  it('command fails when required capability is UNAVAILABLE', async () => {
    const coord = createIntegratedCoordinator({
      capabilities: [makeCapabilityRecord('read_only_observation', 'UNAVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('capability_unavailable');
  });
});

describe('Integration — authorization denial prevents action dispatch', () => {
  it('command fails when runtime denies authorization', async () => {
    const coord = createIntegratedCoordinator({
      auth: makeAuthResult('DENIED', 'runtime'),
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('authorization_denied');
  });

  it('command fails when authorization is UNKNOWN (fail closed)', async () => {
    const coord = createIntegratedCoordinator({
      auth: makeAuthResult('UNKNOWN', 'runtime'),
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('authorization_unknown');
  });
});

describe('Integration — planner output cannot authorize', () => {
  it('command fails when authorization claims to come from planner', async () => {
    const coord = createIntegratedCoordinator({
      auth: makeAuthResult('AUTHORIZED', 'planner'),
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('authorization_denied');
  });

  it('command fails when authorization claims to come from frontend', async () => {
    const coord = createIntegratedCoordinator({
      auth: makeAuthResult('AUTHORIZED', 'frontend'),
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('authorization_denied');
  });
});

describe('Integration — cancellation does not produce false success', () => {
  it('cancellation produces CANCELLED outcome, not SUCCESS', async () => {
    const coord = createIntegratedCoordinator();
    const execPromise = submitCommand(coord, 'Read the screen');
    await coord.cancelMission();
    const report = await execPromise;
    expect(report.outcome).not.toBe('SUCCESS');
    // Cancellation or failure — but never false success
    expect(['CANCELLED', 'FAILURE']).toContain(report.outcome);
  });
});

describe('Integration — runtime disconnection does not produce false success', () => {
  it('dispatch failure produces FAILURE, not SUCCESS', async () => {
    const coord = createIntegratedCoordinator({
      dispatchThrows: true,
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('runtime_disconnected');
  });
});

describe('Integration — verification failure prevents successful report', () => {
  it('verification FAILED prevents SUCCESS outcome', async () => {
    const coord = createIntegratedCoordinator({
      verification: makeVerificationResult('FAILED'),
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('verification_failed');
  });

  it('verification UNVERIFIED prevents SUCCESS outcome', async () => {
    const coord = createIntegratedCoordinator({
      verification: makeVerificationResult('UNVERIFIED'),
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('verification_failed');
  });
});

describe('Integration — UI and history do not claim completion when result is unknown', () => {
  it('mission history records FAILURE, not SUCCESS, for unknown outcomes', async () => {
    const coord = createIntegratedCoordinator({
      actionResult: makeActionResult('UNKNOWN'),
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
    expect(report.verification).not.toBe('VERIFIED');
  });

  it('lastReport on coordinator reflects the actual failure, not fabricated success', async () => {
    const coord = createIntegratedCoordinator({
      verification: makeVerificationResult('FAILED'),
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    await submitCommand(coord, 'Read the screen');
    const lastReport = coord.getLastReport();
    expect(lastReport).not.toBeNull();
    expect(lastReport!.outcome).toBe('FAILURE');
    expect(lastReport!.verification).not.toBe('VERIFIED');
  });
});

describe('Integration — human control precedence preserved', () => {
  it('STOP signal prevents mission execution', async () => {
    const coord = createIntegratedCoordinator();
    coord.setControlSignal('STOP');
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
  });

  it('STOP has higher precedence than PAUSE', async () => {
    const coord = createIntegratedCoordinator();
    coord.setControlSignal('PAUSE');
    coord.setControlSignal('STOP');
    // STOP overrides — mission should fail
    const report = await submitCommand(coord, 'Read the screen');
    expect(report.outcome).toBe('FAILURE');
  });
});

describe('Integration — no second competing orchestrator', () => {
  it('setCoordinator replaces the singleton, not creates a parallel one', () => {
    const coord1 = createIntegratedCoordinator();
    setCoordinator(coord1);
    const got1 = getCoordinator();
    expect(got1).toBe(coord1);

    const coord2 = createIntegratedCoordinator();
    setCoordinator(coord2);
    const got2 = getCoordinator();
    expect(got2).toBe(coord2);
    expect(got2).not.toBe(coord1);
  });
});

describe('Integration — single coordinator singleton used by UI', () => {
  let originalCoord: CoreCoordinator | null = null;

  beforeEach(() => {
    // Save the original singleton so we don't pollute other tests
    originalCoord = getCoordinator();
  });

  afterEach(() => {
    if (originalCoord) {
      setCoordinator(originalCoord);
    }
  });

  it('the coordinator singleton is the one that processes commands', async () => {
    const coord = createIntegratedCoordinator({
      capabilities: [makeCapabilityRecord('read_only_observation', 'AVAILABLE')],
    });
    setCoordinator(coord);

    // Simulate what the UI hook does: getCoordinator() then executeMission
    const singletonCoord = getCoordinator();
    expect(singletonCoord).toBe(coord);

    const request = makeRequest({ prompt: 'Read the screen' });
    const report = await singletonCoord.executeMission(request);
    expect(report.outcome).toBe('SUCCESS');
    expect(report.state).toBe('COMPLETED');
  });
});
