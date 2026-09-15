import { BETA_ALPHABET } from '../../lib/plans';

/**
 * Test-only minting of the legacy device-beta key format.
 *
 * This deliberately lives under `__tests__/` so the generator is never part of
 * the shipped client bundle. Real keys are minted by an operator
 * (`scripts/mint-entitlement-keys.mjs`) and stored server-side as hashes.
 */
export function mintTestBetaKey(plan: 'pro' | 'family', seed = 'BETA01'): string {
  let body = '';
  let h = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  for (let i = 0; i < 5; i++) {
    h = (h * 31 + 7) % 997;
    body += BETA_ALPHABET[h % BETA_ALPHABET.length];
  }
  const sum = [...body].reduce((a, c) => a + c.charCodeAt(0), 0);
  body += BETA_ALPHABET[sum % BETA_ALPHABET.length];
  return `OB-${plan === 'family' ? 'FAM' : 'PRO'}-${body}`;
}
