import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG } from '@/components/control/catalog';
import { FREE_LIMITS } from '@/lib/plans';
import { DEVICE_BETA_NOTICE, UNVERIFIED_NOTICE } from '@/lib/entitlements';

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

/**
 * Strings the browser suite asserts on. Clarity rewrites must not quietly
 * rename them — this is the cheap guard that catches it before Playwright.
 */
const PROTECTED_STRINGS: { file: string; text: string }[] = [
  { file: 'components/AppHeader.tsx', text: 'Today' },
  // 2026-09-16: the shell grew to five tabs, so the nav label is "Space" —
  // the page it opens still says "Your space" in its own heading.
  { file: 'components/AppHeader.tsx', text: 'Space' },
  { file: 'components/control/ControlCenter.tsx', text: 'Your space' },
  { file: 'components/workspace/NeuralWorkspace.tsx', text: 'Open settings' },
  { file: 'components/control/ControlCenter.tsx', text: 'Find a tool or setting' },
  { file: 'components/workspace/NeuralWorkspace.tsx', text: 'Context map' },
  {
    file: 'components/workspace/NeuralWorkspace.tsx',
    text: 'OneBrain is your voice-first assistant for notes',
  },
];

describe('protected product copy', () => {
  for (const { file, text } of PROTECTED_STRINGS) {
    it(`keeps "${text}" in ${file}`, () => {
      expect(read(file)).toContain(text);
    });
  }
});

describe('navigation clarity', () => {
  it('lists Music as a first-class panel, not a hidden setting', () => {
    const music = CATALOG.find((entry) => entry.id === 'music');
    expect(music).toBeDefined();
    expect(music?.group).toBe('Utilities');
    expect(music?.keywords).toContain('gaana');
    // Searchable in English and Hindi transliteration, like every other entry.
    expect(music?.keywords).toMatch(/song|music/);
  });

  it('describes the Plan panel in terms a user can act on', () => {
    const plan = CATALOG.find((entry) => entry.id === 'plan');
    expect(plan?.description).toMatch(/key/i);
  });

  it('registers every catalog panel so nothing dead-ends', () => {
    const source = read('components/control/ControlCenter.tsx');
    for (const entry of CATALOG) {
      expect(source, `${entry.id} panel not registered`).toContain(`${entry.id}:`);
    }
  });

  it('drops the jargon that made Today hard to read', () => {
    const workspace = read('components/workspace/NeuralWorkspace.tsx');
    expect(workspace).not.toContain('POCKET MODE');
    expect(workspace).not.toContain('Dark screen');
    expect(workspace).not.toContain('ONEBRAIN / WORKSPACE');
    expect(workspace).not.toContain('EVIDENCE, NOT JUST');
    expect(workspace).toContain('SCREEN-OFF MODE');
  });
});

describe('the "try one of these" card', () => {
  const source = read('components/features/FeatureCards.tsx');

  it('groups phrases instead of dumping one long line', () => {
    expect(source).toContain('const SAY_GROUPS');
    expect(source).toMatch(/label: 'Save something'/);
    expect(source).toMatch(/label: 'Ask or calculate'/);
    expect(source).toMatch(/label: 'Play music'/);
    expect(source).toMatch(/label: 'Start a mode'/);
  });

  it('makes every phrase tappable through the real transcript path', () => {
    expect(source).toContain('onClick={() => say(item.say)}');
    const workspace = read('components/workspace/NeuralWorkspace.tsx');
    expect(workspace).toContain('<FeatureHint say={say} />');
  });

  it('mentions the music phrases that stop/continue must not swallow', () => {
    expect(source).toContain('play kesariya');
    expect(source).toContain('gaana band');
  });
});

describe('plan and entitlement copy', () => {
  const planPanel = read('components/control/Plan.tsx');
  const planCard = read('components/features/FeatureCards.tsx');
  const store = read('store/features.ts');

  it('never implies that a purchase happened', () => {
    for (const source of [planPanel, planCard]) {
      expect(source).toMatch(/[Nn]o payment/);
      // "there is no checkout" is the honest sentence we want; what must not
      // appear is any wording that implies a purchase took place.
      expect(source).not.toMatch(/Buy now|Subscribe now|purchase a plan|payment successful/i);
    }
  });

  it('tells the user who decided their plan', () => {
    expect(store).toContain('planSource');
    expect(planPanel).toContain('server');
    expect(planPanel).toContain('device-beta');
    expect(planCard).toContain('planSource');
  });

  it('explains that a signed-out key only unlocks this browser', () => {
    expect(planCard).toMatch(/this browser only/i);
    expect(planPanel).toMatch(/this browser only/i);
  });

  it('shows server limits when the server answered, local ones when it did not', () => {
    // The panel maps every local limit name onto the server's key, so a
    // redeemed plan cannot display one limit while the server enforces another.
    expect(planPanel).toContain('serverEntitlement?.limits');
    expect(planPanel).toContain("researchPerDay: 'researchPerDay'");
    expect(planPanel).toContain("storyTrialEpisodes: 'storyEpisodes'");
    expect(planPanel).toContain('FREE_LIMITS');
    expect(planPanel).toContain("return 'Unlimited'");
  });

  it('keeps the free limits identical to what the worker enforces', () => {
    // Two copies of the same numbers is how a user ends up told "3 left" while
    // the server refuses at 2. Fail loudly if either side drifts.
    const worker = readFileSync(resolve(root, '../workers/api/src/platform/entitlements.ts'), 'utf8');
    const free = worker.slice(worker.indexOf('free: {'), worker.indexOf('pro: {'));
    expect(FREE_LIMITS.researchPerDay).toBe(3);
    expect(FREE_LIMITS.emailDraftsPerMonth).toBe(10);
    expect(FREE_LIMITS.scribePerDay).toBe(5);
    expect(FREE_LIMITS.storyTrialEpisodes).toBe(3);
    expect(free).toContain(`researchPerDay: ${FREE_LIMITS.researchPerDay}`);
    expect(free).toContain(`emailDraftsPerMonth: ${FREE_LIMITS.emailDraftsPerMonth}`);
    expect(free).toContain(`scribePerDay: ${FREE_LIMITS.scribePerDay}`);
    expect(free).toContain(`storyEpisodes: ${FREE_LIMITS.storyTrialEpisodes}`);
  });

  it('warns when the server could not be reached instead of guessing', () => {
    expect(planPanel).toContain('planNotice');
    expect(planPanel).toContain('unverified, cached');
    expect(UNVERIFIED_NOTICE).toMatch(/could not be reached/);
    expect(UNVERIFIED_NOTICE).toMatch(/24 hours/);
    expect(DEVICE_BETA_NOTICE).toMatch(/this browser/);
  });
});

describe('music panel', () => {
  const source = read('components/control/Music.tsx');

  it('drives the same store as the sticky player', () => {
    expect(source).toContain('useMediaStore');
    expect(source).not.toContain('new Audio(');
  });

  it('offers typed search and a playback kill switch', () => {
    expect(source).toContain('Search and play');
    expect(source).toContain('musicEnabled');
  });

  it('is honest about third-party sources', () => {
    expect(source).toMatch(/free, keyless/i);
    expect(source).toMatch(/rate-limited|offline/);
    expect(source).toContain('never shows a playing song that');
  });

  it('lists the voice phrases that are safe with strict stop/continue', () => {
    expect(source).toContain('stop song');
    expect(source).toContain('gaana band');
    expect(source).toContain('phir se chalao');
  });
});
