import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceManager } from '@/core/resourceManager';

describe('ResourceManager — unknown state', () => {
  let rm: ResourceManager;

  beforeEach(() => {
    rm = new ResourceManager();
  });

  it('returns unknown resource info by default', () => {
    const info = rm.getInfo();
    expect(info.availableRamMB).toBeUndefined();
    expect(info.cpuUtilizationPercent).toBeUndefined();
    expect(info.modelAvailable).toBeNull();
    expect(info.modelLoadingState).toBe('unknown');
    expect(info.capabilityReadiness).toBeUndefined();
  });

  it('isModelAvailable returns false when no data', () => {
    expect(rm.isModelAvailable()).toBe(false);
  });

  it('getModelLoadingState returns unknown by default', () => {
    expect(rm.getModelLoadingState()).toBe('unknown');
  });

  it('isCapabilityReady returns false when no readiness data', () => {
    expect(rm.isCapabilityReady('local_llm_inference')).toBe(false);
  });

  it('lastUpdated is undefined by default', () => {
    expect(rm.getLastUpdated()).toBeUndefined();
  });
});

describe('ResourceManager — updates from runtime', () => {
  it('updates from trusted runtime data', () => {
    const rm = new ResourceManager();
    rm.updateFromRuntime({
      availableRamMB: 8192,
      cpuUtilizationPercent: 45,
      modelAvailable: true,
      modelId: 'llama-3-8b',
      modelLoadingState: 'loaded',
    });
    const info = rm.getInfo();
    expect(info.availableRamMB).toBe(8192);
    expect(info.cpuUtilizationPercent).toBe(45);
    expect(info.modelAvailable).toBe(true);
    expect(info.modelId).toBe('llama-3-8b');
    expect(info.modelLoadingState).toBe('loaded');
    expect(rm.isModelAvailable()).toBe(true);
    expect(rm.getLastUpdated()).toBeDefined();
  });

  it('isCapabilityReady returns true when marked ready', () => {
    const rm = new ResourceManager();
    rm.updateFromRuntime({
      capabilityReadiness: { local_llm_inference: true },
    });
    expect(rm.isCapabilityReady('local_llm_inference')).toBe(true);
    expect(rm.isCapabilityReady('text_to_speech')).toBe(false);
  });

  it('resetToUnknown clears all data', () => {
    const rm = new ResourceManager();
    rm.updateFromRuntime({
      availableRamMB: 4096,
      modelAvailable: true,
      modelLoadingState: 'loaded',
    });
    rm.resetToUnknown();
    const info = rm.getInfo();
    expect(info.availableRamMB).toBeUndefined();
    expect(info.modelAvailable).toBeNull();
    expect(info.modelLoadingState).toBe('unknown');
    expect(rm.getLastUpdated()).toBeUndefined();
  });

  it('partial updates preserve existing fields', () => {
    const rm = new ResourceManager();
    rm.updateFromRuntime({ availableRamMB: 4096 });
    rm.updateFromRuntime({ cpuUtilizationPercent: 30 });
    const info = rm.getInfo();
    expect(info.availableRamMB).toBe(4096);
    expect(info.cpuUtilizationPercent).toBe(30);
  });
});
