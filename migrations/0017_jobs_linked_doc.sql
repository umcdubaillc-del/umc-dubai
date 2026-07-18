-- B2b Slice 1 — job↔invoice forward link.
-- The running-schema source of truth is admin.js's addMissingColumns(env,"jobs",[…]);
-- this file mirrors it for the canonical migration trail.
ALTER TABLE jobs ADD COLUMN linked_doc_number TEXT;
