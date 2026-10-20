// Pre-deploy gate check: verifies the secrets and state required to publish
// OneBrain to Cloudflare are present before the deploy job runs.
// Run locally: node scripts/check-deploy-gates.mjs
// Exit non-zero when a required gate is missing.

import { existsSync, readFileSync } from 'node:fs';

const REQUIRED_ENV = [
  'CLOUDFLARE_API_TOKEN',   // API token with Workers + Pages edit scope
  'CLOUDFLARE_ACCOUNT_ID',  // target Cloudflare account
];
const REQUIRED_FILES = [
  'frontend/.wrangler',      // frontend wrangler config (OpenNext binding)
  'workers/api/wrangler.jsonc', // API worker wrangler config
  'workers/api/migrations/0008_entitlements.sql', // latest applied migration
];

let failed = 0;

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) {
    console.error(`MISSING ENV: ${name}`);
    failed++;
  } else {
    console.log(`OK env: ${name} (set)`);
  }
}

for (const file of REQUIRED_FILES) {
  if (!existsSync(file)) {
    console.error(`MISSING FILE: ${file}`);
    failed++;
  } else {
    console.log(`OK file: ${file}`);
  }
}

// Sanity: entitlements migration exists and references the expected tables.
try {
  const sql = readFileSync('workers/api/migrations/0008_entitlements.sql', 'utf8');
  for (const table of ['user_entitlements', 'entitlement_keys', 'entitlement_usage']) {
    if (!sql.includes(table)) {
      console.error(`MISSING TABLE in 0008_entitlements.sql: ${table}`);
      failed++;
    }
  }
} catch {
  // file-missing path already reported above
}

if (failed) {
  console.error(`\n${failed} deploy gate(s) failed. Fix the items above before deploying.`);
  process.exit(1);
}
console.log('\nAll deploy gates passed.');
