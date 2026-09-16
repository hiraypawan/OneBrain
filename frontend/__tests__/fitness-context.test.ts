import { describe, it, expect } from 'vitest';
import { formatLogsForContext, type FitnessLog } from '../lib/fitness';

const HOUR = 3600000;
const log = (over: Partial<FitnessLog> = {}): FitnessLog => ({
  id: Math.random().toString(), kind: 'workout', label: 'x', createdAt: Date.now(), source: 'voice', ...over,
});

describe('formatLogsForContext', () => {
  it('returns empty string when nothing is logged', () => {
    expect(formatLogsForContext([])).toBe('');
  });

  it('lists recent logs newest-first with kind-specific amounts', () => {
    const now = Date.now();
    const out = formatLogsForContext([
      log({ kind: 'expense', label: 'Spent ₹200 — chai', amount: 200, qty: 200, unit: 'INR', createdAt: now - 2 * HOUR }),
      log({ kind: 'food', label: '2 roti', qty: 2, unit: 'pc', calories: 140, createdAt: now - HOUR }),
    ]);
    expect(out).toContain('Recently logged on this device');
    expect(out).toContain('Spent ₹200 — chai');
    expect(out).toContain('₹200');
    expect(out).toContain('~140kcal');
    // Newest (food) comes before the older expense.
    expect(out.indexOf('2 roti')).toBeLessThan(out.indexOf('chai'));
  });

  it('respects the limit so AI context never overflows', () => {
    const logs = Array.from({ length: 30 }, (_, i) =>
      log({ label: `item-${i}`, createdAt: Date.now() - i * HOUR }));
    const out = formatLogsForContext(logs, 5);
    expect(out.split('\n').length).toBe(1 + 5); // header + 5 lines
    expect(out).toContain('item-0');
    expect(out).not.toContain('item-29');
  });
});
