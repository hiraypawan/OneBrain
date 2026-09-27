#!/usr/bin/env node
// Intent-router audit — print where each everyday phrase actually lands.
//
//   npm run audit:intents            table + summary (exit 1 on regressions)
//   npm run audit:intents -- --json  machine-readable rows
//   npm run audit:intents -- --only date    filter phrases
//
// lib/intent-audit.ts holds the phrase table and calls the REAL router; this
// script only bundles it for plain Node (esbuild + the repo's own `@` alias),
// pins the clock so hour-dependent branches are reproducible, and prints.
// Nothing here is app code — it never ships in a bundle.

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The router reaches for IndexedDB and the network in ways that can reject
// after the table is printed (a fire-and-forget persist). Report it, don't die.
process.on('unhandledRejection', (reason) => {
  console.error(`ignored unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? argv[onlyIdx + 1]?.toLowerCase() : '';

// Pinned local times, not UTC: lib/nightmind.ts::isNightHour reads getHours().
const DAY = new Date(2026, 8, 27, 10, 30, 0); // Sun 27 Sep 2026, mid-morning
const NIGHT = new Date(2026, 8, 27, 23, 30, 0); // same day, late night

const outDir = join(frontend, 'node_modules', '.cache');
const outFile = join(outDir, 'onebrain-intent-audit.mjs');
mkdirSync(outDir, { recursive: true });

// A tiny entry so esbuild resolves the `@` alias and can leave every npm
// package external — Node then loads them from frontend/node_modules.
const entrySource = `
import 'fake-indexeddb/auto';
export * from '@/lib/intent-audit';
`;

await build({
  stdin: {
    contents: entrySource,
    resolveDir: frontend,
    loader: 'ts',
    sourcefile: 'intent-audit-entry.ts',
  },
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node20',
  logLevel: 'silent',
  alias: { '@': frontend },
});

// Pin Date before the modules load: several detectors call `new Date()` at
// import time for default ranges.
const RealDate = Date;
function pinClock(pinned) {
  const now = pinned.getTime();
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() {
      return now;
    }
  }
  globalThis.Date = PinnedDate;
}

pinClock(DAY);
const audit = await import(pathToFileURL(outFile).href);
const dayReport = await audit.runAudit();
const repairRows = await audit.runRepairAudit();
pinClock(NIGHT);
const nightRows = await audit.runNightAudit();
globalThis.Date = RealDate;

const pick = (list) =>
  only ? list.filter((r) => r.key.toLowerCase().includes(only) || r.text.toLowerCase().includes(only)) : list;
const rows = pick(dayReport.rows);
const repairFiltered = pick(repairRows);
const nightFiltered = pick(nightRows);

if (asJson) {
  process.stdout.write(
    JSON.stringify(
      { clock: { day: DAY.toISOString(), night: NIGHT.toISOString() }, rows, repairRows, nightRows },
      null,
      2,
    ) + '\n',
  );
  process.exit(0);
}

const color = process.stdout.isTTY;
const red = (s) => (color ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s) => (color ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (color ? `\x1b[1m${s}\x1b[0m` : s);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

console.log('');
console.log(bold('OneBrain intent audit'));
console.log(dim(`clock pinned to ${DAY.toDateString()} ${DAY.toTimeString().slice(0, 5)} (day) / ${NIGHT.toTimeString().slice(0, 5)} (night) · real router, no network`));
console.log('');

function printRows(list, showKey = false) {
  for (const r of list) {
    const mark = r.ok ? green('✓') : r.known ? red('✗') : red('‼');
    const label = showKey ? clip(r.key, 56) : clip(r.text, 42);
    console.log(
      `${mark} ${pad(label, showKey ? 57 : 43)} ${pad(r.expect, 17)} ${pad(r.ok ? r.got : red(r.got), r.ok ? 17 : 26)} ${dim(clip(r.detail, 46))}`,
    );
    if (r.effects.length) console.log(`  ${pad('', showKey ? 57 : 43)} ${red('writes: ' + r.effects.join(', '))}`);
  }
}

printRows(rows);

if (repairFiltered.length) {
  console.log('');
  console.log(dim('— after a log exists (seed → phrase) —'));
  printRows(repairFiltered, true);
}

if (nightFiltered.length) {
  console.log('');
  console.log(dim('— hour-dependent (clock pinned to 23:30) —'));
  printRows(nightFiltered);
}

// Ratchet bookkeeping: every wrong row must be on its known list, and every
// known row must still be wrong in the same recorded way.
const tables = [
  [dayReport.rows, audit.KNOWN_MISROUTES, 'KNOWN_MISROUTES'],
  [repairRows, audit.KNOWN_REPAIR_MISROUTES, 'KNOWN_REPAIR_MISROUTES'],
  [nightRows, audit.KNOWN_NIGHT_MISROUTES, 'KNOWN_NIGHT_MISROUTES'],
];
const stale = [];
for (const [list, known, name] of tables) {
  for (const [key, got] of Object.entries(known)) {
    const row = list.find((r) => r.key === key);
    if (!row) stale.push({ name, key, got, now: 'missing from the table' });
    else if (row.got === row.expect) stale.push({ name, key, got, now: 'CORRECT' });
    else if (row.got !== got) stale.push({ name, key, got, now: row.got });
  }
}
const allRows = [...dayReport.rows, ...repairRows, ...nightRows];
const unlisted = allRows.filter((r) => !r.ok && !r.known);

console.log('');
console.log(
  `${bold(String(dayReport.total))} day phrases · ${green(`${dayReport.correct} land where they should`)} · ` +
    `${red(`${dayReport.misrouted} misrouted`)} (${red(`${dayReport.destructive} wrote data or flipped a mode`)})`,
);
console.log(
  `${bold(String(repairRows.length))} seeded corrections · ${green(`${repairRows.filter((r) => r.ok).length} correct`)} · ` +
    `${red(`${repairRows.filter((r) => !r.ok).length} misrouted`)}`,
);
console.log(`${bold(String(nightRows.length))} night phrases · ${green(`${nightRows.filter((r) => r.ok).length} correct`)} · ${red(`${nightRows.filter((r) => !r.ok).length} misrouted`)}`);

let failed = false;
if (unlisted.length) {
  failed = true;
  console.log('');
  console.log(red(bold(`NEW REGRESSIONS (${unlisted.length}) — not in KNOWN_MISROUTES:`)));
  for (const r of unlisted) console.log(red(`  “${r.key}” -> ${r.got} (${r.detail})`));
}
if (stale.length) {
  failed = true;
  console.log('');
  console.log(red(bold(`STALE RATCHET ROWS (${stale.length}) — fixed or changed; delete/update in lib/intent-audit.ts:`)));
  for (const e of stale) console.log(red(`  ${e.name}[“${e.key}”] recorded as ${e.got}, now ${e.now}`));
}
if (!failed) console.log(dim('ratchet holds: no new misroutes, no fixed rows left listed'));
console.log('');
process.exit(failed ? 1 : 0);
