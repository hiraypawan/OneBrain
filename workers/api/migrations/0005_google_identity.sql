-- Google is the only account login method. Preserve user data; never auto-link by email.
CREATE TABLE google_identities (
 subject TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 verified_email TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE google_login_states (
 state_hash TEXT PRIMARY KEY,
 browser_hash TEXT NOT NULL,
 sealed TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
ALTER TABLE platform_sessions ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'legacy';
-- Existing password sessions must not survive the Google-only cutover.
DELETE FROM platform_sessions;
DELETE FROM reset_tokens;
