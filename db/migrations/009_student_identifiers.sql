BEGIN;

-- Local student identifiers resemble emails but never represent verified mailboxes.
-- Keep their namespace and authority separate from Supabase/Google identities.
ALTER TABLE app.principals ADD COLUMN auth_source text NOT NULL DEFAULT 'supabase'
  CHECK (auth_source IN ('supabase','student_id'));
ALTER TABLE app.principals DROP CONSTRAINT principals_check;
ALTER TABLE app.principals ADD CONSTRAINT principal_auth_identity CHECK (
  (auth_source='supabase' AND ((kind='account')=(auth_user_id IS NOT NULL)))
  OR (auth_source='student_id' AND kind='account' AND auth_user_id IS NULL
      AND account_role IS NOT NULL AND account_role='student')
);

CREATE TABLE app_private.student_credentials (
  principal_id uuid PRIMARY KEY REFERENCES app.principals(id) ON DELETE CASCADE,
  identifier text NOT NULL UNIQUE CHECK (
    char_length(identifier) BETWEEN 3 AND 254
    AND identifier=lower(btrim(identifier))
    AND identifier ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  salt bytea NOT NULL CHECK (octet_length(salt)=32),
  password_hash bytea NOT NULL CHECK (octet_length(password_hash)=32),
  algorithm text NOT NULL DEFAULT 'scrypt-v1' CHECK (algorithm='scrypt-v1'),
  scrypt_n integer NOT NULL DEFAULT 32768 CHECK (scrypt_n=32768),
  scrypt_r integer NOT NULL DEFAULT 8 CHECK (scrypt_r=8),
  scrypt_p integer NOT NULL DEFAULT 3 CHECK (scrypt_p=3),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.student_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app_private.student_credentials
  FOR ALL TO app_backend USING (true) WITH CHECK (true);
REVOKE ALL ON app_private.student_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.student_credentials TO app_backend;

COMMIT;
