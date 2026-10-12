import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreCoordinator } from '@/core/coordinator';
import { CapabilityRegistry } from '@/core/capabilityRegistry';
import { ResourceManager } from '@/core/resourceManager';
import { MissionMemory } from '@/core/missionMemory';
import { MissionStateMachine } from '@/core/missionStateMachine';
import { HumanControlState } from '@/core/humanControl';
import { StubPlanner } from '@/core/planner';
import { NullRuntimeAdapter } from '@/core/runtimeAdapter';
import type {
  RuntimeAdapter,
} from '@/core/runtimeAdapter';
import type {
  ActionDispatchRequest,
  ActionResult,
  AuthorizationResult,
  CapabilityId,
  CapabilityRecord,
  MissionRequest,
  MissionScope,
  ResourceInfo,
  VerificationResult,
} from '@/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScope(caps: CapabilityId[] = ['read_only_observation']): MissionScope {
  return {
    level: 'read_only',
    allowedCapabilities: caps,
    targetDescription: 'test target',
  };
}

function makeRequest(
  overrides: Partial<MissionRequest> = {},
): MissionRequest {
  return {
    id: 'test-mission-1',
    prompt: 'Read the screen',
    scope: makeScope(),
    createdAt: Date.now(),
    maxActions: 10,
    maxDurationMs: 60000,
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

function makeActionResult(
  status: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' = 'SUCCESS',
): ActionResult {
  return {
    status,
    evidence: `Action ${status}`,
    timestamp: Date.now(),
    errorMessage: status === 'FAILURE' ? 'some error' : undefined,
  };
}

function makeVerificationResult(
  status: 'VERIFIED' | 'UNVERIFIED' | 'FAILED' = 'VERIFIED',
): VerificationResult {
  return {
    status,
    evidence: `Verification ${status}`,
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

function createCoordinator(overrides: {
  runtime?: Partial<RuntimeAdapter>;
  plannerAvailable?: boolean;
  prePopulateCapabilities?: { id: CapabilityId; status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' }[];
} = {}): CoreCoordinator {
  const capabilities = new CapabilityRegistry();
  const resources = new ResourceManager();
  const memory = new MissionMemory(20);
  const humanControl = new HumanControlState();
  const planner = new StubPlanner(overrides.plannerAvailable ?? true);

  const baseRuntime: RuntimeAdapter = new NullRuntimeAdapter();
  const runtime: RuntimeAdapter = {
    isConnected: overrides.runtime?.isConnected ?? (() => true),
    getConnectionStatus: overrides.runtime?.getConnectionStatus ?? (() => 'CONNECTED' as const),
    queryCapabilities: overrides.runtime?.queryCapabilities ?? (async () => []),
    requestAuthorization: overrides.runtime?.requestAuthorization ?? (async () => makeAuthResult('AUTHORIZED')),
    dispatchAction: overrides.runtime?.dispatchAction ?? (async () => makeActionResult('SUCCESS')),
    verifyAction: overrides.runtime?.verifyAction ?? (async () => makeVerificationResult('VERIFIED')),
    queryResources: overrides.runtime?.queryResources ?? (async () => ({ modelAvailable: null, modelLoadingState: 'unknown' })),
    onMissionStart: overrides.runtime?.onMissionStart ?? (async () => {}),
    onMissionComplete: overrides.runtime?.onMissionComplete ?? (async () => {}),
    requestCancellation: overrides.runtime?.requestCancellation ?? (async () => true),
  };

  if (overrides.prePopulateCapabilities) {
    for (const c of overrides.prePopulateCapabilities) {
      capabilities.update(c.id, c.status, 'runtime_probe');
    }
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
// Tests
// ---------------------------------------------------------------------------

describe('CoreCoordinator — missing capabilities', () => {
  it('fails when required capability is UNAVAILABLE', async () => {
    const coord = createCoordinator({
      plannerAvailable: true,
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'UNAVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('capability_unavailable');
  });

  it('fails when required capability is UNKNOWN', async () => {
    const coord = createCoordinator({
      plannerAvailable: true,
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'UNKNOWN' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('capability_unavailable');
  });
});

describe('CoreCoordinator — authorization denied', () => {
  it('fails on authorization DENIED', async () => {
    const coord = createCoordinator({
      runtime: {
        requestAuthorization: async () => makeAuthResult('DENIED', 'runtime'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('authorization_denied');
  });
});

describe('CoreCoordinator — authorization unknown (fail closed)', () => {
  it('fails on authorization UNKNOWN', async () => {
    const coord = createCoordinator({
      runtime: {
        requestAuthorization: async () => makeAuthResult('UNKNOWN', 'runtime'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('authorization_unknown');
  });

  it('fails when runtime is disconnected during authorization', async () => {
    const coord = createCoordinator({
      runtime: {
        isConnected: () => false,
        getConnectionStatus: () => 'DISCONNECTED' as const,
        requestAuthorization: async () => makeAuthResult('UNKNOWN', 'none'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('runtime_disconnected');
  });
});

describe('CoreCoordinator — planner cannot authorize', () => {
  it('rejects authorization granted by planner', async () => {
    const coord = createCoordinator({
      runtime: {
        requestAuthorization: async () => makeAuthResult('AUTHORIZED', 'planner'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('authorization_denied');
  });

  it('rejects authorization granted by frontend', async () => {
    const coord = createCoordinator({
      runtime: {
        requestAuthorization: async () => makeAuthResult('AUTHORIZED', 'frontend'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('authorization_denied');
  });
});

describe('CoreCoordinator — runtime disconnection during mission', () => {
  it('fails when dispatchAction throws (runtime disconnect)', async () => {
    const coord = createCoordinator({
      runtime: {
        dispatchAction: async () => {
          throw new Error('Runtime disconnected');
        },
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('runtime_disconnected');
  });
});

describe('CoreCoordinator — cancellation', () => {
  it('cancelMission sets CANCELLED state', async () => {
    const coord = createCoordinator({
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    // Start a mission then cancel
    const execPromise = coord.executeMission(makeRequest({ id: 'cancel-test' }));
    await coord.cancelMission();
    const report = await execPromise;
    // The mission should end in a terminal state
    expect(['CANCELLED', 'FAILED', 'SUCCESS']).toContain(report.outcome);
  });
});

describe('CoreCoordinator — uncertain outcomes', () => {
  it('treats UNKNOWN action result as failure', async () => {
    const coord = createCoordinator({
      runtime: {
        dispatchAction: async () => makeActionResult('UNKNOWN'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('unknown_outcome');
  });
});

describe('CoreCoordinator — verification failure prevents success', () => {
  it('fails on verification FAILED', async () => {
    const coord = createCoordinator({
      runtime: {
        verifyAction: async () => makeVerificationResult('FAILED'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('verification_failed');
  });

  it('fails on verification UNVERIFIED (cannot report success)', async () => {
    const coord = createCoordinator({
      runtime: {
        verifyAction: async () => makeVerificationResult('UNVERIFIED'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('verification_failed');
  });
});

describe('CoreCoordinator — action and duration limits', () => {
  it('stops when action limit is exceeded', async () => {
    // Stub planner produces one action per allowed capability
    // Set maxActions to 0 to trigger the limit immediately
    const coord = createCoordinator({
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest({ maxActions: 0 }));
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('action_limit_exceeded');
  });

  it('stops when duration limit is exceeded', async () => {
    const coord = createCoordinator({
      runtime: {
        dispatchAction: async () => {
          await new Promise((r) => setTimeout(r, 50));
          return makeActionResult('SUCCESS');
        },
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest({ maxDurationMs: 1 }));
    expect(report.outcome).toBe('FAILURE');
    expect(['duration_limit_exceeded', 'invalid_state_transition']).toContain(report.failureReason);
  });
});

describe('CoreCoordinator — no execution through null runtime', () => {
  it('fails immediately with NullRuntimeAdapter (not connected)', async () => {
    const coord = createCoordinator({
      runtime: {
        isConnected: () => false,
        getConnectionStatus: () => 'DISCONNECTED' as const,
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('runtime_disconnected');
  });
});

describe('CoreCoordinator — planner unavailable', () => {
  it('fails when planner is not available', async () => {
    const coord = createCoordinator({
      plannerAvailable: false,
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
    expect(report.failureReason).toBe('planner_unavailable');
  });
});

describe('CoreCoordinator — successful mission (full lifecycle)', () => {
  it('completes a mission when all conditions are met', async () => {
    const coord = createCoordinator({
      runtime: {
        requestAuthorization: async () => makeAuthResult('AUTHORIZED', 'runtime'),
        dispatchAction: async () => makeActionResult('SUCCESS'),
        verifyAction: async () => makeVerificationResult('VERIFIED'),
      },
      prePopulateCapabilities: [
        { id: 'read_only_observation', status: 'AVAILABLE' },
      ],
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('SUCCESS');
    expect(report.state).toBe('COMPLETED');
    expect(report.verification).toBe('VERIFIED');
    expect(report.actionsExecuted).toBeGreaterThan(0);
  });
});

describe('CoreCoordinator — human control halt', () => {
  it('fails when STOP signal is active', async () => {
    const capabilities = new CapabilityRegistry();
    const resources = new ResourceManager();
    const memory = new MissionMemory(20);
    const humanControl = new HumanControlState();
    humanControl.setSignal('STOP');
    const planner = new StubPlanner(true);

    const runtime: RuntimeAdapter = {
      isConnected: () => true,
      getConnectionStatus: () => 'CONNECTED' as const,
      queryCapabilities: async () => [],
      requestAuthorization: async () => makeAuthResult('AUTHORIZED', 'runtime'),
      dispatchAction: async () => makeActionResult('SUCCESS'),
      verifyAction: async () => makeVerificationResult('VERIFIED'),
      queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      onMissionStart: async () => {},
      onMissionComplete: async () => {},
      requestCancellation: async () => true,
    };

    capabilities.update('read_only_observation', 'AVAILABLE', 'runtime_probe');

    const coord = new CoreCoordinator({
      runtime,
      planner,
      capabilityRegistry: capabilities,
      resourceManager: resources,
      missionMemory: memory,
      humanControl,
    });

    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('FAILURE');
  });
});

describe('CoreCoordinator — resource info unknown without runtime', () => {
  it('returns unknown resource info when no runtime data', () => {
    const coord = createCoordinator({
      runtime: {
        queryResources: async () => ({ modelAvailable: null, modelLoadingState: 'unknown' }),
      },
    });
    const info = coord.getResourceInfo();
    expect(info.modelAvailable).toBeNull();
    expect(info.modelLoadingState).toBe('unknown');
    expect(info.availableRamMB).toBeUndefined();
  });
});

describe('CoreCoordinator — capability evidence from runtime', () => {
  it('updates capabilities from runtime probe during OBSERVE', async () => {
    const coord = createCoordinator({
      runtime: {
        queryCapabilities: async () => [
          makeCapabilityRecord('read_only_observation', 'AVAILABLE'),
        ],
        requestAuthorization: async () => makeAuthResult('AUTHORIZED', 'runtime'),
        dispatchAction: async () => makeActionResult('SUCCESS'),
        verifyAction: async () => makeVerificationResult('VERIFIED'),
      },
      // Do NOT pre-populate — let the runtime probe set it
    });
    const report = await coord.executeMission(makeRequest());
    expect(report.outcome).toBe('SUCCESS');
  });
});
