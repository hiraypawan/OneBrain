import { describe, it, expect } from 'vitest';
import {
  detectResearchIntent, planEntitySearches, parseSynthesis, ungroundedBrief,
} from '../lib/research';

describe('detectResearchIntent', () => {
  it('detects research requests', () => {
    expect(detectResearchIntent('EV scooters under 1.5L research karo')).toMatch(/EV scooters/);
    expect(detectResearchIntent('research: best phones under 20000')).toMatch(/phones/);
    expect(detectResearchIntent('Chetak vs Ola compare karo')).toBeTruthy();
  });
  it('ignores chat', () => {
    expect(detectResearchIntent('namaste, kaise ho')).toBeNull();
    expect(detectResearchIntent('20 pushups')).toBeNull();
  });
});

describe('planEntitySearches', () => {
  it('splits comparisons and strips prices', () => {
    expect(planEntitySearches('Chetak vs Ola')).toEqual(['Chetak', 'Ola']);
    expect(planEntitySearches('best EV scooters under 1.5L')[0]).not.toMatch(/1\.5/);
  });
});

describe('parseSynthesis', () => {
  it('parses the strict format', () => {
    const b = parseSynthesis('q', 'Spoken line here.\nPICKS:\nChetak — solid range\nOla — fast charging\nNOTES:\nCheck service\nVerify price', [{ title: 'EV', url: 'https://x', snippet: 's' }], '2026-09-15');
    expect(b.spoken).toMatch(/Spoken line/);
    expect(b.picks).toHaveLength(2);
    expect(b.bullets).toHaveLength(2);
    expect(b.grounded).toBe(true);
  });
});

describe('ungroundedBrief', () => {
  it('never invents, always helps', () => {
    const b = ungroundedBrief('EV scooters');
    expect(b.grounded).toBe(false);
    expect(b.bullets.length).toBeGreaterThan(0);
    expect(b.spoken).toMatch(/nahi bataunga/);
  });
});
