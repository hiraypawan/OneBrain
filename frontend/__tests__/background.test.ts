import { describe, it, expect } from 'vitest';
import { resolveBgState, bgStateLabel, pushBgEvent, formatBgEvent } from '../lib/background';

describe('resolveBgState', () => {
  it('is foreground when visible and not frozen', () => {
    expect(resolveBgState({ visible: true, frozen: false })).toBe('foreground');
  });

  it('prefers frozen over hidden', () => {
    expect(resolveBgState({ visible: false, frozen: true })).toBe('frozen');
  });

  it('is hidden when backgrounded but alive', () => {
    expect(resolveBgState({ visible: false, frozen: false })).toBe('hidden');
  });
});

describe('bgStateLabel', () => {
  it('tells iPhone users the live truth, not a fixed verdict', () => {
    expect(bgStateLabel('hidden', true)).toMatch(/reopen to be sure/i);
    expect(bgStateLabel('frozen', true)).toMatch(/reopen to resume/i);
  });

  it('is honest about Android background limits', () => {
    expect(bgStateLabel('hidden', false)).toMatch(/briefly/);
    expect(bgStateLabel('foreground', false)).toMatch(/mic live/);
  });
});

describe('flight recorder', () => {
  it('caps the log as a ring buffer', () => {
    let log: any[] = [];
    for (let i = 0; i < 100; i++) {
      log = pushBgEvent(log, { elapsed: i * 1000, kind: 'tick' }, 80);
    }
    expect(log).toHaveLength(80);
    expect(log[0].elapsed).toBe(20000);
  });

  it('formats events with elapsed seconds', () => {
    expect(formatBgEvent({ t: 0, elapsed: 1500, kind: 'mic-muted' })).toBe('+1.5s mic-muted');
    expect(formatBgEvent({ t: 0, elapsed: 2000, kind: 'heard', detail: 'hello' })).toBe('+2.0s heard (hello)');
  });
});
