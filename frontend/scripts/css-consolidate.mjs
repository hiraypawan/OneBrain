// One-off CSS consolidation, run 2026-09-17 with:
//   node scripts/css-consolidate.mjs --prune --fold
//
// Why it exists: Today stopped being the workspace, which left product.css and
// globals.css holding rules for a `.brain-workspace` / `.today-rail` /
// `.memory-section` DOM that no longer renders, the shared record widgets
// (rows, tabs, search, receipts) still scoped to those dead wrappers even though
// they now live in Your space too, and ~1,250 lines of new surfaces sitting in a
// third stylesheet that had to be imported in exactly the right order.
//
// --prune  re-scope or delete every rule, using the shipped source as the truth
//          about which class names exist (no build step, no heuristics on text).
// --fold   move globals.css’s component rules into product.css (their relative
//          order is preserved, so the cascade is identical) and fold shell.css in
//          at the end. Result: two authored files, one import.
//
// It is deterministic and reviewable: `git diff app/globals.css app/product.css`
// after running it is the whole change.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
// app/shell.css is unlinked after folding: update app/layout.tsx to import only
// globals.css + product.css (the two-file system this script produces).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const postcss = require('postcss');
const ROOT = path.resolve(import.meta.dirname, '..');
const flags = process.argv.slice(2);

/** Every class/id name that appears in shipped source, as a whole word. */
function liveTokens() {
  const files = execSync(
    `find . -type f \\( -name '*.tsx' -o -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.html' \\)` +
      ` -not -path './node_modules/*' -not -path './.next/*' -not -path './coverage/*'`,
    { cwd: ROOT, encoding: 'utf8' },
  ).split('\n').filter(Boolean);
  const out = new Set();
  for (const f of files) {
    const text = readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/[\w"'.`$>{-]*/g)) void m; // keep regex warm; tokens below
    for (const m of text.matchAll(/(?:className=|class=)[\s\S]{0,400}/g)) {
      for (const t of m[0].matchAll(/[a-zA-Z][\w-]*/g)) out.add(t[0]);
    }
  }
  // Anything in the file counts too: state classes are toggled from JS strings,
  // and a false “dead” verdict costs a visible style, while a false “live” one
  // costs only a line of CSS.
  for (const f of files) {
    const text = readFileSync(path.join(ROOT, f), 'utf8');
    for (const t of text.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(t[1]);
  }
  return out;
}

const RETIRED_WRAPPERS = new Set([
  'brain-workspace', 'home-stage', 'thought-stage', 'today-rail', 'memory-section',
  'memory-heading', 'workspace-toolbar', 'storage-label', 'workspace-intro', 'memory-toolbar',
]);
const LIVE_SCOPES = ['today-screen', 'notes-panel'];

function splitSelector(sel) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function classesIn(sel) {
  return [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}
function idsIn(sel) {
  return [...sel.matchAll(/#([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

/**
 * Rewrite one selector part. Returns an array of replacement parts (a rule that
 * used to hang off the workspace root now needs to hang off both surfaces).
 */
function rewritePart(part, live) {
  const has = (c) => new RegExp('\\.' + c + '\\b').test(part);
  const retired = [...RETIRED_WRAPPERS].filter(has);
  if (!retired.length) return [part];
  const out = [];
  for (const scope of LIVE_SCOPES) {
    let cand = part;
    for (const r of retired) cand = cand.replace(new RegExp('\\.' + r + '(?![\\w-])'), '.' + scope);
    cand = cand.replace(/\s+/g, ' ').trim();
    // `.notes-panel .notes-panel x` or a bare duplicated scope is pointless.
    if (cand === `.${scope}` || out.includes(cand)) continue;
    if (!out.includes(cand)) out.push(cand);
  }
  // A selector that was *only* the retired wrapper itself styles the page root.
  if (retired.length && retired.every((r) => part.trim() === '.' + r)) out.length = 0, out.push('.today-screen');
  return out;
}

function prune(css, live) {
  let dropped = 0, rescoped = 0;
  css.walkRules((rule) => {
    if (rule.parent && rule.parent.name === 'keyframes') return;
    const parts = splitSelector(rule.selector);
    if (!parts.length) return;
    const kept = [];
    for (const part of parts) {
      const rewritten = rewritePart(part, live);
      if (rewritten.length !== 1 || rewritten[0] !== part) rescoped++;
      for (const cand of rewritten) {
        const content = [...classesIn(cand), ...idsIn(cand)].filter(
          (c) => !RETIRED_WRAPPERS.has(c) && !LIVE_SCOPES.includes(c) && c !== 'control-panel' && c !== 'dark' && c !== 'light',
        );
        // A rule with no class at all (element selectors) is base styling: keep.
        if (!content.length || content.some((c) => live.has(c))) kept.push(cand);
      }
    }
    if (!kept.length) {
      const prev = rule.prev();
      // Take an immediately preceding comment with the rule: leaving “Style the
      // memory rail” above nothing is how dead CSS gets defended later.
      if (prev && prev.type === 'comment' && /[^]*\S$/.test(prev.text)) {
        const dead = [...new Set([...classesIn(rule.selector)])].filter((c) => !live.has(c) && RETIRED_WRAPPERS.has(c));
        if (dead.some((c) => prev.text.includes(c.replace(/-/g, ' '))) || prev.text.trim().length < 80) prev.remove();
      }
      rule.remove();
      dropped++;
      return;
    }
    const joined = kept.join(',\n');
    if (joined !== parts.join(', ')) rule.selector = joined;
  });
  css.walkAtRules((at) => {
    if (at.nodes && !at.nodes.length) at.remove();
  });
  return { dropped, rescoped };
}

/**
 * globals.css keeps the base layer (tailwind directives, tokens, element and
 * `@font-face` rules). Anything keyed on a class or an id is a component rule
 * and belongs in the product stylesheet.
 */
function isBaseRule(rule) {
  const s = rule.selector.replace(/\s+/g, ' ').trim();
  return !/^[.#[]/.test(s);
}

function fold(globals, product, shellCss) {
  // Move component rules out of globals (base + tokens stay) preserving order.
  const moved = [];
  let pending = []; // comments that document the rule that follows them
  const take = (node) => {
    for (const c of pending.splice(0)) moved.push(c.clone(), c.remove());
    moved.push(node.clone());
    node.remove();
  };
  globals.each((node) => {
    if (node.type === 'comment') { pending.push(node); return; }
    if (node.type === 'rule' && isBaseRule(node)) { pending = []; return; }
    if (node.type === 'atrule' && /^(tailwind|import|charset|font-face|keyframes)/.test(node.name)) { pending = []; return; }
    if (node.type === 'atrule' && node.name === 'media') {
      const inner = node.nodes ? [...node.nodes] : [];
      const movable = inner.filter((n) => n.type === 'rule' && !isBaseRule(n));
      if (movable.length && movable.length === inner.length) { take(node); return; }
      for (const n of inner) if (!isBaseRule(n) && n.type === 'rule') {
        const c = n.prev() && n.prev().type === 'comment' ? n.prev() : null;
        if (c) { moved.push(c.clone()); c.remove(); }
        moved.push(n.clone());
        n.remove();
      }
      if (!node.nodes.length) node.remove();
      pending = [];
      return;
    }
    take(node);
  });
  for (const node of moved) {
    node.raws.before = '\n';
    product.append(node);
  }
  if (shellCss) {
    const banner = postcss.parse(
      '/* -------------------------------------------------------------------- ' +
      ' Today, Track, Voice, You and the unified To-Do: the surfaces added by the ' +
      ' five-tab shell. They live here since 2026-09-17 so there is exactly one ' +
      ' product stylesheet — the import order in app/layout.tsx used to decide ' +
      ' which of two files won, and that is not a design system. ' +
      ' -------------------------------------------------------------------- */\n',
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

const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

let globals = postcss.parse(read('app/globals.css'), { from: 'app/globals.css' });
let product = postcss.parse(read('app/product.css'), { from: 'app/product.css' });
const shell = existsSync(path.join(ROOT, 'app/shell.css')) ? postcss.parse(read('app/shell.css'), { from: 'app/shell.css' }) : null;

let movedCount = 0;
if (flags.includes('--fold')) {
  movedCount = fold(globals, product, shell);
  const { unlinkSync } = await import('node:fs');
  if (existsSync(path.join(ROOT, 'app/shell.css'))) unlinkSync(path.join(ROOT, 'app/shell.css'));
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
  `fold: moved ${movedCount} rule blocks from globals.css; prune: dropped ${stats.dropped} rules, re-scoped ${stats.rescoped}`,
);
