BEGIN;

CREATE TABLE app.observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES app.maps(id),
  author_member_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  body text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 2000),
  location_label text NOT NULL CHECK (char_length(location_label) BETWEEN 1 AND 120),
  location_source text NOT NULL CHECK (location_source IN ('gps','search','manual')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  category_id uuid NOT NULL,
  emoji_option_id uuid NOT NULL,
  rating_option_id uuid,
  answers jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
  improvement_idea text CHECK (char_length(improvement_idea) <= 1000),
  link_url text CHECK (char_length(link_url) <= 2000),
  status text NOT NULL CHECK (status IN ('pending','published','hidden','deleted')),
  config_revision integer NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (map_id, author_member_id) REFERENCES app.map_members(map_id,id),
  FOREIGN KEY (map_id, category_id) REFERENCES app.categories(map_id,id),
  FOREIGN KEY (map_id, category_id, emoji_option_id) REFERENCES app.emoji_options(map_id,category_id,id),
  FOREIGN KEY (map_id, rating_option_id) REFERENCES app.rating_options(map_id,id),
  UNIQUE (map_id,id)
);

CREATE TABLE app.observation_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL,
  observation_id uuid NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES app.principals(id),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 2097152),
  mime text NOT NULL CHECK (mime = 'image/webp'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (map_id,observation_id) REFERENCES app.observations(map_id,id)
);

CREATE INDEX observations_map_status_idx ON app.observations(map_id,status,created_at DESC,id);
CREATE INDEX observations_author_idx ON app.observations(author_member_id,status,created_at DESC);
CREATE INDEX observations_coords_idx ON app.observations(map_id,lat,lng) WHERE status='published';

GRANT SELECT, INSERT, UPDATE, DELETE ON app.observations,app.observation_photos TO app_backend;
REVOKE ALL ON app.observations,app.observation_photos FROM PUBLIC,anon,authenticated;
ALTER TABLE app.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.observation_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app.observations FOR ALL TO app_backend USING (true) WITH CHECK (true);
CREATE POLICY backend_access ON app.observation_photos FOR ALL TO app_backend USING (true) WITH CHECK (true);

COMMIT;
