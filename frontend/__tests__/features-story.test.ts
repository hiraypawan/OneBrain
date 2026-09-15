import { describe, it, expect } from 'vitest';
import {
  detectStoryIntent, episodePrompt, parseStoryState, offlineEpisode,
  episodesToday, titleFromLine, ageGuard, type StoryThread,
} from '../lib/story';

const thread = (over: Partial<StoryThread> = {}): StoryThread => ({
  id: 's1', title: 'Test', ageBand: '7-10', language: 'hinglish',
  characters: ['Chintu'], threads: ['red key'], episodes: [],
  createdAt: Date.now(), updatedAt: Date.now(), ...over,
});

describe('detectStoryIntent', () => {
  it('detects story commands', () => {
    expect(detectStoryIntent('kahani sunao')).toEqual({ action: 'enter' });
    expect(detectStoryIntent('aage sunao')).toEqual({ action: 'continue' });
    expect(detectStoryIntent('nayi kahani')).toEqual({ action: 'new' });
    expect(detectStoryIntent('kahani band')).toEqual({ action: 'exit' });
    expect(detectStoryIntent('mausam kaisa hai')).toBeNull();
  });
});

describe('episodePrompt', () => {
  it('carries state and guards', () => {
    const p = episodePrompt(thread(), 'aur tez batao');
    expect(p).toMatch(/Chintu/);
    expect(p).toMatch(/red key/);
    expect(p).toMatch(/CAST:/);
    expect(ageGuard('3-6')).toMatch(/3-6/);
  });
});

describe('parseStoryState', () => {
  it('parses the CAST line and strips it', () => {
    const r = parseStoryState('Ek thi chidiya.\nCAST: Chintu, Minti | THREADS: red key, river');
    expect(r.characters).toEqual(['Chintu', 'Minti']);
    expect(r.threads).toEqual(['red key', 'river']);
    expect(r.clean).not.toMatch(/CAST/);
  });
  it('tolerates missing state lines', () => {
    const r = parseStoryState('Plain story.');
    expect(r.characters).toEqual([]);
    expect(r.clean).toBe('Plain story.');
  });
});

describe('offlineEpisode', () => {
  it('weaves known characters', () => {
    expect(offlineEpisode(thread())).toMatch(/Chintu/);
  });
});

describe('episodesToday + titles', () => {
  it('counts today only', () => {
    const t = thread({ episodes: [{ text: 'a', at: Date.now() }, { text: 'b', at: Date.now() - 86400000 * 2 }] });
    expect(episodesToday(t)).toBe(1);
  });
  it('titles from a line', () => {
    expect(titleFromLine('ek sher ki kahani sunao')).toMatch(/Kahani/);
  });
});
