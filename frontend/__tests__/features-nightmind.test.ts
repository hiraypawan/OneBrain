import { describe, it, expect } from 'vitest';
import {
  classifyNightNote, detectNightIntent, compileMorningDigest, lastNightWindow,
  distressCheck, SUPPORTIVE_REPLY, isNightHour,
} from '../lib/nightmind';

describe('classifyNightNote', () => {
  it('tags worries, ideas, dreams', () => {
    expect(classifyNightNote('kal presentation ka tension hai')).toContain('worry');
    expect(classifyNightNote('ek startup idea aaya')).toContain('idea');
    expect(classifyNightNote('ajeeb sapna dekha')).toContain('dream');
    expect(classifyNightNote('aaj ka din achha tha, shukr hai')).toContain('gratitude');
  });
});

describe('detectNightIntent', () => {
  it('detects explicit night notes', () => {
    expect(detectNightIntent('night note: neend nahi aa rahi')).toBe(true);
    expect(detectNightIntent('hello there')).toBe(false);
  });
});

describe('distress', () => {
  it('catches crisis language', () => {
    expect(distressCheck('jeene ka mann nahi kar raha')).toBe(true);
    expect(distressCheck('I want to kill myself')).toBe(true);
    expect(distressCheck('aaj thak gaya hun')).toBe(false);
    expect(SUPPORTIVE_REPLY).toMatch(/14416/);
  });
});

describe('compileMorningDigest', () => {
  it('reframes worries and drafts tasks', () => {
    const d = compileMorningDigest([
      { id: '1', text: 'kal presentation ka tension', at: Date.now(), tags: ['worry'] },
      { id: '2', text: 'nayi app ka idea', at: Date.now(), tags: ['idea'] },
    ]);
    expect(d.empty).toBe(false);
    expect(d.reframes).toHaveLength(1);
    expect(d.reframes[0].reframe).toMatch(/slides/);
    expect(d.taskDrafts).toHaveLength(1);
  });
  it('is honest when empty', () => {
    expect(compileMorningDigest([]).empty).toBe(true);
  });
});

describe('windows and hours', () => {
  it('computes last-night window', () => {
    const w = lastNightWindow(new Date('2026-09-15T08:00:00'));
    expect(w.end - w.start).toBe(8 * 3600000);
  });
  it('flags night hours', () => {
    expect(isNightHour(new Date('2026-09-15T02:00:00'))).toBe(true);
    expect(isNightHour(new Date('2026-09-15T14:00:00'))).toBe(false);
  });
});
