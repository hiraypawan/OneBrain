-- Password changes through either API invalidate existing platform sessions.
ALTER TABLE platform_sessions ADD COLUMN password_fingerprint TEXT;
UPDATE platform_sessions SET password_fingerprint=(SELECT password_hash FROM users WHERE users.id=platform_sessions.user_id);
