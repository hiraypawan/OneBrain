-- Replace the existing index; don't add another per-job index write.
DROP INDEX jobs_scope;
CREATE INDEX jobs_scope ON jobs(space_id, created_at DESC, id DESC);
