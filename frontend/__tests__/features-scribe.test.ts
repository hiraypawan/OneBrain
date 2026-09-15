import { describe, it, expect } from 'vitest';
import { detectScribeIntent, extractMinutes, minutesToTasks, spokenMinutes } from '../lib/scribe';

describe('detectScribeIntent', () => {
  it('detects scribe requests', () => {
    expect(detectScribeIntent('scribe: Rahul will send the quote by Friday.')).toBe(true);
    expect(detectScribeIntent('meeting ki summary banao')).toBe(true);
    expect(detectScribeIntent('hello there')).toBe(false);
  });
});

describe('extractMinutes', () => {
  it('extracts decisions, owners, deadlines, questions', () => {
    const m = extractMinutes(
      'We decided to launch on Monday. Rahul will send the quote by Friday. What about the budget approval?',
    );
    expect(m.decisions).toHaveLength(1);
    expect(m.owners[0]).toMatchObject({ who: 'Rahul' });
    expect(m.deadlines).toHaveLength(1);
    expect(m.questions).toHaveLength(1);
  });
  it('is honest when thin', () => {
    const m = extractMinutes('Hmm. Okay. Nice.');
    expect(m.sentenceCount).toBe(3);
    expect(minutesToTasks(m)).toHaveLength(0);
  });
});

describe('minutesToTasks + spoken', () => {
  it('drafts tasks and speaks a summary', () => {
    const m = extractMinutes('Rahul will send the quote by Friday.');
    expect(minutesToTasks(m)[0]).toMatch(/Rahul/);
    expect(spokenMinutes(m)).toMatch(/Minutes ready/);
    expect(spokenMinutes(extractMinutes(''))).toMatch(/could not hear/);
  });
});
