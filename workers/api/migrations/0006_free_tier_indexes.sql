-- Target demonstrated tenant-list, inbox/receipt and expiry scans.
-- Index changes themselves consume writes; apply off-peak and measure remotely.
CREATE INDEX space_members_user ON space_members(user_id, space_id);
CREATE INDEX spaces_owner ON spaces(owner_id);
CREATE INDEX job_receipts_scope_time ON job_receipts(space_id, at DESC);
CREATE INDEX notifications_scope_time ON space_notifications(space_id, created_at DESC);
CREATE INDEX jobs_expired_leases ON jobs(status, lease_until) WHERE status='running';
CREATE INDEX sessions_expiry ON platform_sessions(expires_at);
CREATE INDEX google_login_expiry ON google_login_states(expires_at);
CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX rate_limits_expiry ON platform_rate_limits(expires_at);
CREATE INDEX invites_expiry ON space_invites(expires_at);
-- Replace, rather than duplicate, the existing record index for stable keyset pages.
DROP INDEX space_records_scope;
CREATE INDEX space_records_scope ON space_records(space_id, updated_at DESC, id DESC);
