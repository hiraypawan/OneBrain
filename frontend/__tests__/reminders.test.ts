import { describe, it, expect } from 'vitest';
import { dueReminders, markFired, localDayKey, parseReminderIntent } from '../lib/reminders';
import type { Reminder } from '../lib/types';

const mk = (over: Partial<Reminder> = {}): Reminder => ({
  id: 'r1', title: 'Test', time: '09:00', active: true, ...over,
});

describe('dueReminders', () => {
  it('fires a daily reminder once its time passes', () => {
    const now = new Date('2026-09-06T09:30:00');
    expect(dueReminders([mk()], now)).toHaveLength(1);
  });

  it('does not fire before its time', () => {
    const now = new Date('2026-09-06T08:00:00');
    expect(dueReminders([mk()], now)).toHaveLength(0);
  });

  it('does not fire twice on the same day', () => {
    const now = new Date('2026-09-06T10:00:00');
    expect(dueReminders([mk({ lastFired: '2026-09-06' })], now)).toHaveLength(0);
  });

  it('fires a one-time reminder after its datetime, then never again', () => {
    const r = mk({ date: '2026-09-06', time: '09:00' });
    expect(dueReminders([r], new Date('2026-09-06T09:01:00'))).toHaveLength(1);
    expect(dueReminders([r], new Date('2026-09-05T09:01:00'))).toHaveLength(0);
    const fired = { ...r, ...markFired(r) };
    expect(fired.active).toBe(false);
    expect(dueReminders([fired], new Date('2026-09-07T09:01:00'))).toHaveLength(0);
  });

  it('marks daily reminders with today so they refire tomorrow', () => {
    const now = new Date('2026-09-06T09:30:00');
    const patch = markFired(mk(), now);
    expect(patch.lastFired).toBe(localDayKey(now));
    expect(dueReminders([{ ...mk(), ...patch }], now)).toHaveLength(0);
  });
});

describe('parseReminderIntent', () => {
  const noon = new Date('2026-09-06T12:00:00');

  it('parses English requests', () => {
    expect(parseReminderIntent('remind me to call mom at 6pm', noon)).toEqual({
      title: 'Call mom', time: '18:00',
    });
    expect(parseReminderIntent('remind me in 10 minutes', noon)?.time).toBe('12:10');
  });

  it('parses Hindi requests with day periods', () => {
    expect(parseReminderIntent('mujhe dawai yaad dilao subah 9 baje', noon)).toEqual({
      title: 'Dawai', time: '09:00',
    });
    expect(parseReminderIntent('remind me meeting shaam 5 baje', noon)?.time).toBe('17:00');
  });

  it('handles tomorrow and midnight crossing', () => {
    expect(parseReminderIntent('kal 9 baje yaad dilao', noon)).toMatchObject({ time: '09:00', date: '2026-09-07' });
    const late = new Date('2026-09-06T23:50:00');
    expect(parseReminderIntent('remind me in 20 minutes', late)).toMatchObject({ date: '2026-09-07' });
  });

  it('returns null for non-reminders', () => {
    expect(parseReminderIntent('what time is it', noon)).toBeNull();
    expect(parseReminderIntent('remember the milk', noon)).toBeNull();
  });
});
