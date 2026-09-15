import { describe, it, expect } from 'vitest';
import {
  detectPersonaIntent, personaById, personaPrompt, offlineTutorCorrections,
  formatCorrections, offlineCoachReply, extractModeNote, PERSONAS,
} from '../lib/personas';

describe('detectPersonaIntent', () => {
  it('enters personas', () => {
    expect(detectPersonaIntent('be my strict gym coach')).toEqual({ action: 'enter', id: 'gym-coach' });
    expect(detectPersonaIntent('UPSC interview lo')).toEqual({ action: 'enter', id: 'upsc-interviewer' });
    expect(detectPersonaIntent('correct my English')).toEqual({ action: 'enter', id: 'english-tutor' });
    expect(detectPersonaIntent('quiz me on history')).toEqual({ action: 'enter', id: 'study-buddy' });
  });
  it('exits modes', () => {
    expect(detectPersonaIntent('exit mode')).toEqual({ action: 'exit' });
    expect(detectPersonaIntent('normal mode')).toEqual({ action: 'exit' });
  });
  it('ignores chat', () => {
    expect(detectPersonaIntent('what is the time')).toBeNull();
  });
  it('marks free vs pro', () => {
    expect(personaById('english-tutor')?.free).toBe(true);
    expect(personaById('upsc-interviewer')?.free).toBe(false);
    expect(PERSONAS.length).toBeGreaterThanOrEqual(5);
  });
});

describe('personaPrompt', () => {
  it('includes per-mode memory', () => {
    const p = personaById('gym-coach')!;
    expect(personaPrompt(p, ['Reported: 20 pushups'])).toMatch(/20 pushups/);
  });
});

describe('offline tutor', () => {
  it('corrects common mistakes', () => {
    const c = offlineTutorCorrections('I am having a car and we discuss about cricket, it is more better.');
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(formatCorrections(c)).toMatch(/I have a car/);
    expect(formatCorrections(c)).toMatch(/discuss cricket/);
  });
  it('finds nothing in clean sentences', () => {
    expect(offlineTutorCorrections('I went to the market yesterday.')).toHaveLength(0);
  });
});

describe('offline coach', () => {
  it('answers common topics', () => {
    expect(offlineCoachReply('how to do pushups?')).toMatch(/Pushups/);
    expect(offlineCoachReply('mann nahi kar raha')).toMatch(/GO/);
    expect(offlineCoachReply('what is quantum physics')).toBeNull();
  });
});

describe('extractModeNote', () => {
  it('notes tutor mistakes and coach PRs', () => {
    const c = offlineTutorCorrections('it is more better');
    expect(extractModeNote('english-tutor', 'it is more better', c)).toMatch(/more better/);
    expect(extractModeNote('gym-coach', 'did 30 pushups today', [])).toMatch(/30 pushups/);
  });
});
