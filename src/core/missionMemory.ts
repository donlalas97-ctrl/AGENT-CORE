/**
 * AGENT Core Engine — Bounded Mission Memory
 *
 * Minimal, in-memory mission state and history.
 * Does NOT persist secrets, tokens, raw audio, biometric templates,
 * or unrestricted conversation history.
 * Does NOT claim durable persistence.
 */

import type {
  MissionHistoryEntry,
  MissionId,
  MissionMemorySnapshot,
  MissionOutcome,
  MissionState,
  VerificationStatus,
} from './types';

const DEFAULT_RETENTION_LIMIT = 50;

export class MissionMemory {
  private currentState: MissionState = 'IDLE';
  private readonly history: MissionHistoryEntry[] = [];
  private readonly retentionLimit: number;
  private currentMissionId: MissionId | null = null;
  private currentMissionStartedAt: number | null = null;
  private currentActionCount = 0;

  constructor(retentionLimit: number = DEFAULT_RETENTION_LIMIT) {
    if (retentionLimit < 1) {
      throw new Error('Retention limit must be at least 1');
    }
    this.retentionLimit = retentionLimit;
  }

  /** Sets the current lifecycle state. */
  setState(state: MissionState): void {
    this.currentState = state;
  }

  /** Returns the current lifecycle state. */
  getState(): MissionState {
    return this.currentState;
  }

  /** Begins tracking a new mission. */
  beginMission(id: MissionId): void {
    this.currentMissionId = id;
    this.currentMissionStartedAt = Date.now();
    this.currentActionCount = 0;
  }

  /** Increments the action count for the current mission. */
  incrementActionCount(): void {
    this.currentActionCount++;
  }

  /** Returns the action count for the current mission. */
  getActionCount(): number {
    return this.currentActionCount;
  }

  /**
   * Records a completed mission in history and resets current state.
   * Enforces the retention limit by dropping oldest entries.
   */
  recordCompletion(
    outcome: MissionOutcome,
    verification: VerificationStatus,
    failureReason?: import('./types').FailureReason,
  ): void {
    if (this.currentMissionId && this.currentMissionStartedAt) {
      const entry: MissionHistoryEntry = {
        missionId: this.currentMissionId,
        outcome,
        verification,
        startedAt: this.currentMissionStartedAt,
        completedAt: Date.now(),
        actionCount: this.currentActionCount,
        failureReason,
      };
      this.history.push(entry);

      // Enforce retention limit — drop oldest
      while (this.history.length > this.retentionLimit) {
        this.history.shift();
      }
    }

    this.currentMissionId = null;
    this.currentMissionStartedAt = null;
    this.currentActionCount = 0;
  }

  /** Returns a snapshot of memory state (immutable copy). */
  getSnapshot(): MissionMemorySnapshot {
    return {
      currentState: this.currentState,
      recentMissions: [...this.history],
      entryCount: this.history.length,
      retentionLimit: this.retentionLimit,
    };
  }

  /** Returns recent mission history entries (newest first). */
  getRecentMissions(count: number = 10): readonly MissionHistoryEntry[] {
    return this.history.slice(-count).reverse();
  }

  /** Clears all history (used for testing or explicit reset). */
  clear(): void {
    this.history.length = 0;
    this.currentState = 'IDLE';
    this.currentMissionId = null;
    this.currentMissionStartedAt = null;
    this.currentActionCount = 0;
  }

  /** Returns the retention limit. */
  getRetentionLimit(): number {
    return this.retentionLimit;
  }
}

// Singleton instance
let _memory: MissionMemory | null = null;

export function getMissionMemory(): MissionMemory {
  if (!_memory) {
    _memory = new MissionMemory();
  }
  return _memory;
}
