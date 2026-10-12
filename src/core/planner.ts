/**
 * AGENT Core Engine — Planner Interface
 *
 * The planner decomposes a mission prompt into a bounded sequence
 * of actions. The planner CANNOT authorize execution — it only
 * produces a plan. Authorization comes exclusively from the runtime.
 */

import type {
  CapabilityId,
  MissionScope,
  PlanningResult,
} from './types';

// ---------------------------------------------------------------------------
// Planner interface
// ---------------------------------------------------------------------------

export interface Planner {
  /** Returns whether the planner is currently available. */
  isAvailable(): boolean;

  /** Returns the reason if unavailable. */
  getUnavailableReason(): string | undefined;

  /**
   * Produces a plan for the given prompt and scope.
   * The plan must only use capabilities listed in scope.allowedCapabilities.
   * The plan does NOT authorize execution.
   */
  plan(
    prompt: string,
    scope: MissionScope,
    availableCapabilities: readonly CapabilityId[],
  ): Promise<PlanningResult>;
}

// ---------------------------------------------------------------------------
// Stub Planner (used when no LLM is available)
// ---------------------------------------------------------------------------

export class StubPlanner implements Planner {
  private available: boolean;
  private reason: string | undefined;

  constructor(available: boolean = false, reason?: string) {
    this.available = available;
    this.reason = reason ?? 'No local LLM inference available';
  }

  isAvailable(): boolean {
    return this.available;
  }

  getUnavailableReason(): string | undefined {
    return this.reason;
  }

  async plan(
    prompt: string,
    scope: MissionScope,
    availableCapabilities: readonly CapabilityId[],
  ): Promise<PlanningResult> {
    if (!this.available) {
      throw new Error(this.reason ?? 'Planner is not available');
    }

    // Filter capabilities to those allowed by scope and actually available
    const usable = scope.allowedCapabilities.filter((c) =>
      availableCapabilities.includes(c),
    );

    return {
      actions: usable.map((cap, i) => ({
        id: `action-${i + 1}`,
        capability: cap,
        description: `Attempt ${cap} for: ${prompt.slice(0, 80)}`,
        scope: scope.level,
      })),
      rationale: `Stub plan using available capabilities for scope ${scope.level}`,
      requiresCapabilities: usable,
    };
  }
}
