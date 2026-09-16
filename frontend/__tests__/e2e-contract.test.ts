import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG, EXTRA_PANELS } from '@/components/control/catalog';
import { parseMediaCommand } from '@/lib/commands';

/**
 * The browser suite cannot run in every environment (it needs three browser
 * engines, a local D1-backed API and a built frontend). These checks approximate
 * its text, accessible-name and request-budget contracts from source, so a copy
 * or wiring change that would break Playwright fails here first.
 *
 * They earned their place the hard way: renaming the Connected work description
 * broke `getByRole('link', { name: /Connected work Shared workspaces/ })`, and an
 * automatic entitlements fetch on sign-in broke the "bootstrap + first record
 * page only" request budget. Neither is visible to unit tests that render nothing.
 */
const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const specFiles = readdirSync(resolve(root, 'e2e')).filter((f) => f.endsWith('.spec.ts'));
const specs = specFiles.map((f) => ({ file: f, text: read(`e2e/${f}`) }));

/** All source that can render user-visible copy. */
const SOURCE_DIRS = ['components', 'app', 'lib', 'store', 'hooks'];
const sourceText = (() => {
  let out = '';
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) out += `${read(path)}\n`;
    }
  };
  for (const dir of SOURCE_DIRS) walk(dir);
  return out.replace(/\s+/g, ' ');
})();

/** Literals the browser suite asserts on, as written (no regexes). */
function assertedLiterals(): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  const patterns = [
    /(?:getByText|toContainText|toHaveText|getByLabel|getByPlaceholder)\(\s*(['"])((?:(?!\1)[^\\]|\\.)+)\1/g,
    /name:\s*(['"])((?:(?!\1)[^\\]|\\.)+)\1/g,
  ];
  for (const spec of specs) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of spec.text.matchAll(pattern)) {
        const value = match[2].replace(/\s+/g, ' ').trim();
        if (value.length > 3) found.push({ file: spec.file, text: value });
      }
    }
  }
  return found;
}

/**
 * Literals that legitimately do not appear in product source. Each entry says
 * where the text actually comes from; adding one requires a reason.
 */
const EXTERNAL_TEXT: Record<string, string> = {
  // Typed into a form by the test, then asserted back as saved data.
  '2099-09-15': 'fixture input (reminder date)',
  'Browser test studio': 'fixture input (story title)',
  'Call shared client': 'fixture input (shared task body)',
  'Catalog 0-00': 'fixture input (imported record title)',
  'Check client proposal': 'fixture input (reminder body)',
  'Client Ada': 'fixture input (persona name)',
  'History fixture': 'fixture input (workspace name)',
  'Lazy loading fixture': 'fixture input (workspace name)',
  'Maya prefers a call before lunch': 'fixture input (memory text)',
  'Pagination fixture': 'fixture input (workspace name)',
  'Private test entry': 'fixture input (vault label)',
  'Rahul — ABC Corp': 'fixture input (contact title)',
  'Renew the passport': 'fixture input (task body typed into Ask OneBrain)',
  'Complete Renew the passport': 'composed: "Complete " + task title',
  '₹250': 'composed: "₹" + the amount this run logged through the Track form',
  'Review the proposal': 'fixture input (reminder body)',
  'Review the shared proposal': 'fixture input (server reminder body)',
  'cached-only@example.test': 'fixture input (account email)',
  'reviewed.json': 'fixture input (import file name)',
  'test-secret-not-for-server': 'fixture input (vault secret)',
  // Rendered by the app, but composed with fixture data or a live count.
  'Complete Prepare the website quotation': 'composed: "Complete " + task title',
  'Dismiss Review the proposal': 'composed: "Dismiss " + reminder body',
  'Load older receipts for History job 25': 'composed: "Load older receipts for " + job name',
  'Save 1 item': 'composed: "Save " + count + " item"',
  'Save 3 items': 'composed: "Save " + count + " items"',
  'Save 19 items': 'composed: "Save " + count + " items"',
  'Saved one shared task': 'composed confirmation for a fixture task',
  // Returned by a mocked API response, then displayed verbatim.
  'The source could not be checked. No rate was invented.': 'mocked /api/utilities error body',
  // Thrown by the mocked recognizer and echoed by the app's error notice.
  'Recognition failed': 'mocked recognizer error message, echoed in the status',
};

describe('browser-suite copy contract', () => {
  const literals = assertedLiterals();

  it('finds a meaningful number of assertions to protect', () => {
    expect(specFiles.length).toBeGreaterThanOrEqual(8);
    expect(literals.length).toBeGreaterThan(100);
  });

  it('keeps every asserted literal in product source, or explains it', () => {
    const unexplained = literals.filter(
      ({ text }) => !sourceText.includes(text) && !(text in EXTERNAL_TEXT),
    );
    expect(
      unexplained.map(({ file, text }) => `${file}: "${text}"`),
      'These strings are asserted by e2e/*.spec.ts but no longer exist in the UI source. ' +
        'Restore the copy, or add the new wording to the spec and to EXTERNAL_TEXT with a reason.',
    ).toEqual([]);
  });

  it('keeps every stale exception honest', () => {
    const nowInSource = Object.keys(EXTERNAL_TEXT).filter((text) => sourceText.includes(text));
    expect(
      nowInSource,
      'These exceptions are no longer needed — the text now exists in source. Remove the entry.',
    ).toEqual([]);
  });
});

describe('accessible names the browser suite clicks', () => {
  const entries = [
    ...CATALOG.map((entry) => ({ id: entry.id, name: `${entry.title} ${entry.description}` })),
    ...Object.entries(EXTRA_PANELS).map(([id, entry]) => ({ id, name: `${entry.title} ${entry.description}` })),
  ];

  it('still matches every catalog-shaped link regex in the specs', () => {
    const checked: string[] = [];
    for (const spec of specs) {
      for (const match of spec.text.matchAll(/name:\s*\/((?:[^/\\]|\\.)+)\//g)) {
        const pattern = new RegExp(match[1]);
        // Only patterns that address a panel by its title are catalog contracts.
        const addressed = entries.filter((entry) => pattern.source.startsWith(entry.name.split(' ')[0]));
        if (!addressed.length) continue;
        checked.push(pattern.source);
        expect(
          entries.some((entry) => pattern.test(entry.name)),
          `${spec.file}: /${pattern.source}/ no longer matches any panel name. ` +
            `Panel descriptions are part of the accessible name — keep the title's wording after it.`,
        ).toBe(true);
      }
    }
    expect(checked).toContain('Connected work Shared workspaces');
    expect(checked).toContain('Voice & conversation Language');
  });

  it('keeps Connected work searchable by the words the spec types', () => {
    const shared = CATALOG.find((entry) => entry.id === 'shared');
    const haystack = `${shared?.title} ${shared?.description} ${shared?.keywords ?? ''}`.toLowerCase();
    expect(haystack).toContain('calendar');
  });
});

describe('platform request budget', () => {
  const hydrator = read('components/StoreHydrator.tsx');
  const shared = read('components/control/SharedSpace.tsx');
  const account = read('components/settings/AccountSettings.tsx');

  it('never adds a request per sign-in', () => {
    // e2e/capacity.spec.ts allows exactly /bootstrap and the first record page
    // when Connected work opens; the edge job runs the same spec on workerd.
    expect(hydrator).not.toContain('fetchEntitlements');
    expect(hydrator).toMatch(/if \(state\.isAuthenticated \|\| state\.isAuthenticated === previous\.isAuthenticated\) return;/);
  });

  it('takes the plan from responses the app already makes', () => {
    expect(hydrator).toContain('me.entitlement');
    expect(shared).toContain('me.entitlement');
    expect(account).toContain('data.entitlement');
  });

  it('still clears a server plan on sign-out', () => {
    expect(hydrator).toContain('clearServerEntitlement');
  });

  it('only fetches entitlements where a user asked for it', () => {
    const onDemand = ['components/control/Plan.tsx', 'lib/entitlements.ts', 'lib/feature-engine.ts'];
    for (const spec of specs) expect(spec.text).not.toContain('fetchEntitlements');
    const callers = readdirSync(resolve(root, 'components'), { recursive: true })
      .filter((f) => String(f).endsWith('.tsx'))
      .map((f) => `components/${f}`)
      .filter((f) => read(f).includes('fetchEntitlements'));
    expect(callers.every((f) => onDemand.includes(f)), `unexpected automatic callers: ${callers}`).toBe(true);
  });
});

describe('voice grammar versus the browser suite', () => {
  it('does not let the media grammar steal a transcript the specs speak', () => {
    const spoken: string[] = [];
    for (const spec of specs) {
      for (const match of spec.text.matchAll(/text:\s*"([^"]+)"/g)) spoken.push(match[1]);
      for (const match of spec.text.matchAll(/handleTranscript\("([^"]+)"\)/g)) spoken.push(match[1]);
    }
    expect(spoken.length).toBeGreaterThan(3);
    const captured = spoken.filter((line) => parseMediaCommand(line) !== null);
    expect(
      captured,
      'The media grammar intercepts a transcript the browser suite expects to reach ' +
        'the calculator, memory or chat path. Tighten parseMediaCommand instead of editing the spec.',
    ).toEqual([]);
  });

  it('still hears the music phrases it exists for', () => {
    expect(parseMediaCommand('play kesariya')?.action).toBe('play');
    expect(parseMediaCommand('gaana band')?.action).toBe('pause');
    expect(parseMediaCommand('stop song')?.action).toBe('close');
  });
});
