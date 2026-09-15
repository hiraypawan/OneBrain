import { describe, it, expect } from 'vitest';
import {
  witnessReducer, INITIAL_WITNESS, detectWitnessIntent, evidenceText, smsHref,
} from '../lib/witness';

describe('detectWitnessIntent', () => {
  it('starts, stops, safes', () => {
    expect(detectWitnessIntent('witness mode on')).toMatchObject({ action: 'start' });
    expect(detectWitnessIntent('witness mode 5 min')).toMatchObject({ action: 'start', intervalSec: 300 });
    expect(detectWitnessIntent('stop witness')).toEqual({ action: 'stop' });
    expect(detectWitnessIntent('safe')).toEqual({ action: 'safe' });
    expect(detectWitnessIntent('sab theek')).toEqual({ action: 'safe' });
  });
  it('parses contacts', () => {
    expect(detectWitnessIntent('witness contact Priya 9812345670')).toEqual({ action: 'contact', name: 'Priya', phone: '9812345670' });
  });
  it('ignores chat', () => {
    expect(detectWitnessIntent('samosa khaya')).toBeNull();
  });
});

describe('witnessReducer', () => {
  it('runs the safety lifecycle', () => {
    let s = witnessReducer(INITIAL_WITNESS, { type: 'start', at: 1000 });
    expect(s.phase).toBe('active');
    s = witnessReducer(s, { type: 'log', at: 2000, text: 'auto mein hun' });
    expect(s.log).toHaveLength(2);
    s = witnessReducer(s, { type: 'responded', at: 3000 });
    expect(s.misses).toBe(0);
    s = witnessReducer(s, { type: 'missed', at: 4000 });
    expect(s.phase).toBe('active');
    s = witnessReducer(s, { type: 'missed', at: 5000 });
    expect(s.phase).toBe('alert');
    s = witnessReducer(s, { type: 'responded', at: 6000 });
    expect(s.phase).toBe('active');
    s = witnessReducer(s, { type: 'stop' });
    expect(s.phase).toBe('idle');
  });
  it('keeps contacts across starts', () => {
    let s = witnessReducer(INITIAL_WITNESS, { type: 'set-contact', name: 'Priya', phone: '98' });
    s = witnessReducer(s, { type: 'start', at: 1 });
    expect(s.contactName).toBe('Priya');
  });
});

describe('evidence + sms', () => {
  it('builds timestamped evidence', () => {
    let s = witnessReducer(INITIAL_WITNESS, { type: 'start', at: 1000 });
    s = witnessReducer(s, { type: 'log', at: 2000, text: 'auto mein hun' });
    expect(evidenceText(s)).toMatch(/auto mein hun/);
    expect(evidenceText(s)).toMatch(/Witness Log/);
    expect(smsHref('9812345670', s)).toMatch(/^sms:9812345670\?body=/);
  });
});
