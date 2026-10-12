/**
 * AGENT Core Engine — Capability Registry
 *
 * A compact, typed registry of capability definitions.
 * Availability is populated ONLY from validated runtime evidence.
 * A capability is never marked AVAILABLE because its UI page exists.
 */

import type {
  CapabilityId,
  CapabilityRecord,
  CapabilityStatus,
  EvidenceSource,
  UnavailableReason,
} from './types';

// ---------------------------------------------------------------------------
// Capability definitions (static metadata — not availability claims)
// ---------------------------------------------------------------------------

interface CapabilityDefinition {
  readonly id: CapabilityId;
  readonly label: string;
  readonly description: string;
  readonly requiresRuntime: boolean;
  readonly defaultStatus: CapabilityStatus;
}

const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    id: 'local_llm_inference',
    label: 'Local LLM Inference',
    description: 'On-device language model inference for reasoning and generation.',
    requiresRuntime: true,
    defaultStatus: 'UNKNOWN',
  },
  {
    id: 'mission_planning',
    label: 'Mission Planning',
    description: 'Decomposes a mission prompt into a bounded sequence of actions.',
    requiresRuntime: false,
    defaultStatus: 'UNKNOWN',
  },
  {
    id: 'windows_app_control',
    label: 'Windows Application Control',
    description: 'Controls Windows applications through the trusted runtime.',
    requiresRuntime: true,
    defaultStatus: 'UNAVAILABLE',
  },
  {
    id: 'read_only_observation',
    label: 'Read-Only Observation',
    description: 'Observes screen or system state without making changes.',
    requiresRuntime: true,
    defaultStatus: 'UNKNOWN',
  },
  {
    id: 'document_intelligence',
    label: 'Document Intelligence',
    description: 'Extracts and reasons about document content.',
    requiresRuntime: true,
    defaultStatus: 'UNKNOWN',
  },
  {
    id: 'local_speech_recognition',
    label: 'Local Speech Recognition',
    description: 'Transcribes speech to text on-device.',
    requiresRuntime: true,
    defaultStatus: 'UNAVAILABLE',
  },
  {
    id: 'wake_word_detection',
    label: 'Wake-Word Detection',
    description: 'Detects a wake word to activate the assistant.',
    requiresRuntime: true,
    defaultStatus: 'UNAVAILABLE',
  },
  {
    id: 'text_to_speech',
    label: 'Text-to-Speech',
    description: 'Synthesizes speech from text on-device.',
    requiresRuntime: true,
    defaultStatus: 'UNAVAILABLE',
  },
  {
    id: 'owner_speaker_verification',
    label: 'Owner Speaker Verification',
    description: 'Biometric voice verification of the device owner.',
    requiresRuntime: true,
    defaultStatus: 'UNAVAILABLE',
  },
  {
    id: 'resource_aware_model_routing',
    label: 'Resource-Aware Model Routing',
    description: 'Selects models based on available system resources.',
    requiresRuntime: true,
    defaultStatus: 'UNKNOWN',
  },
];

const DEFINITION_MAP: ReadonlyMap<CapabilityId, CapabilityDefinition> = new Map(
  CAPABILITY_DEFINITIONS.map((d) => [d.id, d]),
);

// ---------------------------------------------------------------------------
// Capability Registry
// ---------------------------------------------------------------------------

export class CapabilityRegistry {
  private readonly records: Map<CapabilityId, CapabilityRecord> = new Map();

  constructor() {
    for (const def of CAPABILITY_DEFINITIONS) {
      this.records.set(def.id, {
        id: def.id,
        status: def.defaultStatus,
        evidenceSource: 'none',
        requiresRuntime: def.requiresRuntime,
      });
    }
  }

  /** Returns all capability definitions (metadata only, no availability claims). */
  getDefinitions(): readonly CapabilityDefinition[] {
    return CAPABILITY_DEFINITIONS;
  }

  /** Returns the label for a capability id. */
  getLabel(id: CapabilityId): string {
    return DEFINITION_MAP.get(id)?.label ?? id;
  }

  /** Returns all current capability records. */
  getAll(): readonly CapabilityRecord[] {
    return Array.from(this.records.values());
  }

  /** Returns the record for a specific capability. */
  get(id: CapabilityId): CapabilityRecord {
    const rec = this.records.get(id);
    if (!rec) {
      throw new Error(`Unknown capability: ${id}`);
    }
    return rec;
  }

  /** Returns true if the capability is currently AVAILABLE. */
  isAvailable(id: CapabilityId): boolean {
    return this.get(id).status === 'AVAILABLE';
  }

  /**
   * Updates a capability's status from runtime evidence.
   * Only evidence from a trusted runtime source can mark a capability AVAILABLE.
   * manual_override can only set UNAVAILABLE or UNKNOWN.
   */
  update(
    id: CapabilityId,
    status: CapabilityStatus,
    evidenceSource: EvidenceSource,
    reason?: UnavailableReason | string,
    timestamp?: number,
  ): void {
    const def = DEFINITION_MAP.get(id);
    if (!def) {
      throw new Error(`Unknown capability: ${id}`);
    }

    // manual_override cannot mark capabilities as AVAILABLE
    if (evidenceSource === 'manual_override' && status === 'AVAILABLE') {
      throw new Error(
        `Cannot mark capability ${id} AVAILABLE via manual_override — only trusted runtime evidence can do so`,
      );
    }

    this.records.set(id, {
      id,
      status,
      evidenceSource,
      reason: reason ? (isUnavailableReason(reason) ? UnavailableReasonToString(reason) : reason) : undefined,
      requiresRuntime: def.requiresRuntime,
      lastConfirmedAt: timestamp,
    });
  }

  /**
   * Validates that a set of evidence records can be trusted.
   * Records from 'none' or 'manual_override' sources cannot establish AVAILABLE.
   */
  validateEvidence(records: readonly CapabilityRecord[]): boolean {
    for (const rec of records) {
      if (rec.status === 'AVAILABLE') {
        const trustedSources: EvidenceSource[] = [
          'runtime_probe',
          'runtime_handshake',
          'runtime_capability_query',
        ];
        if (!trustedSources.includes(rec.evidenceSource)) {
          return false;
        }
        // Capabilities that require a runtime must have trusted evidence
        if (rec.requiresRuntime && !trustedSources.includes(rec.evidenceSource)) {
          return false;
        }
      }
    }
    return true;
  }

  /** Returns all capabilities required by the given scope that are not available. */
  getUnavailable(required: readonly CapabilityId[]): readonly CapabilityRecord[] {
    return required
      .map((id) => this.get(id))
      .filter((rec) => rec.status !== 'AVAILABLE');
  }
}

const UNAVAILABLE_REASONS: readonly UnavailableReason[] = [
  'not_connected_to_runtime',
  'runtime_does_not_support',
  'not_implemented',
  'hardware_unavailable',
  'model_not_loaded',
];

function isUnavailableReason(value: string): value is UnavailableReason {
  return (UNAVAILABLE_REASONS as readonly string[]).includes(value);
}

function UnavailableReasonToString(reason: UnavailableReason): string {
  const map: Record<UnavailableReason, string> = {
    not_connected_to_runtime: 'Not connected to a trusted runtime',
    runtime_does_not_support: 'Runtime does not support this capability',
    not_implemented: 'Capability is not yet implemented',
    hardware_unavailable: 'Required hardware is unavailable',
    model_not_loaded: 'Required model is not loaded',
  };
  return map[reason] ?? reason;
}

// Singleton registry instance
let _registry: CapabilityRegistry | null = null;

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!_registry) {
    _registry = new CapabilityRegistry();
  }
  return _registry;
}
