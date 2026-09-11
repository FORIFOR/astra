-- migrate:up
CREATE TABLE initial_profiles (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  payload jsonb NOT NULL,
  lease_id uuid,
  lease_until timestamptz,
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE initial_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE initial_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY initial_profiles_tenant_isolation ON initial_profiles
  USING (tenant_id = astra_current_tenant()) WITH CHECK (tenant_id = astra_current_tenant());
-- migrate:down
DROP TABLE initial_profiles;
