import { describe, it, expect } from 'vitest';
import { HumanControlState } from '@/core/humanControl';
import type { HumanControlSignal } from '@/core/types';

describe('HumanControlState — precedence', () => {
  it('STOP has highest precedence', () => {
    expect(HumanControlState.resolvePrecedence('STOP', 'TAKE_CONTROL')).toBe('STOP');
    expect(HumanControlState.resolvePrecedence('STOP', 'PAUSE')).toBe('STOP');
    expect(HumanControlState.resolvePrecedence('STOP', 'NONE')).toBe('STOP');
  });

  it('TAKE_CONTROL > PAUSE', () => {
    expect(HumanControlState.resolvePrecedence('TAKE_CONTROL', 'PAUSE')).toBe('TAKE_CONTROL');
  });

  it('PAUSE > RESUME', () => {
    expect(HumanControlState.resolvePrecedence('PAUSE', 'RESUME')).toBe('PAUSE');
  });

  it('RESUME > NONE', () => {
    expect(HumanControlState.resolvePrecedence('RESUME', 'NONE')).toBe('RESUME');
  });

  it('returns correct precedence order', () => {
    const order = HumanControlState.getPrecedenceOrder();
    expect(order).toEqual(['STOP', 'TAKE_CONTROL', 'PAUSE', 'RESUME', 'NONE']);
  });
});

describe('HumanControlState — signal management', () => {
  it('starts with NONE', () => {
    const hc = new HumanControlState();
    expect(hc.getSignal()).toBe('NONE');
    expect(hc.isHalted()).toBe(false);
    expect(hc.isPaused()).toBe(false);
  });

  it('isHalted returns true for STOP', () => {
    const hc = new HumanControlState();
    hc.setSignal('STOP');
    expect(hc.isHalted()).toBe(true);
    expect(hc.isPaused()).toBe(false);
  });

  it('isHalted returns true for TAKE_CONTROL', () => {
    const hc = new HumanControlState();
    hc.setSignal('TAKE_CONTROL');
    expect(hc.isHalted()).toBe(true);
  });

  it('isPaused returns true for PAUSE only', () => {
    const hc = new HumanControlState();
    hc.setSignal('PAUSE');
    expect(hc.isPaused()).toBe(true);
    expect(hc.isHalted()).toBe(false);
  });

  it('clear resets to NONE', () => {
    const hc = new HumanControlState();
    hc.setSignal('STOP');
    hc.clear();
    expect(hc.getSignal()).toBe('NONE');
  });
});
