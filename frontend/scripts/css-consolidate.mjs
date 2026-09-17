// One-off CSS consolidation, run 2026-09-17 with:
//   node scripts/css-consolidate.mjs --fold --prune
//
// Why this exists: Today stopped being the workspace. That left product.css and
// globals.css holding rules for a `.brain-workspace` / `.home-stage` /
// `.today-rail` / `.memory-section` DOM that no longer renders, the shared
// widgets those pages contained (record rows, view tabs, the search row,
// receipts) still anchored to wrappers that are gone, and ~1,250 lines of new
// surfaces in a third stylesheet whose position in app/layout.tsx decided which
// cascade won.
//
// --prune  two jobs per rule, both mechanical and reviewable:
//            * re-anchor: a rule keyed on a retired wrapper is rewritten onto
//              whichever surface renders what it styles now — `.today-screen`
//              (the brief) or `.notes-panel` (Your space → Notes & activity) —
//              and dropped when neither renders it. Guessing “root for
//              everything” is how an earlier attempt gave Today a 260px empty
//              column and a -48px header bleed, i.e. horizontal overflow at
//              every width, which the browser suite caught and the diff did not.
//            * delete: a rule none of whose class names appear in shipped
//              source styles nothing.
// --fold   move globals.css’s component rules into product.css, preserving
//          their relative order so the cascade is identical, then append
//          shell.css. Result: base layer + one product stylesheet.
//
// postcss keeps each untouched node’s own formatting, so the diff stays
// reviewable; `git diff app/*.css app/layout.tsx` is the whole change.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';

const ROOT = path.resolve(import.meta.dirname, '..');
const flags = process.argv.slice(2);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const readList = (files) =>
  files
    .map((f) => {
      try {
        return read(f);
      } catch {
        return '';
      }
    })
    .join('\n');

const RETIRED_WRAPPERS = new Set([
  'brain-workspace', 'home-stage', 'thought-stage', 'today-rail', 'memory-section',
  'memory-heading', 'workspace-toolbar', 'storage-label', 'workspace-intro',
]);
const SCOPES = { today: 'today-screen', notes: 'notes-panel' };

/** The two surfaces the retired wrappers’ widgets ended up on. */
const NOTES_SRC = readList(['components/control/Notes.tsx']);
const TODAY_SRC = readList([
  'components/today/TodayView.tsx',
  'components/today/CaptureComposer.tsx',
  'components/today/VoiceCard.tsx',
  'components/today/BriefLists.tsx',
  'components/today/AssistantSurfaces.tsx',
  'components/today/DraftReview.tsx',
  'components/workspace/ItemSheet.tsx',
  'components/workspace/ContextMap.tsx',
  'components/features/FeatureCards.tsx',
  'components/features/FeatureRunners.tsx',
]);

/** Every class/id mentioned anywhere in shipped source: the liveness oracle. */
function liveTokens() {
  const files = execSync(
    `find . -type f \\( -name '*.tsx' -o -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.html' \\)` +
      ` -not -path './node_modules/*' -not -path './.next/*' -not -path './coverage/*'`,
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  const out = new Set();
  for (const f of files) {
    const text = readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/[A-Za-z][\w-]*/g)) out.add(m[0]);
  }
  return out;
}

function splitSelector(sel) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const classesIn = (sel) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
const hasToken = (text, token) =>
  new RegExp('(?<![\\w-])' + token + '(?![\\w-])').test(text);

/**
 * Rewrite one selector part. `[]` means: nothing left to style here.
 */
function rewritePart(part) {
  const retired = [...RETIRED_WRAPPERS].filter((c) => hasToken(part, c));
  if (!retired.length) return [part];
  // The header bled sideways through the old page frame; the shell block styles
  // the header itself, so that rule must not follow the frame’s widgets.
  if (hasToken(part, 'app-header')) return [];
  const content = classesIn(part).filter((c) => !RETIRED_WRAPPERS.has(c));
  if (!content.length) return [];
  const swap = (scope) =>
    part
      .replace(new RegExp('\\.(' + [...retired].join('|') + ')(?![\\w-])', 'g'), '.' + scope)
      .replace(/\s+/g, ' ')
      .trim();
  const out = [];
  if (content.some((c) => hasToken(TODAY_SRC, c))) out.push(swap(SCOPES.today));
  if (content.some((c) => hasToken(NOTES_SRC, c))) out.push(swap(SCOPES.notes));
  // A wrapper-only rule re-anchored onto the panel root would invent a grid for
  // the panel; the panel gets its own block in this file instead.
  return [...new Set(out)].filter((p) => p !== '.' + SCOPES.notes);
}

function prune(css, live) {
  let dropped = 0;
  let rescoped = 0;
  css.walkRules((rule) => {
    if (rule.parent && rule.parent.name === 'keyframes') return;
    const parts = splitSelector(rule.selector);
    if (!parts.length) return;
    const kept = [];
    for (const part of parts) {
      const rewritten = rewritePart(part);
      if (rewritten.length !== 1 || rewritten[0] !== part) rescoped++;
      for (const cand of rewritten) {
        const content = classesIn(cand).filter(
          (c) => !RETIRED_WRAPPERS.has(c) && !['today-screen', 'notes-panel', 'dark', 'light'].includes(c),
        );
        // Element-only rules (`body p`, `:focus-visible`) are base styling: keep.
        if (!content.length || content.some((c) => live.has(c))) kept.push(cand);
      }
    }
    if (!kept.length) {
      // Take a short comment that documented only this rule with it — leaving
      // “style the memory rail” above nothing is how dead CSS gets defended.
      const prev = rule.prev();
      if (prev && prev.type === 'comment' && prev.text.trim().length < 90) prev.remove();
      rule.remove();
      dropped++;
      return;
    }
    const joined = kept.join(',\n');
    if (joined !== splitSelector(rule.selector).join(', ')) rule.selector = joined;
  });
  css.walkAtRules((at) => {
    if (at.nodes && !at.nodes.length) at.remove();
  });
  return { dropped, rescoped };
}

/**
 * globals.css keeps the base layer: tailwind directives, `@font-face`,
 * `@keyframes`, tokens on `:root`, and element selectors. Anything keyed on a
 * class or id is a component rule and belongs in the product stylesheet.
 */
function isBaseRule(node) {
  if (node.type !== 'rule') return false;
  return !/^[.#[]/.test(node.selector.replace(/\s+/g, ' ').trim());
}

function fold(globals, product, shellCss) {
  const moved = [];
  let pending = [];
  const take = (node) => {
    for (const c of pending.splice(0)) {
      moved.push(c.clone());
      c.remove();
    }
    moved.push(node.clone());
    node.remove();
  };
  globals.each((node) => {
    if (node.type === 'comment') {
      pending.push(node);
      return;
    }
    if (node.type === 'rule' && isBaseRule(node)) {
      pending = [];
      return;
    }
    if (node.type === 'atrule' && /^(tailwind|import|charset|font-face|keyframes)/.test(node.name)) {
      pending = [];
      return;
    }
    if (node.type === 'atrule' && node.name === 'media') {
      const inner = node.nodes ? [...node.nodes] : [];
      const movable = inner.filter((n) => n.type === 'rule' && !isBaseRule(n));
      if (movable.length && movable.length === inner.filter((n) => n.type === 'rule').length) {
        take(node);
        return;
      }
      for (const n of movable) {
        const before = n.prev();
        if (before && before.type === 'comment') {
          moved.push(before.clone());
          before.remove();
        }
        moved.push(n.clone());
        n.remove();
      }
      if (!node.nodes.length) node.remove();
      pending = [];
      return;
    }
    take(node);
  });
  // Prepend in reverse so the moved rules land *before* the product rules they
  // used to precede: appending would quietly reverse the cascade and let older
  // base-layer rules start winning.
  for (const node of moved.reverse()) {
    node.raws.before = '\n';
    product.prepend(node);
  }
  if (shellCss) {
    const banner = postcss.parse(
      '/* ---------------------------------------------------------------------\n' +
        ' Today, Track, Voice, You and the unified To-Do: the surfaces added by\n' +
        ' the five-tab shell. They live in this file since 2026-09-17 so there is\n' +
        ' exactly one product stylesheet — the order of two imports in\n' +
        ' app/layout.tsx used to decide which cascade won, and that is a bug that\n' +
        ' waits for someone to move a rule.\n' +
        ' --------------------------------------------------------------------- */\n',
    );
    banner.each((node) => {
      node.raws.before = '\n';
      product.append(node);
    });
    shellCss.each((node) => {
      const clone = node.clone();
      clone.raws.before = '\n';
      product.append(clone);
    });
  }
  return moved.length;
}

let globals = postcss.parse(read('app/globals.css'), { from: 'app/globals.css' });
let product = postcss.parse(read('app/product.css'), { from: 'app/product.css' });
const shell = existsSync(path.join(ROOT, 'app/shell.css'))
  ? postcss.parse(read('app/shell.css'), { from: 'app/shell.css' })
  : null;

let movedCount = 0;
if (flags.includes('--fold')) {
  movedCount = fold(globals, product, shell);
  if (shell) unlinkSync(path.join(ROOT, 'app/shell.css'));
}
const stats = { dropped: 0, rescoped: 0 };
if (flags.includes('--prune')) {
  const live = liveTokens();
  for (const css of [globals, product]) {
    const s = prune(css, live);
    stats.dropped += s.dropped;
    stats.rescoped += s.rescoped;
  }
}
writeFileSync(path.join(ROOT, 'app/globals.css'), globals.toString());
writeFileSync(path.join(ROOT, 'app/product.css'), product.toString());
console.log(
  `fold: moved ${movedCount} blocks out of globals.css; prune: dropped ${stats.dropped} rules, re-anchored ${stats.rescoped} parts`,
);
