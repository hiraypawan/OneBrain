// Local entitlements: Free / Pro / Family gates + quotas. No checkout is
// connected yet, so upgrades use beta keys (validated locally) with honest
// labeling everywhere: "Beta unlock — billing connects at launch."
// Quotas are enforced in the feature engine; this module is pure policy.

export type PlanId = 'free' | 'pro' | 'family';

export interface PlanInfo {
  id: PlanId;
  name: string;
  price: string;
  blurb: string;
}

export const PLANS: PlanInfo[] = [
  { id: 'free', name: 'Free', price: '₹0', blurb: 'Voice logging, recall, timers, translator trial, tutor + coach. Generous forever.' },
  { id: 'pro', name: 'Pro', price: '₹499/mo', blurb: 'Unlimited memory depth, all personas, deep research, scribe, priority brain, expense exports.' },
  { id: 'family', name: 'Family', price: '₹799/mo', blurb: 'Everything in Pro + story mode unlimited, kid profiles, household space.' },
];

export interface QuotaUse {
  researchDay: string; researchCount: number;
  emailMonth: string; emailCount: number;
  translateMins: number; // per translator session
  storyTrial: number; // total trial episodes used
  scribeDay: string; scribeCount: number;
}

export const EMPTY_QUOTA: QuotaUse = {
  researchDay: '', researchCount: 0,
  emailMonth: '', emailCount: 0,
  translateMins: 0, storyTrial: 0,
  scribeDay: '', scribeCount: 0,
};

export const FREE_LIMITS = {
  researchPerDay: 3,
  emailDraftsPerMonth: 10,
  translateMinsPerSession: 5,
  storyTrialEpisodes: 3,
  scribePerDay: 5,
  recallDays: 30,
};

export type GatedFeature =
  | 'research-deep'
  | 'persona-pro'
  | 'story-full'
  | 'unlimited-memory'
  | 'priority-brain'
  | 'expense-export'
  | 'family-scopes';

export function planAllows(plan: PlanId, feature: GatedFeature): boolean {
  if (feature === 'family-scopes') return plan === 'family';
  if (feature === 'story-full') return plan === 'pro' || plan === 'family';
  if (feature === 'persona-pro') return plan === 'pro' || plan === 'family';
  if (feature === 'research-deep') return plan === 'pro' || plan === 'family';
  if (feature === 'unlimited-memory') return plan === 'pro' || plan === 'family';
  if (feature === 'priority-brain') return plan === 'pro' || plan === 'family';
  if (feature === 'expense-export') return plan === 'pro' || plan === 'family';
  return false;
}

const BETA_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Beta key validation. Format: OB-PRO-XXXXXX or OB-FAM-XXXXXX; last char is a check digit. */
export function validateBetaKey(raw: string): PlanId | null {
  const key = String(raw || '').trim().toUpperCase().replace(/[\s-]/g, '');
  const m = key.match(/^OB(PRO|FAM)([A-Z2-9]{6})$/);
  if (!m) return null;
  // Check digit: 6th char must equal alphabet[sum(first 5) % len].
  // Simple, documented, beta-only — real billing verifies server-side.
  const body = m[2];
  const sum = [...body.slice(0, 5)].reduce((a, c) => a + c.charCodeAt(0), 0);
  if (body[5] !== BETA_ALPHABET[sum % BETA_ALPHABET.length]) return null;
  return m[1] === 'FAM' ? 'family' : 'pro';
}

/** Generate a valid beta key (used by tests/docs; operators mint these). */
export function mintBetaKey(plan: 'pro' | 'family', seed = 'BETA01'): string {
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

export function quotaMessage(feature: string, plan: PlanId): string {
  if (plan !== 'free') return '';
  const map: Record<string, string> = {
    research: `Free plan: ${FREE_LIMITS.researchPerDay} research briefs a day. Pro unlocks unlimited deep briefs.`,
    email: `Free plan: ${FREE_LIMITS.emailDraftsPerMonth} email drafts a month. Pro unlocks unlimited drafts + tone memory.`,
    translate: `Free translator trial: ${FREE_LIMITS.translateMinsPerSession} minutes per session. Pro unlocks unlimited translation.`,
    story: `Story trial over (${FREE_LIMITS.storyTrialEpisodes} episodes). Family unlocks unlimited bedtime stories + kid profiles.`,
    scribe: `Free plan: ${FREE_LIMITS.scribePerDay} scribe summaries a day. Pro unlocks unlimited.`,
    persona: 'This mentor is a Pro feature on the free plan. Your English Tutor and Gym Coach stay free forever.',
    memory: `Free recall covers the last ${FREE_LIMITS.recallDays} days. Pro unlocks unlimited time-travel.`,
  };
  return map[feature] || 'This is a Pro feature on the free plan.';
}
