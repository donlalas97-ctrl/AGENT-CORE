/**
 * AGENT Core Engine — Human Control Signals
 *
 * Preserves the STOP > TAKE_CONTROL > PAUSE precedence.
 * These signals come from the human operator and always override
 * autonomous mission execution.
 *
 * STOP:      Halt immediately, no resumption possible.
 * TAKE_CONTROL: Human takes direct control, mission pauses.
 * PAUSE:     Temporary halt, can be resumed.
 * RESUME:    Continue from PAUSE.
 * NONE:      No active control signal.
 */

import type { HumanControlSignal } from './types';

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

const PRECEDENCE: readonly HumanControlSignal[] = [
  'STOP',
  'TAKE_CONTROL',
  'PAUSE',
  'RESUME',
  'NONE',
];

// ---------------------------------------------------------------------------
// Human Control State
// ---------------------------------------------------------------------------

export class HumanControlState {
  private currentSignal: HumanControlSignal = 'NONE';

  /** Returns the current control signal. */
  getSignal(): HumanControlSignal {
    return this.currentSignal;
  }

  /** Sets the control signal. */
  setSignal(signal: HumanControlSignal): void {
    this.currentSignal = signal;
  }

  /** Clears the signal back to NONE. */
  clear(): void {
    this.currentSignal = 'NONE';
  }

  /** Returns true if STOP or TAKE_CONTROL is active. */
  isHalted(): boolean {
    return this.currentSignal === 'STOP' || this.currentSignal === 'TAKE_CONTROL';
  }

  /** Returns true if PAUSE is active (but not STOP or TAKE_CONTROL). */
  isPaused(): boolean {
    return this.currentSignal === 'PAUSE';
  }

  /**
   * Given two signals, returns the one with higher precedence.
   * STOP > TAKE_CONTROL > PAUSE > RESUME > NONE
   */
  static resolvePrecedence(
    a: HumanControlSignal,
    b: HumanControlSignal,
  ): HumanControlSignal {
    const ia = PRECEDENCE.indexOf(a);
    const ib = PRECEDENCE.indexOf(b);
    return ia <= ib ? a : b;
  }

  /** Returns the precedence order for diagnostics. */
  static getPrecedenceOrder(): readonly HumanControlSignal[] {
    return PRECEDENCE;
  }
}
