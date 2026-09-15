#!/usr/bin/env node
/**
 * Operator tool: mint OneBrain entitlement keys.
 *
 *   node scripts/mint-entitlement-keys.mjs --plan pro --count 5 --days 90 --label "Beta cohort"
 *
 * Keys are random (OB-PRO-XXXXXX / OB-FAM-XXXXXX). Only their SHA-256 hashes go
 * into D1, so the plaintext below is the only copy that will ever exist — the
 * server cannot show it again. Nothing here touches payments: this product has
 * no checkout, no cards and no paid overflow.
 *
 * Apply the printed SQL with:
 *   npx --prefix workers/api wrangler d1 execute onebrain-db --remote --file <file>
 * or add --execute to run that command for you (requires CLOUDFLARE_API_TOKEN).
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function parseArgs(argv) {
  const out = { plan: 'pro', count: 1, days: 0, label: '', createdBy: 'operator-script', execute: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--plan') out.plan = next();
    else if (arg === '--count') out.count = Number(next());
    else if (arg === '--days') out.days = Number(next());
    else if (arg === '--label') out.label = next();
    else if (arg === '--created-by') out.createdBy = next();
    else if (arg === '--execute') out.execute = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function mintKey(plan) {
  const bytes = randomBytes(6);
  const body = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `OB-${plan === 'family' ? 'FAM' : 'PRO'}-${body}`;
}

const normalize = (key) => key.trim().toUpperCase().replace(/[\s-]/g, '');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/mint-entitlement-keys.mjs --plan pro|family [--count N] [--days N] [--label TEXT] [--execute]');
    return;
  }
  if (!['pro', 'family'].includes(args.plan)) throw new Error('--plan must be pro or family (Free needs no key).');
  const count = Math.max(1, Math.min(50, Math.floor(args.count) || 1));
  const days = Math.max(0, Math.min(3650, Math.floor(args.days) || 0));
  if (args.label.length > 120) throw new Error('--label must be 120 characters or fewer.');

  const now = Date.now();
  const expiresAt = days > 0 ? now + days * 86400000 : null;
  const keys = Array.from({ length: count }, () => mintKey(args.plan));
  const rows = keys.map((key) =>
    `INSERT INTO entitlement_keys (key_hash,plan,label,created_by,created_at,expires_at) VALUES (${sqlString(sha256(normalize(key)))},${sqlString(args.plan)},${sqlString(args.label)},${sqlString(args.createdBy)},${now},${expiresAt === null ? 'NULL' : expiresAt});`,
  );
  const sql = `-- OneBrain entitlement keys minted ${new Date(now).toISOString()}\n-- ${count} x ${args.plan}${expiresAt ? `, expiring ${new Date(expiresAt).toISOString()}` : ', no expiry'}\n${rows.join('\n')}\n`;

  console.log('\nPLAINTEXT KEYS (shown once — only hashes are stored):\n');
  for (const key of keys) console.log('  ' + key);
  console.log('\nSQL:\n');
  console.log(sql);

  if (!args.execute) {
    console.log('Re-run with --execute to apply this to the remote D1 database, or copy the SQL into wrangler d1 execute.');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'onebrain-keys-'));
  const file = join(dir, 'keys.sql');
  try {
    writeFileSync(file, sql);
    execFileSync('npx', ['--prefix', 'workers/api', 'wrangler', 'd1', 'execute', 'onebrain-db', '--remote', '--file', file], { stdio: 'inherit' });
    console.log('Applied. Verify with: SELECT plan, COUNT(*) FROM entitlement_keys GROUP BY plan;');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
