import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityRegistry } from '@/core/capabilityRegistry';
import type { CapabilityId, CapabilityRecord } from '@/core/types';

describe('CapabilityRegistry — defaults', () => {
  it('all capabilities start as UNKNOWN or UNAVAILABLE (never AVAILABLE)', () => {
    const reg = new CapabilityRegistry();
    for (const rec of reg.getAll()) {
      expect(rec.status).not.toBe('AVAILABLE');
      expect(['UNKNOWN', 'UNAVAILABLE']).toContain(rec.status);
    }
  });

  it('windows_app_control defaults to UNAVAILABLE', () => {
    const reg = new CapabilityRegistry();
    expect(reg.get('windows_app_control').status).toBe('UNAVAILABLE');
  });

  it('local_llm_inference defaults to UNKNOWN', () => {
    const reg = new CapabilityRegistry();
    expect(reg.get('local_llm_inference').status).toBe('UNKNOWN');
  });

  it('throws for unknown capability id', () => {
    const reg = new CapabilityRegistry();
    expect(() => reg.get('nonexistent' as CapabilityId)).toThrow('Unknown capability');
  });
});

describe('CapabilityRegistry — updates from runtime evidence', () => {
  it('marks AVAILABLE when evidence comes from runtime_probe', () => {
    const reg = new CapabilityRegistry();
    reg.update('local_llm_inference', 'AVAILABLE', 'runtime_probe', undefined, 1234567890);
    expect(reg.isAvailable('local_llm_inference')).toBe(true);
    expect(reg.get('local_llm_inference').lastConfirmedAt).toBe(1234567890);
  });

  it('marks AVAILABLE when evidence comes from runtime_handshake', () => {
    const reg = new CapabilityRegistry();
    reg.update('mission_planning', 'AVAILABLE', 'runtime_handshake');
    expect(reg.isAvailable('mission_planning')).toBe(true);
  });

  it('marks AVAILABLE when evidence comes from runtime_capability_query', () => {
    const reg = new CapabilityRegistry();
    reg.update('read_only_observation', 'AVAILABLE', 'runtime_capability_query');
    expect(reg.isAvailable('read_only_observation')).toBe(true);
  });

  it('rejects AVAILABLE from manual_override', () => {
    const reg = new CapabilityRegistry();
    expect(() =>
      reg.update('local_llm_inference', 'AVAILABLE', 'manual_override'),
    ).toThrow('manual_override');
  });

  it('allows UNAVAILABLE from manual_override', () => {
    const reg = new CapabilityRegistry();
    reg.update('local_llm_inference', 'UNAVAILABLE', 'manual_override', 'not_implemented');
    expect(reg.get('local_llm_inference').status).toBe('UNAVAILABLE');
    expect(reg.get('local_llm_inference').reason).toBe('Capability is not yet implemented');
  });
});

describe('CapabilityRegistry — evidence validation', () => {
  it('rejects AVAILABLE with none as evidence source', () => {
    const reg = new CapabilityRegistry();
    const fakeRecords: CapabilityRecord[] = [
      {
        id: 'local_llm_inference',
        status: 'AVAILABLE',
        evidenceSource: 'none',
        requiresRuntime: true,
      },
    ];
    expect(reg.validateEvidence(fakeRecords)).toBe(false);
  });

  it('rejects AVAILABLE with manual_override as evidence source', () => {
    const reg = new CapabilityRegistry();
    const fakeRecords: CapabilityRecord[] = [
      {
        id: 'local_llm_inference',
        status: 'AVAILABLE',
        evidenceSource: 'manual_override',
        requiresRuntime: true,
      },
    ];
    expect(reg.validateEvidence(fakeRecords)).toBe(false);
  });

  it('accepts AVAILABLE with runtime_probe as evidence source', () => {
    const reg = new CapabilityRegistry();
    const records: CapabilityRecord[] = [
      {
        id: 'local_llm_inference',
        status: 'AVAILABLE',
        evidenceSource: 'runtime_probe',
        requiresRuntime: true,
        lastConfirmedAt: Date.now(),
      },
    ];
    expect(reg.validateEvidence(records)).toBe(true);
  });

  it('accepts UNKNOWN status with any evidence source', () => {
    const reg = new CapabilityRegistry();
    const records: CapabilityRecord[] = [
      {
        id: 'local_llm_inference',
        status: 'UNKNOWN',
        evidenceSource: 'none',
        requiresRuntime: true,
      },
    ];
    expect(reg.validateEvidence(records)).toBe(true);
  });
});

describe('CapabilityRegistry — getUnavailable', () => {
  it('returns capabilities that are not AVAILABLE', () => {
    const reg = new CapabilityRegistry();
    const required: CapabilityId[] = ['local_llm_inference', 'mission_planning'];
    const unavailable = reg.getUnavailable(required);
    expect(unavailable.length).toBe(2);
  });

  it('returns empty when all are AVAILABLE', () => {
    const reg = new CapabilityRegistry();
    reg.update('local_llm_inference', 'AVAILABLE', 'runtime_probe');
    const required: CapabilityId[] = ['local_llm_inference'];
    expect(reg.getUnavailable(required).length).toBe(0);
  });
});
