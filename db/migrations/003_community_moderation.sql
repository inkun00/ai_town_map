BEGIN;

ALTER TABLE app.observations
  ADD COLUMN moderation_reason text CHECK (char_length(moderation_reason) <= 500),
  ADD COLUMN moderated_at timestamptz,
  ADD COLUMN moderated_by uuid REFERENCES app.principals(id),
  ADD COLUMN deleted_at timestamptz;

CREATE TABLE app.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  author_member_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (map_id,observation_id) REFERENCES app.observations(map_id,id),
  FOREIGN KEY (map_id,author_member_id) REFERENCES app.map_members(map_id,id),
  UNIQUE (map_id,id)
);

CREATE TABLE app.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id),
  reporter_member_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('observation','comment')),
  target_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('privacy','unsafe','spam','other')),
  detail text CHECK (char_length(detail) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolution_reason text CHECK (char_length(resolution_reason) <= 500),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (map_id,reporter_member_id) REFERENCES app.map_members(map_id,id),
  UNIQUE (map_id,id)
);

CREATE TABLE app.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id),
  actor_principal_id uuid NOT NULL REFERENCES app.principals(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comments_observation_idx ON app.comments(map_id,observation_id,created_at,id);
CREATE INDEX reports_map_status_idx ON app.reports(map_id,status,created_at DESC,id);
CREATE UNIQUE INDEX reports_one_open_per_reporter_idx ON app.reports(map_id,reporter_member_id,target_type,target_id) WHERE status='open';
CREATE INDEX audit_events_map_idx ON app.audit_events(map_id,created_at DESC,id);

GRANT SELECT,INSERT,UPDATE,DELETE ON app.comments,app.reports,app.audit_events TO app_backend;
REVOKE ALL ON app.comments,app.reports,app.audit_events FROM PUBLIC,anon,authenticated;
ALTER TABLE app.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app.comments FOR ALL TO app_backend USING (true) WITH CHECK (true);
CREATE POLICY backend_access ON app.reports FOR ALL TO app_backend USING (true) WITH CHECK (true);
CREATE POLICY backend_access ON app.audit_events FOR ALL TO app_backend USING (true) WITH CHECK (true);

COMMIT;
