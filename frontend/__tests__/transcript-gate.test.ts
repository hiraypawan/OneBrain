import { describe, it, expect, vi } from 'vitest';
import { classifyResult, createFinalCollector, normalizeTranscript } from '../lib/transcript-gate';

describe('classifyResult', () => {
  it('accepts scored finals and drops scored noise', () => {
    expect(classifyResult(true, 0.92)).toBe('accept');
    expect(classifyResult(true, 0.3)).toBe('accept');
    expect(classifyResult(true, 0.12)).toBe('noise');
  });
  it('holds finals the engine did not score (Android reports 0)', () => {
    expect(classifyResult(true, 0)).toBe('hold');
    expect(classifyResult(true, undefined)).toBe('hold');
    expect(classifyResult(true, NaN)).toBe('hold');
    expect(classifyResult(true, null)).toBe('hold');
  });
  it('ignores interim results regardless of confidence', () => {
    expect(classifyResult(false, 0.99)).toBe('interim');
    expect(classifyResult(false, 0)).toBe('interim');
  });
});

describe('normalizeTranscript', () => {
  it('folds whitespace and case', () => {
    expect(normalizeTranscript('  Time  kya HAI ')).toBe('time kya hai');
  });
});

function harness(opts: Partial<Parameters<typeof createFinalCollector>[0]> = {}) {
  vi.useFakeTimers();
  const onAccept = vi.fn();
  const collector = createFinalCollector({ onAccept, ...opts });
  return { onAccept, collector };
}

describe('createFinalCollector', () => {
  it('desktop Chrome: a scored final is accepted immediately with its confidence', () => {
    const { onAccept, collector } = harness();
    expect(collector.push({ isFinal: false, transcript: 'time', confidence: 0 })).toBe('interim');
    expect(collector.push({ isFinal: true, transcript: 'time kya hai', confidence: 0.88 })).toBe('accept');
    expect(onAccept).toHaveBeenCalledWith('time kya hai', 0.88);
    vi.useRealTimers();
  });

  it('Android Chrome: confidence-0 finals are NOT dropped — accepted after the hold window', () => {
    const { onAccept, collector } = harness();
    expect(collector.push({ isFinal: true, transcript: 'time', confidence: 0 })).toBe('hold');
    expect(collector.push({ isFinal: true, transcript: 'time kya', confidence: 0 })).toBe('hold');
    expect(collector.push({ isFinal: true, transcript: 'time kya hai', confidence: 0 })).toBe('hold');
    expect(onAccept).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1199);
    expect(onAccept).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('time kya hai', undefined);
    vi.useRealTimers();
  });

  it('a scored final arriving during the hold replaces it and cancels the timer', () => {
    const { onAccept, collector } = harness();
    collector.push({ isFinal: true, transcript: 'time kya', confidence: 0 });
    expect(collector.push({ isFinal: true, transcript: 'time kya hai', confidence: 0.7 })).toBe('accept');
    vi.advanceTimersByTime(5000);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('time kya hai', 0.7);
    vi.useRealTimers();
  });

  it('flush() accepts a held transcript immediately (recognizer ended)', () => {
    const { onAccept, collector } = harness();
    collector.push({ isFinal: true, transcript: 'hello', confidence: 0 });
    expect(collector.pending()).toBe('hello');
    expect(collector.flush()).toBe(true);
    expect(onAccept).toHaveBeenCalledWith('hello', undefined);
    expect(collector.pending()).toBeNull();
    expect(collector.flush()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(onAccept).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('reset() discards a held transcript without accepting it', () => {
    const { onAccept, collector } = harness();
    collector.push({ isFinal: true, transcript: 'hello', confidence: 0 });
    collector.reset();
    vi.advanceTimersByTime(5000);
    expect(onAccept).not.toHaveBeenCalled();
    expect(collector.pending()).toBeNull();
    vi.useRealTimers();
  });

  it('dedupes the same final re-fired inside the window, in both scored and unscored form', () => {
    const { onAccept, collector } = harness();
    expect(collector.push({ isFinal: true, transcript: 'hello', confidence: 0.9 })).toBe('accept');
    expect(collector.push({ isFinal: true, transcript: 'Hello ', confidence: 0.9 })).toBe('duplicate');
    expect(collector.push({ isFinal: true, transcript: 'hello', confidence: 0 })).toBe('duplicate');
    vi.advanceTimersByTime(3000);
    expect(collector.push({ isFinal: true, transcript: 'hello', confidence: 0.9 })).toBe('accept');
    expect(onAccept).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('drops scored noise and empty finals', () => {
    const { onAccept, collector } = harness();
    expect(collector.push({ isFinal: true, transcript: 'tv bleed', confidence: 0.1 })).toBe('noise');
    expect(collector.push({ isFinal: true, transcript: '   ', confidence: 0 })).toBe('empty');
    vi.advanceTimersByTime(5000);
    expect(onAccept).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('honours custom hold/dedupe windows and an injected clock', () => {
    let t = 1000;
    const onAccept = vi.fn();
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const collector = createFinalCollector({
      onAccept,
      holdMs: 200,
      dedupeMs: 500,
      now: () => t,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => {},
    });
    collector.push({ isFinal: true, transcript: 'ok', confidence: 0 });
    expect(timers[0].ms).toBe(200);
    timers[0].fn();
    expect(onAccept).toHaveBeenCalledWith('ok', undefined);
    t += 400;
    expect(collector.push({ isFinal: true, transcript: 'ok', confidence: 0.9 })).toBe('duplicate');
    t += 200;
    expect(collector.push({ isFinal: true, transcript: 'ok', confidence: 0.9 })).toBe('accept');
  });
});

import { createUtteranceAssembler, mergeSegment, clampSilenceMs } from '../lib/transcript-gate';

function asm(opts: Record<string, unknown> = {}) {
  let t = 0;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let id = 0;
  const onAccept = vi.fn();
  const a = createUtteranceAssembler({
    onAccept,
    silenceMs: 1600,
    now: () => t,
    setTimer: (fn, ms) => { timers.push({ fn, at: t + ms, id: ++id }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    ...opts,
  });
  const advance = (ms: number) => {
    t += ms;
    for (const x of [...timers].sort((p, q) => p.at - q.at)) if (x.at <= t) { timers.splice(timers.indexOf(x), 1); x.fn(); }
  };
  return { a, onAccept, advance };
}

describe('createUtteranceAssembler — hears the whole sentence', () => {
  it('keeps listening through a mid-sentence pause', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: true, transcript: 'remind me to call mom', confidence: 0.9 });
    advance(900); // breath
    expect(onAccept).not.toHaveBeenCalled();
    a.push({ isFinal: false, transcript: 'tomorrow' });
    advance(500);
    a.push({ isFinal: true, transcript: 'tomorrow at 6', confidence: 0.85 });
    advance(1599);
    expect(onAccept).not.toHaveBeenCalled();
    advance(1);
    expect(onAccept).toHaveBeenCalledWith('remind me to call mom tomorrow at 6', 0.85);
  });
  it('interim words keep the turn open', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: true, transcript: 'add milk', confidence: 0.9 });
    for (let i = 0; i < 5; i++) { advance(1000); a.push({ isFinal: false, transcript: 'and eggs and bread'.slice(0, 4 + i * 3) }); }
    expect(onAccept).not.toHaveBeenCalled();
    advance(1600);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
  it('sends an unfinished trailing interim instead of dropping it', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: true, transcript: 'what is', confidence: 0.9 });
    a.push({ isFinal: false, transcript: 'the weather' });
    advance(1600);
    expect(onAccept).toHaveBeenCalledWith('what is the weather', 0.9);
  });
  it('handles Android cumulative finals without repeating words', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: true, transcript: 'kharcha 200', confidence: 0 });
    a.push({ isFinal: true, transcript: 'kharcha 200 chai', confidence: 0 });
    a.push({ isFinal: true, transcript: 'chai', confidence: 0 });
    advance(1600);
    expect(onAccept).toHaveBeenCalledWith('kharcha 200 chai', undefined);
  });
  it('drops low-confidence bleed but keeps real speech', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: true, transcript: 'tv noise', confidence: 0.1 });
    advance(3000);
    expect(onAccept).not.toHaveBeenCalled();
  });
  it('Send now delivers immediately and flush works on session end', () => {
    const { a, onAccept } = asm();
    a.push({ isFinal: false, transcript: 'stop the music' });
    expect(a.preview()).toBe('stop the music');
    expect(a.sendNow()).toBe(true);
    expect(onAccept).toHaveBeenCalledWith('stop the music', undefined);
    expect(a.sendNow()).toBe(false);
  });
  it('caps a never-ending turn', () => {
    const { a, onAccept, advance } = asm({ maxTurnMs: 5000 });
    for (let i = 0; i < 10; i++) { a.push({ isFinal: false, transcript: `word ${i}` }); advance(700); }
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
  it('merges and clamps helpers', () => {
    expect(mergeSegment('a b', 'b')).toBe('a b');
    expect(mergeSegment('', ' hi ')).toBe('hi');
    expect(clampSilenceMs(100)).toBe(700);
    expect(clampSilenceMs('x')).toBe(1600);
  });
});
