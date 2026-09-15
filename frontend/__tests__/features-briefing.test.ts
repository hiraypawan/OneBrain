import { describe, it, expect } from 'vitest';
import {
  detectCommitment, detectBriefIntent, compileMorningBrief, compileCloseDay,
  forgettingScan, followupRadar, moneyDue, todayKey, type BriefData,
} from '../lib/briefing';

const data = (over: Partial<BriefData> = {}): BriefData => ({
  reminders: [], openTasks: [], overdueTasks: [], doneToday: [], commitments: [],
  moneyDue: [], nightCount: 0,
  fitness: { workoutsLast3Days: 0, spendToday: 0 }, ...over,
});

describe('detectCommitment', () => {
  it('sniffs promises', () => {
    expect(detectCommitment("I'll send the quote by Tuesday")?.text).toMatch(/quote/);
    expect(detectCommitment('kal pakka bhej dunga report')?.dueKey).toBeTruthy();
    expect(detectCommitment('I promise to call mom tomorrow')).toBeTruthy();
  });
  it('ignores questions and chat', () => {
    expect(detectCommitment('will you send the quote?')).toBeNull();
    expect(detectCommitment('what is the time?')).toBeNull();
    expect(detectCommitment('ok')).toBeNull();
  });
});

describe('detectBriefIntent', () => {
  it('routes brief commands', () => {
    expect(detectBriefIntent('morning brief')).toBe('morning');
    expect(detectBriefIntent('aaj ka plan batao')).toBe('morning');
    expect(detectBriefIntent('close my day')).toBe('close');
    expect(detectBriefIntent('what am i forgetting')).toBe('forgetting');
    expect(detectBriefIntent('follow ups')).toBe('followups');
    expect(detectBriefIntent('money due batao')).toBe('money');
    expect(detectBriefIntent('tell me a joke')).toBeNull();
  });
});

describe('compilers', () => {
  it('compiles a morning brief', () => {
    const r = compileMorningBrief(data({
      reminders: [{ title: 'Dawai', time: '09:00' }],
      openTasks: [{ title: 'Proposal' }],
      overdueTasks: [{ title: 'Bill' }],
      commitments: [{ id: '1', text: "I'll call mom", dueKey: null, createdAt: 1, done: false }],
      userName: 'Pawan',
    }));
    expect(r.spoken).toMatch(/Pawan/);
    expect(r.sections.length).toBeGreaterThan(2);
  });
  it('closes the day', () => {
    const r = compileCloseDay(data({ doneToday: ['Gym', 'Report'], openTasks: [{ title: 'Call bank' }] }));
    expect(r.spoken).toMatch(/finished 2/);
    expect(r.spoken).toMatch(/Call bank/);
  });
  it('scans forgetting', () => {
    const r = forgettingScan(data({ overdueTasks: [{ title: 'Bill' }] }));
    expect(r.top[0]).toMatch(/Overdue/);
    expect(forgettingScan(data()).top).toHaveLength(0);
  });
  it('runs follow-up radar', () => {
    const past = '2020-01-01';
    const r = followupRadar([
      { id: '1', text: 'send quote', dueKey: past, createdAt: 1, done: false },
      { id: '2', text: 'call mom', dueKey: null, createdAt: 1, done: true },
    ]);
    expect(r.overdue).toHaveLength(1);
    expect(r.spoken).toMatch(/overdue/);
  });
  it('guards money', () => {
    const dues = moneyDue(
      [{ title: 'Pay electricity bill', time: '18:00' }, { title: 'Dawai', time: '09:00' }],
      [{ title: 'Netflix renewal', kind: 'note', status: 'active' }],
    );
    expect(dues.map((d) => d.title)).toContain('Pay electricity bill');
    expect(dues.map((d) => d.title)).toContain('Netflix renewal');
  });
  it('makes day keys', () => {
    expect(todayKey(new Date('2026-09-15T10:00:00'))).toBe('2026-09-15');
  });
});
