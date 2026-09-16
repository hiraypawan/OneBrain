import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG, EXTRA_PANELS, GROUPS } from '../components/control/catalog';
import { TRACK_LENSES, isRangeKind, isTrackLens, trackHref } from '../lib/track';
import { TODO_VIEWS } from '../lib/todo';

// The 2026-09-16 shell change (Today · Voice · Track · Space · You) is big
// enough that "did we leave anything behind" has to be a test, not a memory.
// These are the invariants the redesign promised: five tabs that all resolve,
// every old door still leading somewhere, no dead links, and no demo glitter.

const root = join(__dirname, '..');
const read = (p: string) => {
  try {
    return readFileSync(join(root, p), 'utf8');
  } catch {
    return '';
  }
};

describe('the five-tab shell', () => {
  const header = read('components/AppHeader.tsx');

  it('has exactly the five tabs, in order', () => {
    const labels = [...header.matchAll(/label: "(\w+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(['Today', 'Voice', 'Track', 'Space', 'You']);
    const hrefs = [...header.matchAll(/href: "(\/[\w-]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/', '/voice', '/track', '/control', '/you']);
  });

  it('ships a real page behind every tab', () => {
    for (const file of ['app/page.tsx', 'app/voice/page.tsx', 'app/track/page.tsx', 'app/control/page.tsx', 'app/you/page.tsx']) {
      expect(existsSync(join(root, file)), file).toBe(true);
    }
  });

  it('keeps the header on the pages that need it and off the immersive one', () => {
    const nav = read('components/MainNav.tsx');
    expect(nav).toContain('<AppHeader');
    // Today draws its own header inside the workspace; the full-screen voice
    // surface carries its own controls, so neither gets a second bar.
    expect(nav).toMatch(/\/active/);
  });

  it('highlights the tab you are actually on, including old URLs', () => {
    expect(header).toContain('prefixes');
    for (const legacy of ['/reminders', '/memory', '/conversations', '/utilities', '/vault', '/operations', '/night']) {
      expect(header, legacy).toContain(`"${legacy}"`);
    }
    for (const owned of ['/you', '/settings', '/auth']) {
      expect(header, owned).toContain(`"${owned}"`);
    }
  });

  it('deletes the demo glitter instead of hiding it', () => {
    for (const gone of [
      'components/rare/gooey-nav.tsx',
      'components/rare/gravity-letters.tsx',
      'components/rare/fluid-orb.tsx',
      'components/rare/notification-bell.tsx',
    ]) {
      expect(existsSync(join(root, gone)), gone).toBe(false);
    }
    expect(read('app/shell.css')).not.toMatch(/gooey|gravity/i);
    expect(read('app/globals.css')).not.toMatch(/\.gooey|\.gravity/i);
    expect(read('app/product.css')).not.toMatch(/\.gooey|\.gravity-letters/i);
  });

  it('never lets a retired or unknown panel key fall through to Object.prototype', () => {
    const control = read('components/control/ControlCenter.tsx');
    // `?panel=constructor` is the classic way a lookup like PANELS[panel]
    // returns something that was never registered.
    expect(control).toContain('Object.hasOwn(PANELS, panel)');
    expect(control).toContain('Object.hasOwn(PANEL_REDIRECTS, panel)');
    expect(control).toContain('Object.hasOwn(EXTRA_PANELS, panel)');
    // A catalog entry that moved out of the maze (Track is a tab) redirects
    // instead of showing “not found” next to a tile that is right there.
    expect(control).toContain('if (panel && !Panel && (moved || away))');
  });

  it('opens the To-Do list on what is actually open', () => {
    const tasks = read('components/control/Tasks.tsx');
    // A saved task with no due date must not be filtered out of the default view.
    expect(tasks).toContain("useState<TodoView>('all')");
    expect(TODO_VIEWS[2].id).toBe('all');
  });

  it('gives the theme preference a control a user can actually reach', () => {
    // A wired-up consumer with no switch is still an orphaned preference, so the
    // guard is the whole path: control -> persisted setting -> document attribute.
    const advanced = read('components/control/AdvancedSettings.tsx');
    expect(advanced).toContain('aria-label="Theme on this browser"');
    expect(advanced).toContain('updateSettings({ theme: "light" })');
    // The label admits what it is instead of pretending to be a second design.
    expect(advanced).toContain('Light (beta)');
    expect(advanced).toContain('not a second\n          design');
    expect(read('app/layout.tsx')).toContain('ThemeSync');
    expect(read('components/ThemeSync.tsx')).toContain('data-ob-theme');
    const you = read('components/you/YouTab.tsx');
    expect(you).toContain('light (beta)');
    expect(you).toContain('href="/control?panel=advanced"');
    // …and typing “theme” into the space search finds the panel that owns it.
    expect(read('components/control/catalog.ts')).toMatch(
      /id: "advanced"[\s\S]{0,400}theme appearance light dark display/,
    );
  });

  it('keeps the tab bar inside 320px without a second stylesheet per tab', () => {
    const css = read('app/shell.css');
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.app-header nav a\s*\{[\s\S]*?flex: 1 1 0/);
    expect(css).toContain('safe-area-inset-bottom');
    // One consolidated file, imported once, instead of a pile of per-panel CSS.
    expect(read('app/layout.tsx')).toContain("import './shell.css'");
    expect(existsSync(join(root, 'app/track/track.css'))).toBe(false);
  });
});

describe('no dead ends', () => {
  const control = read('components/control/ControlCenter.tsx');
  const catalogSource = read('components/control/catalog.ts');

  it('gives every catalog entry a panel, a redirect or an outbound href', () => {
    for (const entry of CATALOG) {
      const registered = control.includes(`${entry.id}:`);
      const redirected = control.includes(`${entry.id}: {`);
      const linksOut = Boolean(entry.href);
      expect(registered || redirected || linksOut, entry.id).toBe(true);
    }
    // …and an outbound href must be a route that exists.
    for (const { href } of CATALOG) {
      if (!href) continue;
      const parts = href.split('/').filter(Boolean);
      const file = join(root, 'app', ...(parts.length ? [parts.join('/')] : []), 'page.tsx');
      expect(existsSync(file), href).toBe(true);
    }
  });

  it('redirects the panels that were retired, instead of 404-ing them', () => {
    expect(control).toContain('PANEL_REDIRECTS');
    expect(control).toContain('MovedPanel');
    for (const retired of ['track', 'todo', 'notes', 'canvas', 'shared-space']) {
      expect(control.includes(`${retired}:`) || control.includes(`"${retired}":`), retired).toBe(true);
    }
    // Nothing was deleted from the catalog's vocabulary: the words users search
    // for still belong to a live entry.
    for (const word of ['calendar', 'export', 'password', 'gaana']) {
      expect(catalogSource.toLowerCase(), word).toContain(word);
    }
  });

  it('keeps the extra panel routes that are linked from elsewhere', () => {
    for (const id of ['memory-search', 'timeline', 'conversation', 'data-export', 'debug']) {
      expect(EXTRA_PANELS[id], id).toBeDefined();
      expect(control.includes(`${id}:`) || control.includes(`"${id}":`), id).toBe(true);
    }
  });

  it('groups the space into four sections instead of a fifteen-tile wall', () => {
    expect(GROUPS).toEqual(['Get things done', 'Your record', 'Utilities', 'Make it yours']);
    const groups = new Set(CATALOG.map((e) => e.group));
    expect([...groups].sort()).toEqual([...GROUPS].sort());
    expect(CATALOG.find((e) => e.id === 'tasks')).toBeDefined();
  });

  it('never leaves a search result pointing at a panel that does not exist', () => {
    const spaceSearch = read('lib/space-search.ts');
    const all = [...spaceSearch.matchAll(/href:\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => m[1]);
    // Literal hrefs are checked against the panel table here; the templated
    // ones (/control?panel=...&item=..., /conversations?id=..., /track?lens=...) are exercised
    // against real rows in space-search.test.ts.
    const hrefs = all.filter((href) => !href.includes('${'));
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    expect(all.filter((href) => href.includes('${')).length).toBeGreaterThanOrEqual(3);
    for (const href of hrefs) {
      if (href.startsWith('/control?panel=')) {
        const id = href.split('=').pop() as string;
        expect(CATALOG.some((e) => e.id === id) || Boolean(EXTRA_PANELS[id]), href).toBe(true);
      } else if (href.startsWith('/track')) {
        expect(href).toMatch(/^\/track\?lens=/);
      } else if (href.startsWith('/conversations')) {
        expect(existsSync(join(root, 'app/conversations/page.tsx'))).toBe(true);
      } else {
        expect(href.startsWith('/?item=')).toBe(true);
      }
    }
  });
});

describe('Track tab contract', () => {
  it('offers exactly four lenses, and only accepts known ones in the URL', () => {
    expect(TRACK_LENSES.map((l) => l.id)).toEqual(['expenses', 'food', 'health', 'workouts']);
    expect(isTrackLens('expenses')).toBe(true);
    expect(isTrackLens('constructor')).toBe(false);
    expect(isRangeKind('month')).toBe(true);
    expect(isRangeKind('9999')).toBe(false);
  });

  it('writes URLs a voice answer can hand to the browser', () => {
    expect(trackHref({ lens: 'food', range: 'day', day: '2026-09-16' })).toBe('/track?lens=food&range=day&day=2026-09-16');
  });

  it('links the deterministic answers into the tab', () => {
    const cards = read('components/features/FeatureCards.tsx');
    expect(cards).toContain('View in Track →');
    expect(cards).toContain('trackHref');
    const engine = read('lib/feature-engine.ts');
    expect(engine).toContain("kind: 'track'");
    expect(engine).toContain('lens');
  });

  it('labels estimates as estimates and never as medical advice', () => {
    const lenses = read('components/track/Lenses.tsx');
    expect(lenses).toContain('≈');
    expect(lenses).toMatch(/not medical advice/i);
    expect(lenses).toMatch(/no estimate/i);
  });

  it('is honest about an empty window instead of showing a zero', () => {
    expect(read('components/track/Lenses.tsx')).toMatch(/Empty/);
    expect(read('lib/feature-engine.ts')).toContain('Nothing logged');
  });

  it('reuses one CSV builder for the tab and the fitness panel', () => {
    expect(read('components/control/Fitness.tsx')).toContain('fitnessCsv');
    expect(read('components/track/Lenses.tsx')).toContain('fitnessCsv');
  });
});

describe('the unified To-Do surface', () => {
  const tasks = read('components/control/Tasks.tsx');

  it('offers the four views the model supports', () => {
    expect(TODO_VIEWS.map((v) => v.id)).toEqual(['today', 'upcoming', 'all', 'done']);
    expect(tasks).toContain('TODO_VIEWS');
  });

  it('writes every change back to the origin instead of a fourth store', () => {
    expect(tasks).toContain('completeAction');
    expect(tasks).toContain('updateReminder');
    expect(tasks).toContain('dismissReminder');
    expect(tasks).toContain('useWorkspaceStore');
    expect(read('lib/todo.ts')).not.toMatch(/db\.(tasks|todos)\b/);
  });

  it('does not fetch shared records until the user asks', () => {
    expect(tasks).toContain("state: 'idle'");
    expect(tasks).toMatch(/Load shared tasks/);
    expect(tasks).toContain('platformApi');
  });

  it('says out loud that a shared record is not edited from here', () => {
    expect(tasks).toMatch(/Connected work/i);
    expect(tasks).toMatch(/read-only in this list on purpose/);
  });
});
