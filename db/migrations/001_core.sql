BEGIN;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app, app_private FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
    CREATE ROLE app_backend NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE app.principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('account','guest')),
  auth_user_id uuid UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'account') = (auth_user_id IS NOT NULL))
);

CREATE TABLE app.theme_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (theme_key, version)
);

CREATE TABLE app.maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_principal_id uuid NOT NULL REFERENCES app.principals(id),
  template_id uuid NOT NULL REFERENCES app.theme_templates(id),
  theme_key text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 60),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  location_label text NOT NULL CHECK (char_length(location_label) BETWEEN 1 AND 120),
  activity_context text NOT NULL CHECK (activity_context IN ('school','community')),
  center_lat double precision CHECK (center_lat BETWEEN -90 AND 90),
  center_lng double precision CHECK (center_lng BETWEEN -180 AND 180),
  initial_zoom integer NOT NULL DEFAULT 5 CHECK (initial_zoom BETWEEN 1 AND 14),
  visibility text NOT NULL CHECK (visibility IN ('public','invite_only')),
  participation text NOT NULL DEFAULT 'invited' CHECK (participation IN ('invited','admin_only','closed')),
  moderation text NOT NULL DEFAULT 'immediate' CHECK (moderation IN ('immediate','approval')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived','deleted')),
  pin_mode text NOT NULL CHECK (pin_mode IN ('rating','category','single')),
  single_color text CHECK (single_color ~ '^#[0-9A-Fa-f]{6}$'),
  rating_enabled boolean NOT NULL,
  ideas_enabled boolean NOT NULL,
  proposals_enabled boolean NOT NULL,
  comments_enabled boolean NOT NULL,
  theme_locked_at timestamptz,
  config_revision integer NOT NULL DEFAULT 1,
  data_revision bigint NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app.principals(id),
  UNIQUE (id, owner_principal_id),
  CHECK (pin_mode <> 'rating' OR rating_enabled),
  CHECK (pin_mode <> 'single' OR single_color IS NOT NULL),
  CHECK ((center_lat IS NULL) = (center_lng IS NULL))
);

CREATE TABLE app.map_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id),
  principal_id uuid NOT NULL REFERENCES app.principals(id),
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 20),
  role text NOT NULL DEFAULT 'participant' CHECK (role IN ('admin','participant')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','left')),
  version bigint NOT NULL DEFAULT 1,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (map_id, principal_id),
  UNIQUE (map_id, id)
);

CREATE TABLE app.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id),
  key text NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  color text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  default_emoji_id uuid,
  sort_order integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (map_id, key), UNIQUE (map_id, id)
);

CREATE TABLE app.emoji_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL,
  category_id uuid NOT NULL,
  key text NOT NULL,
  glyph text NOT NULL CHECK (char_length(glyph) BETWEEN 1 AND 16),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  sort_order integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY (map_id, category_id) REFERENCES app.categories(map_id, id),
  UNIQUE (map_id, category_id, key),
  UNIQUE (map_id, category_id, id)
);

ALTER TABLE app.categories ADD CONSTRAINT categories_default_emoji_fk
  FOREIGN KEY (map_id, id, default_emoji_id)
  REFERENCES app.emoji_options(map_id, category_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE app.rating_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL UNIQUE REFERENCES app.maps(id),
  label text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (map_id, id)
);

CREATE TABLE app.rating_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  symbol text NOT NULL,
  ordinal integer NOT NULL,
  FOREIGN KEY (map_id, scheme_id) REFERENCES app.rating_schemes(map_id, id),
  UNIQUE (scheme_id, key), UNIQUE (scheme_id, ordinal), UNIQUE (map_id, id)
);

CREATE TABLE app.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id),
  key text NOT NULL,
  current_version_id uuid,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL,
  UNIQUE (map_id, key), UNIQUE (map_id, id)
);

CREATE TABLE app.question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL,
  question_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  label text NOT NULL,
  type text NOT NULL CHECK (type IN ('rating3','boolean','single','multi','text')),
  required boolean NOT NULL,
  allow_unknown boolean NOT NULL,
  allow_na boolean NOT NULL,
  options jsonb NOT NULL DEFAULT '[]',
  max_length integer,
  FOREIGN KEY (map_id, question_id) REFERENCES app.questions(map_id, id),
  UNIQUE (question_id, version), UNIQUE (map_id, question_id, id)
);

ALTER TABLE app.questions ADD CONSTRAINT questions_current_version_fk
  FOREIGN KEY (map_id, id, current_version_id)
  REFERENCES app.question_versions(map_id, question_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE app.map_config_revisions (
  map_id uuid NOT NULL REFERENCES app.maps(id),
  revision integer NOT NULL,
  definition jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (map_id, revision)
);

CREATE TABLE app_private.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES app.principals(id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_private.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id),
  code_hmac bytea NOT NULL UNIQUE CHECK (octet_length(code_hmac) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 1000),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  created_by uuid NOT NULL REFERENCES app.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (map_id, id)
);

CREATE TABLE app_private.invite_attempts (
  actor_hash bytea NOT NULL PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0)
);

CREATE TABLE app_private.idempotency_keys (
  principal_id uuid NOT NULL REFERENCES app.principals(id),
  route_scope text NOT NULL,
  key uuid NOT NULL,
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  resource_id uuid,
  response_code integer,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (principal_id, route_scope, key)
);

CREATE INDEX maps_public_idx ON app.maps(visibility, status, created_at DESC, id);
CREATE INDEX maps_owner_idx ON app.maps(owner_principal_id, status, created_at DESC);
CREATE INDEX members_principal_idx ON app.map_members(principal_id, status);
CREATE INDEX sessions_principal_idx ON app_private.sessions(principal_id, expires_at);
CREATE INDEX invites_map_idx ON app_private.invites(map_id, expires_at);

GRANT USAGE ON SCHEMA app, app_private TO app_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app, app_private TO app_backend;
REVOKE ALL ON ALL TABLES IN SCHEMA app, app_private FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON app.theme_templates FROM app_backend;
REVOKE UPDATE, DELETE ON app.map_config_revisions, app.question_versions FROM app_backend;

DO $$ DECLARE entry record; BEGIN
  FOR entry IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('app','app_private') LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', entry.schemaname, entry.tablename);
    EXECUTE format('CREATE POLICY backend_access ON %I.%I FOR ALL TO app_backend USING (true) WITH CHECK (true)', entry.schemaname, entry.tablename);
  END LOOP;
END $$;

COMMIT;
