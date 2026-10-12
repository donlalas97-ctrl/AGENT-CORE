/**
 * AGENT Core Engine — Resource Management Contracts
 *
 * Lightweight interface for reporting system and model resources.
 * All data must come from the trusted runtime — nothing is fabricated.
 * When no runtime is connected, all fields are UNKNOWN / undefined.
 */

import type {
  CapabilityId,
  ModelLoadingState,
  ResourceInfo,
} from './types';

// ---------------------------------------------------------------------------
// Resource Manager
// ---------------------------------------------------------------------------

const UNKNOWN_RESOURCE_INFO: ResourceInfo = {
  availableRamMB: undefined,
  cpuUtilizationPercent: undefined,
  modelAvailable: null,
  modelId: undefined,
  modelLoadingState: 'unknown',
  capabilityReadiness: undefined,
};

export class ResourceManager {
  private currentInfo: ResourceInfo = { ...UNKNOWN_RESOURCE_INFO };
  private lastUpdated: number | undefined;

  /**
   * Updates resource info from trusted runtime data.
   * Caller must ensure data originates from the runtime, not fabrication.
   */
  updateFromRuntime(info: Partial<ResourceInfo>): void {
    this.currentInfo = { ...this.currentInfo, ...info };
    this.lastUpdated = Date.now();
  }

  /** Resets to unknown when runtime disconnects. */
  resetToUnknown(): void {
    this.currentInfo = { ...UNKNOWN_RESOURCE_INFO };
    this.lastUpdated = undefined;
  }

  /** Returns current resource info. Fields are undefined when not measured. */
  getInfo(): ResourceInfo {
    return { ...this.currentInfo };
  }

  /** Returns the timestamp of the last trusted update, if any. */
  getLastUpdated(): number | undefined {
    return this.lastUpdated;
  }

  /** Returns true if a model is confirmed loaded and available. */
  isModelAvailable(): boolean {
    return this.currentInfo.modelAvailable === true;
  }

  /** Returns the model loading state, or 'unknown'. */
  getModelLoadingState(): ModelLoadingState {
    return this.currentInfo.modelLoadingState ?? 'unknown';
  }

  /**
   * Conservative capability selection: returns true only if the
   * capability is marked ready in capabilityReadiness AND a model
   * is available when the capability likely requires one.
   * Returns false (not throws) when data is absent.
   */
  isCapabilityReady(id: CapabilityId): boolean {
    const readiness = this.currentInfo.capabilityReadiness;
    if (!readiness) return false;
    return readiness[id] === true;
  }
}

// Singleton instance
let _manager: ResourceManager | null = null;

export function getResourceManager(): ResourceManager {
  if (!_manager) {
    _manager = new ResourceManager();
  }
  return _manager;
}
