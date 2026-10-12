import { describe, it, expect } from 'vitest';
import { MissionStateMachine } from '@/core/missionStateMachine';
import type { MissionState } from '@/core/types';

describe('MissionStateMachine — valid transitions', () => {
  it('starts at IDLE', () => {
    const sm = new MissionStateMachine();
    expect(sm.getState()).toBe('IDLE');
  });

  it('follows the full lifecycle', () => {
    const sm = new MissionStateMachine();
    const phases: MissionState[] = [
      'UNDERSTAND',
      'SCOPE_CHECK',
      'OBSERVE',
      'PLAN',
      'AUTHORIZATION_CHECK',
      'ACT',
      'VERIFY',
      'REPORT',
      'COMPLETED',
    ];
    for (const phase of phases) {
      expect(sm.canTransitionTo(phase)).toBe(true);
      sm.transitionTo(phase);
    }
    expect(sm.getState()).toBe('COMPLETED');
    expect(sm.isTerminal()).toBe(true);
  });

  it('allows VERIFY → ACT (re-act loop)', () => {
    const sm = new MissionStateMachine();
    for (const s of ['UNDERSTAND', 'SCOPE_CHECK', 'OBSERVE', 'PLAN', 'AUTHORIZATION_CHECK', 'ACT', 'VERIFY'] as MissionState[]) {
      sm.transitionTo(s);
    }
    expect(sm.canTransitionTo('ACT')).toBe(true);
    sm.transitionTo('ACT');
    expect(sm.getState()).toBe('ACT');
  });

  it('allows FAILED → IDLE reset', () => {
    const sm = new MissionStateMachine();
    sm.transitionTo('UNDERSTAND');
    sm.fail();
    expect(sm.getState()).toBe('FAILED');
    sm.reset();
    expect(sm.getState()).toBe('IDLE');
  });

  it('allows CANCELLED → IDLE reset', () => {
    const sm = new MissionStateMachine();
    sm.transitionTo('UNDERSTAND');
    sm.cancel();
    expect(sm.getState()).toBe('CANCELLED');
    sm.reset();
    expect(sm.getState()).toBe('IDLE');
  });
});

describe('MissionStateMachine — invalid transitions', () => {
  it('rejects IDLE → ACT (skipping phases)', () => {
    const sm = new MissionStateMachine();
    expect(sm.canTransitionTo('ACT')).toBe(false);
    expect(() => sm.transitionTo('ACT')).toThrow('Invalid state transition');
  });

  it('rejects IDLE → COMPLETED', () => {
    const sm = new MissionStateMachine();
    expect(sm.canTransitionTo('COMPLETED')).toBe(false);
    expect(() => sm.transitionTo('COMPLETED')).toThrow();
  });

  it('rejects PLAN → ACT (must pass AUTHORIZATION_CHECK)', () => {
    const sm = new MissionStateMachine();
    sm.transitionTo('UNDERSTAND');
    sm.transitionTo('SCOPE_CHECK');
    sm.transitionTo('OBSERVE');
    sm.transitionTo('PLAN');
    expect(sm.canTransitionTo('ACT')).toBe(false);
  });

  it('rejects transition from terminal COMPLETED', () => {
    const sm = new MissionStateMachine();
    for (const s of ['UNDERSTAND', 'SCOPE_CHECK', 'OBSERVE', 'PLAN', 'AUTHORIZATION_CHECK', 'ACT', 'VERIFY', 'REPORT', 'COMPLETED'] as MissionState[]) {
      sm.transitionTo(s);
    }
    expect(sm.canTransitionTo('IDLE')).toBe(false);
    expect(sm.canTransitionTo('UNDERSTAND')).toBe(false);
  });

  it('rejects reset from non-terminal state', () => {
    const sm = new MissionStateMachine();
    sm.transitionTo('UNDERSTAND');
    expect(() => sm.reset()).toThrow('Cannot reset from non-terminal');
  });

  it('rejects cancel from terminal state', () => {
    const sm = new MissionStateMachine();
    sm.transitionTo('UNDERSTAND');
    sm.fail();
    expect(sm.cancel()).toBe(false);
  });
});

describe('MissionStateMachine — cancellation', () => {
  it('allows cancel from any non-terminal state', () => {
    const sm = new MissionStateMachine();
    sm.transitionTo('UNDERSTAND');
    sm.transitionTo('SCOPE_CHECK');
    expect(sm.cancel()).toBe(true);
    expect(sm.getState()).toBe('CANCELLED');
    expect(sm.isTerminal()).toBe(true);
  });

  it('allows cancel from ACT state', () => {
    const sm = new MissionStateMachine();
    for (const s of ['UNDERSTAND', 'SCOPE_CHECK', 'OBSERVE', 'PLAN', 'AUTHORIZATION_CHECK', 'ACT'] as MissionState[]) {
      sm.transitionTo(s);
    }
    expect(sm.cancel()).toBe(true);
    expect(sm.getState()).toBe('CANCELLED');
  });
});
