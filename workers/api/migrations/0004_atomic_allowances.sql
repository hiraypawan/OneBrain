-- Enforce per-workspace caps inside the write transaction, including concurrent imports.
CREATE TRIGGER space_allowance BEFORE INSERT ON spaces
WHEN (SELECT COUNT(*) FROM spaces WHERE owner_id=NEW.owner_id)>=20
BEGIN
 SELECT RAISE(ABORT, 'Workspace allowance reached');
END;
CREATE TRIGGER record_allowance BEFORE INSERT ON space_records
WHEN (SELECT COUNT(*) FROM space_records WHERE space_id=NEW.space_id)>=2000
BEGIN
 SELECT RAISE(ABORT, 'Record allowance reached');
END;
CREATE TRIGGER connection_allowance BEFORE INSERT ON connections
WHEN (SELECT COUNT(*) FROM connections WHERE space_id=NEW.space_id)>=20
BEGIN
 SELECT RAISE(ABORT, 'Connection allowance reached');
END;
CREATE TRIGGER job_allowance BEFORE INSERT ON jobs
WHEN (SELECT COUNT(*) FROM jobs WHERE space_id=NEW.space_id)>=500
BEGIN
 SELECT RAISE(ABORT, 'Job allowance reached');
END;
