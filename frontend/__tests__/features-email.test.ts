import { describe, it, expect } from 'vitest';
import {
  detectEmailIntent, extractEmailSlots, missingSlots, slotQuestion,
  fillSlotFromAnswer, buildDraft, retone, mailtoHref,
} from '../lib/email';

describe('detectEmailIntent', () => {
  it('detects leave applications', () => {
    expect(detectEmailIntent('meri leave application likh do')).toBe('leave');
    expect(detectEmailIntent('sick leave chahiye, bukhar hai')).toBe('sick-leave');
    expect(detectEmailIntent('do din ki chutti ka mail likh do')).toBe('leave');
  });
  it('detects other kinds', () => {
    expect(detectEmailIntent('resignation letter likh do')).toBe('resignation');
    expect(detectEmailIntent('follow up mail likho')).toBe('followup');
    expect(detectEmailIntent('thank you mail bana do')).toBe('thanks');
    expect(detectEmailIntent('ek mail draft karo')).toBe('generic');
  });
  it('ignores non-email text', () => {
    expect(detectEmailIntent('20 pushups kar liye')).toBeNull();
    expect(detectEmailIntent('mausam kaisa hai')).toBeNull();
  });
});

describe('extractEmailSlots', () => {
  it('pulls slots from the first utterance', () => {
    const s = extractEmailSlots('meri 3 din ki leave application manager ko, kal se, bukhar hai', new Date('2026-09-15T10:00:00'));
    expect(s.days).toBe(3);
    expect(s.to).toBe('Manager');
    expect(s.reason).toBe('health');
    expect(s.fromDate).toBeTruthy();
  });
  it('captures email addresses', () => {
    const s = extractEmailSlots('mail priya@company.com ko follow up');
    expect(s.toEmail).toBe('priya@company.com');
  });
});

describe('slot flow', () => {
  it('lists missing slots and asks conversationally', () => {
    const miss = missingSlots({ kind: 'leave', tone: 'formal' });
    expect(miss).toEqual(['to', 'days', 'fromDate', 'reason']);
    expect(slotQuestion('days', 'leave')).toMatch(/Kitne din/);
    expect(slotQuestion('to', 'leave')).toMatch(/Kisko/);
  });
  it('fills slots from answers', () => {
    expect(fillSlotFromAnswer('to', 'mere manager Ramesh'))?.toMatchObject({ to: 'Ramesh' });
    expect(fillSlotFromAnswer('days', 'teen din'))?.toMatchObject({ days: 3 });
    expect(fillSlotFromAnswer('days', 'dozen')).toBeNull();
    const d = fillSlotFromAnswer('fromDate', 'kal se', new Date('2026-09-15T10:00:00'));
    expect(d?.fromDate).toBeTruthy();
    expect(fillSlotFromAnswer('reason', 'bukhar hai')?.reason).toBe('health');
    expect(fillSlotFromAnswer('context', 'ok')).toBeNull();
  });
});

describe('buildDraft', () => {
  it('builds a formal leave application with date range', () => {
    const d = buildDraft(
      { kind: 'leave', tone: 'formal', to: 'Ramesh', days: 2, fromDate: new Date('2026-09-16T00:00:00').toISOString(), reason: 'health' },
      'Pawan',
    );
    expect(d.subject).toMatch(/Leave Application/);
    expect(d.body).toMatch(/Respected Ramesh/);
    expect(d.body).toMatch(/Pawan/);
    expect(d.body).toMatch(/unwell/);
  });
  it('retunes tone without losing facts', () => {
    const slots = { kind: 'leave' as const, tone: 'formal' as const, to: 'Ramesh', days: 1, reason: 'personal work' };
    const formal = buildDraft(slots, 'Pawan');
    const hinglish = retone(formal, 'hinglish', slots, 'Pawan');
    expect(hinglish.body).toMatch(/Namaste/);
    expect(hinglish.subject).toBe(formal.subject);
  });
  it('builds mailto deep-links', () => {
    const d = buildDraft({ kind: 'generic', tone: 'formal', context: 'meeting tomorrow' }, 'Pawan');
    expect(mailtoHref(d)).toMatch(/^mailto:/);
    expect(mailtoHref(d)).toContain('subject=');
    expect(mailtoHref(d)).toContain('body=');
  });
});
