import { describe, it, expect } from 'vitest';
import { NullRuntimeAdapter } from '@/core/runtimeAdapter';

describe('NullRuntimeAdapter', () => {
  it('is not connected', () => {
    const adapter = new NullRuntimeAdapter();
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.getConnectionStatus()).toBe('DISCONNECTED');
  });

  it('returns UNKNOWN authorization', async () => {
    const adapter = new NullRuntimeAdapter();
    const result = await adapter.requestAuthorization('m1', {
      level: 'read_only',
      allowedCapabilities: ['read_only_observation'],
      targetDescription: 'test',
    }, ['read_only_observation']);
    expect(result.decision).toBe('UNKNOWN');
    expect(result.grantedBy).toBe('none');
  });

  it('returns FAILURE for dispatchAction', async () => {
    const adapter = new NullRuntimeAdapter();
    const result = await adapter.dispatchAction({
      action: {
        id: 'a1',
        capability: 'windows_app_control',
        description: 'test',
        scope: 'local_app_control',
      },
      missionId: 'm1',
    });
    expect(result.status).toBe('FAILURE');
    expect(result.errorMessage).toBe('runtime_not_connected');
  });

  it('returns UNVERIFIED for verifyAction', async () => {
    const adapter = new NullRuntimeAdapter();
    const result = await adapter.verifyAction('m1', {
      action: {
        id: 'a1',
        capability: 'windows_app_control',
        description: 'test',
        scope: 'local_app_control',
      },
      missionId: 'm1',
    }, {
      status: 'SUCCESS',
      evidence: 'test',
      timestamp: Date.now(),
    });
    expect(result.status).toBe('UNVERIFIED');
  });

  it('returns unknown resource info', async () => {
    const adapter = new NullRuntimeAdapter();
    const info = await adapter.queryResources();
    expect(info.modelAvailable).toBeNull();
    expect(info.modelLoadingState).toBe('unknown');
  });

  it('returns false for cancellation request', async () => {
    const adapter = new NullRuntimeAdapter();
    const result = await adapter.requestCancellation('m1');
    expect(result).toBe(false);
  });
});
