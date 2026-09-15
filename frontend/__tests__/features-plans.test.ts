import { describe, it, expect } from 'vitest';
import {
  planAllows, validateBetaKey, mintBetaKey, quotaMessage, PLANS, FREE_LIMITS,
} from '../lib/plans';

describe('planAllows', () => {
  it('gates features by plan', () => {
    expect(planAllows('free', 'story-full')).toBe(false);
    expect(planAllows('pro', 'story-full')).toBe(true);
    expect(planAllows('pro', 'family-scopes')).toBe(false);
    expect(planAllows('family', 'family-scopes')).toBe(true);
    expect(planAllows('family', 'expense-export')).toBe(true);
  });
});

describe('beta keys', () => {
  it('mints and validates keys', () => {
    const pro = mintBetaKey('pro');
    const fam = mintBetaKey('family', 'OTHERSEED');
    expect(validateBetaKey(pro)).toBe('pro');
    expect(validateBetaKey(fam)).toBe('family');
    expect(validateBetaKey(' OB-pro-' + pro.slice(-6).toLowerCase() + ' ')).toBe('pro');
  });
  it('rejects garbage', () => {
    expect(validateBetaKey('hello')).toBeNull();
    expect(validateBetaKey('OB-PRO-AAAAAA')).toBeNull();
    expect(validateBetaKey('')).toBeNull();
  });
});

describe('quotaMessage', () => {
  it('explains free limits', () => {
    expect(quotaMessage('research', 'free')).toMatch(/3/);
    expect(quotaMessage('research', 'pro')).toBe('');
  });
  it('ships three plans with free limits', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['free', 'pro', 'family']);
    expect(FREE_LIMITS.recallDays).toBe(30);
  });
});
