-- migrate:up
ALTER TABLE initial_profiles ADD COLUMN artifact_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
-- migrate:down
ALTER TABLE initial_profiles DROP COLUMN artifact_snapshot;
