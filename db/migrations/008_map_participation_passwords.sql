BEGIN;

-- Sharing controls contribution permissions, while active maps remain publicly readable.
-- Passwords are only available to the backend and never enter map response objects.
CREATE TABLE app_private.map_participation_passwords (
  map_id uuid PRIMARY KEY REFERENCES app.maps(id) ON DELETE CASCADE,
  salt bytea NOT NULL CHECK (octet_length(salt) = 32),
  password_hash bytea NOT NULL CHECK (octet_length(password_hash) = 32),
  algorithm text NOT NULL DEFAULT 'scrypt-v1' CHECK (algorithm = 'scrypt-v1'),
  updated_by uuid NOT NULL REFERENCES app.principals(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.map_participation_passwords ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app_private.map_participation_passwords
  FOR ALL TO app_backend USING (true) WITH CHECK (true);
REVOKE ALL ON app_private.map_participation_passwords FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.map_participation_passwords TO app_backend;
CREATE INDEX maps_directory_idx ON app.maps(status, created_at DESC, id);

COMMIT;
