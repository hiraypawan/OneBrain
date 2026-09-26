import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATALOG } from '../components/control/catalog';
import { normalizeSettings, defaultSettings } from '../lib/settings';

describe('Labs keeps half-finished features out of the way', () => {
  it('marks exactly the unfinished sections', () => {
    expect(CATALOG.filter((e) => e.labs).map((e) => e.id).sort()).toEqual(['drafts', 'music', 'stories']);
  });
  it('keeps core sections visible', () => {
    for (const id of ['tasks', 'reminders', 'shared', 'notes', 'account', 'voice', 'privacy'])
      expect(CATALOG.find((e) => e.id === id)?.labs).toBeFalsy();
  });
  it('is off by default and only a real boolean turns it on', () => {
    expect(defaultSettings.labsEnabled).toBe(false);
    expect(normalizeSettings({ labsEnabled: 'true' }).labsEnabled).toBe(false);
    expect(normalizeSettings({ labsEnabled: true }).labsEnabled).toBe(true);
  });
  it('the Space grid filters Labs entries by the setting', () => {
    const src = readFileSync('components/control/ControlCenter.tsx', 'utf8');
    expect(src).toMatch(/labsEnabled \|\| !e\.labs/);
  });
  it('end-of-speech wait is clamped', () => {
    expect(normalizeSettings({ endOfSpeechMs: 50 }).endOfSpeechMs).toBe(700);
    expect(normalizeSettings({}).endOfSpeechMs).toBe(1600);
  });
});
