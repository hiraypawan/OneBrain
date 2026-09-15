-- Server-authoritative entitlements: who is on which plan, which operator-
-- minted keys exist (hashes only) and a bounded usage ledger per user.
-- Additive: an absent row means Free. No payment data is stored anywhere and
-- no paid overflow exists; keys are minted by an operator.
CREATE TABLE user_entitlements (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK(plan IN ('free','pro','family')),
  source TEXT NOT NULL CHECK(source IN ('operator','key','legacy-beta','import')),
  granted_by TEXT,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  receipt TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE entitlement_keys (
  key_hash TEXT PRIMARY KEY,
  plan TEXT NOT NULL CHECK(plan IN ('pro','family')),
  label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  redeemed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at INTEGER
);
CREATE INDEX entitlement_keys_redeemed ON entitlement_keys(redeemed_by);
CREATE TABLE entitlement_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, feature, period)
);
CREATE INDEX entitlement_usage_sweep ON entitlement_usage(period);
CREATE TABLE entitlement_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  actor_id TEXT,
  operation TEXT NOT NULL,
  at INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX entitlement_events_scope ON entitlement_events(user_id, at DESC);
