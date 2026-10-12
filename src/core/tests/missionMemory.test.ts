import { describe, it, expect, beforeEach } from 'vitest';
import { MissionMemory } from '@/core/missionMemory';

describe('MissionMemory — state tracking', () => {
  let mem: MissionMemory;

  beforeEach(() => {
    mem = new MissionMemory(50);
  });

  it('starts at IDLE state', () => {
    expect(mem.getState()).toBe('IDLE');
  });

  it('sets and returns state', () => {
    mem.setState('PLAN');
    expect(mem.getState()).toBe('PLAN');
  });

  it('tracks action count', () => {
    mem.beginMission('m1');
    mem.incrementActionCount();
    mem.incrementActionCount();
    mem.incrementActionCount();
    expect(mem.getActionCount()).toBe(3);
  });
});

describe('MissionMemory — retention limits', () => {
  it('enforces retention limit', () => {
    const limit = 5;
    const mem = new MissionMemory(limit);
    for (let i = 0; i < 10; i++) {
      mem.beginMission(`m${i}`);
      mem.recordCompletion('SUCCESS', 'VERIFIED');
    }
    const snap = mem.getSnapshot();
    expect(snap.entryCount).toBe(limit);
    expect(snap.retentionLimit).toBe(limit);
  });

  it('keeps newest entries when over limit', () => {
    const mem = new MissionMemory(3);
    for (let i = 0; i < 5; i++) {
      mem.beginMission(`m${i}`);
      mem.recordCompletion('SUCCESS', 'VERIFIED');
    }
    const recent = mem.getRecentMissions(10);
    expect(recent.length).toBe(3);
    expect(recent[0].missionId).toBe('m4');
    expect(recent[2].missionId).toBe('m2');
  });

  it('rejects retention limit < 1', () => {
    expect(() => new MissionMemory(0)).toThrow('Retention limit must be at least 1');
  });
});

describe('MissionMemory — completion recording', () => {
  it('records success with verification', () => {
    const mem = new MissionMemory(10);
    mem.beginMission('m1');
    mem.incrementActionCount();
    mem.recordCompletion('SUCCESS', 'VERIFIED');
    const recent = mem.getRecentMissions(1);
    expect(recent[0].missionId).toBe('m1');
    expect(recent[0].outcome).toBe('SUCCESS');
    expect(recent[0].verification).toBe('VERIFIED');
    expect(recent[0].actionCount).toBe(1);
  });

  it('records failure with reason', () => {
    const mem = new MissionMemory(10);
    mem.beginMission('m2');
    mem.recordCompletion('FAILURE', 'FAILED', 'authorization_denied');
    const recent = mem.getRecentMissions(1);
    expect(recent[0].outcome).toBe('FAILURE');
    expect(recent[0].failureReason).toBe('authorization_denied');
  });

  it('records cancellation', () => {
    const mem = new MissionMemory(10);
    mem.beginMission('m3');
    mem.recordCompletion('CANCELLED', 'UNVERIFIED', 'cancelled');
    const recent = mem.getRecentMissions(1);
    expect(recent[0].outcome).toBe('CANCELLED');
  });
});

describe('MissionMemory — clear', () => {
  it('clears all history and resets state', () => {
    const mem = new MissionMemory(10);
    mem.beginMission('m1');
    mem.recordCompletion('SUCCESS', 'VERIFIED');
    mem.setState('ACT');
    mem.clear();
    expect(mem.getState()).toBe('IDLE');
    expect(mem.getSnapshot().entryCount).toBe(0);
  });
});
