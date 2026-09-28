BEGIN;
CREATE TABLE app.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id),
  author_member_id uuid NOT NULL,
  latest_revision integer NOT NULL DEFAULT 1,
  published_revision integer,
  version bigint NOT NULL DEFAULT 1,
  request_key uuid NOT NULL,
  request_hash bytea NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (map_id,author_member_id) REFERENCES app.map_members(map_id,id),
  UNIQUE(map_id,id), UNIQUE(map_id,author_member_id,request_key)
);
CREATE TABLE app.proposal_versions (
  map_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision>0),
  status text NOT NULL CHECK (status IN ('draft','in_review','published','archived')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='array'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(proposal_id,revision),
  FOREIGN KEY(map_id,proposal_id) REFERENCES app.proposals(map_id,id)
);
ALTER TABLE app.proposals ADD CONSTRAINT proposal_latest_fk FOREIGN KEY(id,latest_revision) REFERENCES app.proposal_versions(proposal_id,revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.proposals ADD CONSTRAINT proposal_published_fk FOREIGN KEY(id,published_revision) REFERENCES app.proposal_versions(proposal_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX proposals_map_idx ON app.proposals(map_id,updated_at DESC,id);
GRANT SELECT,INSERT,UPDATE,DELETE ON app.proposals,app.proposal_versions TO app_backend;
REVOKE ALL ON app.proposals,app.proposal_versions FROM PUBLIC,anon,authenticated;
ALTER TABLE app.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.proposal_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app.proposals FOR ALL TO app_backend USING(true) WITH CHECK(true);
CREATE POLICY backend_access ON app.proposal_versions FOR ALL TO app_backend USING(true) WITH CHECK(true);
COMMIT;
