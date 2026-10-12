/**
 * AGENT Core Engine — Mission State Machine
 *
 * Bounded state machine for the mission lifecycle.
 * Rejects invalid transitions. Enforces the ordered lifecycle:
 * UNDERSTAND → SCOPE_CHECK → OBSERVE → PLAN →
 * AUTHORIZATION_CHECK → ACT → VERIFY → REPORT → COMPLETED
 *
 * Terminal states: COMPLETED, FAILED, CANCELLED.
 * Cancellation is allowed from any non-terminal state.
 */

import type { MissionState } from './types';
import { LIFECYCLE_PHASES, TERMINAL_STATES } from './types';

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

const TRANSITIONS: ReadonlyMap<MissionState, readonly MissionState[]> = new Map([
  ['IDLE', ['UNDERSTAND']],
  ['UNDERSTAND', ['SCOPE_CHECK', 'FAILED', 'CANCELLED']],
  ['SCOPE_CHECK', ['OBSERVE', 'FAILED', 'CANCELLED']],
  ['OBSERVE', ['PLAN', 'FAILED', 'CANCELLED']],
  ['PLAN', ['AUTHORIZATION_CHECK', 'FAILED', 'CANCELLED']],
  ['AUTHORIZATION_CHECK', ['ACT', 'FAILED', 'CANCELLED']],
  ['ACT', ['VERIFY', 'FAILED', 'CANCELLED']],
  ['VERIFY', ['REPORT', 'ACT', 'FAILED', 'CANCELLED']],
  ['REPORT', ['COMPLETED', 'FAILED', 'CANCELLED']],
  ['COMPLETED', []],
  ['FAILED', ['IDLE']],
  ['CANCELLED', ['IDLE']],
]);

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export class MissionStateMachine {
  private currentState: MissionState = 'IDLE';

  /** Returns the current state. */
  getState(): MissionState {
    return this.currentState;
  }

  /** Returns true if the state is terminal (no further lifecycle transitions). */
  isTerminal(): boolean {
    return TERMINAL_STATES.includes(this.currentState);
  }

  /** Returns true if a transition from current state to target is valid. */
  canTransitionTo(target: MissionState): boolean {
    const allowed = TRANSITIONS.get(this.currentState);
    if (!allowed) return false;
    return allowed.includes(target);
  }

  /**
   * Attempts a state transition.
   * Throws on invalid transitions — callers must handle this as a failure.
   */
  transitionTo(target: MissionState): void {
    if (!this.canTransitionTo(target)) {
      throw new Error(
        `Invalid state transition: ${this.currentState} → ${target}`,
      );
    }
    this.currentState = target;
  }

  /**
   * Cancels the mission from any non-terminal state.
   * Returns true if cancellation was applied, false if already terminal.
   */
  cancel(): boolean {
    if (this.isTerminal()) return false;
    this.currentState = 'CANCELLED';
    return true;
  }

  /** Fails the mission from any non-terminal state. */
  fail(): boolean {
    if (this.isTerminal()) return false;
    this.currentState = 'FAILED';
    return true;
  }

  /** Resets to IDLE (only allowed from terminal states). */
  reset(): void {
    if (!this.isTerminal()) {
      throw new Error(
        `Cannot reset from non-terminal state: ${this.currentState}`,
      );
    }
    this.currentState = 'IDLE';
  }

  /** Returns the ordered lifecycle phases. */
  static getLifecyclePhases(): readonly MissionState[] {
    return LIFECYCLE_PHASES;
  }

  /** Returns the terminal states. */
  static getTerminalStates(): readonly MissionState[] {
    return TERMINAL_STATES;
  }

  /** Returns all valid transitions from a given state. */
  static getValidTransitionsFrom(state: MissionState): readonly MissionState[] {
    return TRANSITIONS.get(state) ?? [];
  }
}
