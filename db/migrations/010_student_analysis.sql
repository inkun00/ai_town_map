BEGIN;

-- Private, student-authored writing is independent of shared proposal publishing.
CREATE TABLE app.student_analysis_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES app.principals(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  analysis text NOT NULL DEFAULT '' CHECK (char_length(analysis) <= 10000),
  proposal text NOT NULL DEFAULT '' CHECK (char_length(proposal) <= 10000),
  reasoning text NOT NULL DEFAULT '' CHECK (char_length(reasoning) <= 10000),
  follow_up text NOT NULL DEFAULT '' CHECK (char_length(follow_up) <= 5000),
  evidence_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(evidence_ids) <= 30),
  status text NOT NULL CHECK (status IN ('draft','final')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  data_revision bigint NOT NULL CHECK (data_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (map_id,principal_id),
  CHECK (status <> 'final' OR (
    char_length(btrim(title)) > 0 AND char_length(btrim(analysis)) > 0
    AND char_length(btrim(proposal)) > 0 AND char_length(btrim(reasoning)) > 0
    AND cardinality(evidence_ids) > 0
  ))
);

GRANT SELECT,INSERT,UPDATE,DELETE ON app.student_analysis_reports TO app_backend;
REVOKE ALL ON app.student_analysis_reports FROM PUBLIC,anon,authenticated;
ALTER TABLE app.student_analysis_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app.student_analysis_reports FOR ALL TO app_backend USING(true) WITH CHECK(true);

COMMIT;
