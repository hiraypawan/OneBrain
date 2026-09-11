-- Additive: legacy conversations are not silently assigned to team workspaces.
CREATE TABLE platform_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX platform_sessions_user ON platform_sessions(user_id);
CREATE TABLE platform_rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE spaces (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL, settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE space_members (
 space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),
 joined_at INTEGER NOT NULL, PRIMARY KEY(space_id,user_id)
);
CREATE TABLE space_invites (
 token_hash TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
 expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, accepted_by TEXT
);
CREATE TABLE space_records (
 id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, mutation_id TEXT NOT NULL
);
CREATE INDEX space_records_scope ON space_records(space_id,updated_at);
CREATE TABLE connections (
 id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, secret TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('connected','revoked','error')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX connections_scope ON connections(space_id);
CREATE TABLE oauth_states (
 state_hash TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, provider TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 connection_id TEXT REFERENCES connections(id), action TEXT NOT NULL, payload TEXT NOT NULL,
 plan TEXT NOT NULL, plan_hash TEXT NOT NULL, approved_hash TEXT, approved_by TEXT,
 status TEXT NOT NULL CHECK(status IN ('draft','queued','running','verified','accepted','failed','unknown','cancelled','paused')),
 revision INTEGER NOT NULL DEFAULT 1, next_run INTEGER NOT NULL, runs INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, lease_id TEXT, lease_until INTEGER,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 last_error TEXT, mutation_id TEXT NOT NULL
);
CREATE INDEX jobs_due ON jobs(status,next_run);
CREATE INDEX jobs_scope ON jobs(space_id,created_at);
CREATE TABLE job_receipts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 run_number INTEGER NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL,
 destination_id TEXT, evidence TEXT NOT NULL, UNIQUE(job_id,run_number)
);
CREATE TABLE space_notifications (
 id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(job_id)
);
CREATE TABLE space_audit (
 id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, operation TEXT NOT NULL, subject_id TEXT NOT NULL,
 at INTEGER NOT NULL, detail TEXT NOT NULL
);
CREATE INDEX space_audit_scope ON space_audit(space_id,at);
CREATE TABLE space_imports (
 id TEXT NOT NULL, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(space_id,id)
);
-- Guard JSON relationships inside the database too, including concurrent requests.
CREATE TRIGGER record_links_insert BEFORE INSERT ON space_records BEGIN
 SELECT CASE WHEN EXISTS(SELECT value FROM json_each(NEW.data,'$.links') UNION SELECT value FROM json_each(NEW.data,'$.dependencies')) THEN RAISE(ABORT,'Create records before attaching relationships') END;
END;
CREATE TRIGGER record_links_update BEFORE UPDATE OF data ON space_records BEGIN
 SELECT CASE WHEN EXISTS(SELECT value FROM json_each(NEW.data,'$.links') WHERE value=NEW.id OR NOT EXISTS(SELECT 1 FROM space_records WHERE id=value AND space_id=NEW.space_id)) OR EXISTS(SELECT value FROM json_each(NEW.data,'$.dependencies') WHERE value=NEW.id OR NOT EXISTS(SELECT 1 FROM space_records WHERE id=value AND space_id=NEW.space_id)) THEN RAISE(ABORT,'Invalid scoped relationship') END;
 SELECT CASE WHEN EXISTS(WITH RECURSIVE deps(id) AS(SELECT value FROM json_each(NEW.data,'$.dependencies') UNION SELECT d.value FROM deps JOIN space_records r ON r.id=deps.id AND r.space_id=NEW.space_id,json_each(r.data,'$.dependencies') d) SELECT 1 FROM deps WHERE id=NEW.id) THEN RAISE(ABORT,'Circular dependency') END;
END;
CREATE TRIGGER record_links_delete BEFORE DELETE ON space_records WHEN EXISTS(SELECT 1 FROM spaces WHERE id=OLD.space_id) BEGIN
 SELECT CASE WHEN EXISTS(SELECT r.id FROM space_records r,json_each(r.data,'$.links') l WHERE r.space_id=OLD.space_id AND l.value=OLD.id AND r.id!=OLD.id) OR EXISTS(SELECT r.id FROM space_records r,json_each(r.data,'$.dependencies') d WHERE r.space_id=OLD.space_id AND d.value=OLD.id AND r.id!=OLD.id) THEN RAISE(ABORT,'Record still has dependent links') END;
END;
