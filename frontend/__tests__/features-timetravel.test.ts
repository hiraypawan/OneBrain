import { describe, it, expect } from 'vitest';
import {
  parseDateRef, detectRecallIntent, summarizeRange, formatCitation,
} from '../lib/timetravel';

// Tuesday 15 Sep 2026 (matches "today" for stable weekday math).
const NOW = new Date('2026-09-15T10:00:00');

describe('parseDateRef', () => {
  it('resolves today/yesterday with past bias', () => {
    const t = parseDateRef('what did I ask today', NOW, true)!;
    expect(t.label).toMatch(/today/);
    const y = parseDateRef('kal maine kya poocha', NOW, true)!;
    expect(new Date(y.start).getDate()).toBe(14);
  });
  it('treats kal as tomorrow with future bias', () => {
    const k = parseDateRef('kal bhej dunga', NOW, false)!;
    expect(new Date(k.start).getDate()).toBe(16);
  });
  it('resolves weekday names', () => {
    const tue = parseDateRef('last Tuesday maine kya poocha tha', NOW, true)!;
    expect(new Date(tue.start).getDay()).toBe(2);
    expect(new Date(tue.start).getDate()).toBe(8);
    const hindi = parseDateRef('pichle mangalvar kya hua', NOW, true)!;
    expect(new Date(hindi.start).getDate()).toBe(8);
  });
  it('resolves weeks and months', () => {
    expect(parseDateRef('summarize my week', NOW, true)?.label).toBe('this week');
    expect(parseDateRef('pichle hafte kya kiya', NOW, true)?.label).toBe('last week');
    expect(parseDateRef('last month summary', NOW, true)?.label).toBe('last month');
  });
  it('resolves explicit dates', () => {
    const d = parseDateRef('what did I do on 15 august', NOW, true)!;
    const dt = new Date(d.start);
    expect(dt.getMonth()).toBe(7);
    expect(dt.getDate()).toBe(15);
  });
  it('returns null without a date', () => {
    expect(parseDateRef('what is the time', NOW, true)).toBeNull();
  });
});

describe('detectRecallIntent', () => {
  it('detects recall questions', () => {
    expect(detectRecallIntent('last Tuesday maine kya poocha tha?')).toBe('day');
    expect(detectRecallIntent('summarize my week')).toBe('week');
    expect(detectRecallIntent('summarize my month')).toBe('month');
    expect(detectRecallIntent('what did we decide about Goa?')).toBe('decisions');
    expect(detectRecallIntent('what did I ask?')).toBe('lastAsked');
  });
  it('ignores fresh questions', () => {
    expect(detectRecallIntent('what is the capital of France')).toBeNull();
    expect(detectRecallIntent('20 pushups kar liye')).toBeNull();
  });
});

describe('summarizeRange', () => {
  it('summarizes honestly when empty', () => {
    const range = parseDateRef('kal', NOW, true)!;
    const s = summarizeRange([], [], range);
    expect(s.empty).toBe(true);
    expect(s.spoken).toMatch(/don't have anything/);
  });
  it('counts questions, decisions and completions', () => {
    const range = parseDateRef('aaj', NOW, true)!;
    const s = summarizeRange(
      [
        { role: 'user', content: 'what is UPI?', createdAt: NOW.getTime() - 1000 },
        { role: 'assistant', content: 'UPI is…', createdAt: NOW.getTime() - 900 },
      ],
      [
        { kind: 'decision', title: 'Goa in December', createdAt: NOW.getTime() - 800 },
        { kind: 'task', title: 'Pay bill', status: 'done', createdAt: NOW.getTime() - 700, updatedAt: NOW.getTime() - 600 },
      ],
      range,
    );
    expect(s.empty).toBe(false);
    expect(s.asked).toHaveLength(1);
    expect(s.decisions).toEqual(['Goa in December']);
    expect(s.done).toEqual(['Pay bill']);
  });
  it('formats citations', () => {
    expect(formatCitation(NOW.getTime())).toMatch(/Sep/);
  });
});
