BEGIN;
CREATE TABLE app.game_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_map_id uuid NOT NULL REFERENCES app.maps(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES app.principals(id),
  request_id uuid NOT NULL,
  title text NOT NULL CHECK(char_length(title) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK(char_length(description)<=500),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(created_by,request_id)
);
CREATE TABLE app.game_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid NOT NULL REFERENCES app.game_maps(id) ON DELETE CASCADE,
  source_observation_id uuid, title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80),
  emoji text NOT NULL CHECK(char_length(emoji) BETWEEN 1 AND 16),
  lat double precision NOT NULL CHECK(lat BETWEEN -90 AND 90),lng double precision NOT NULL CHECK(lng BETWEEN -180 AND 180),
  UNIQUE(game_id,id)
);
CREATE TABLE app.game_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid NOT NULL REFERENCES app.game_maps(id) ON DELETE CASCADE,
  point_id uuid NOT NULL,definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(game_id,point_id) REFERENCES app.game_points(game_id,id) ON DELETE CASCADE
);
CREATE TABLE app.game_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid NOT NULL REFERENCES app.game_maps(id) ON DELETE CASCADE,
  host_principal_id uuid NOT NULL REFERENCES app.principals(id),
  title text NOT NULL CHECK(char_length(title) BETWEEN 2 AND 80),
  join_code text NOT NULL,code_hmac bytea NOT NULL UNIQUE CHECK(octet_length(code_hmac)=32),
  request_id uuid NOT NULL, status text NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby','running','ended')),
  duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 180),
  max_players integer NOT NULL CHECK(max_players BETWEEN 1 AND 200),
  starts_at timestamptz,ends_at timestamptz,ended_at timestamptz,
  join_expires_at timestamptz NOT NULL DEFAULT (now()+interval '2 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(host_principal_id,request_id),
  CHECK((status='lobby') OR ended_at IS NOT NULL OR (starts_at IS NOT NULL AND ends_at IS NOT NULL))
);
CREATE TABLE app.game_room_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),room_id uuid NOT NULL REFERENCES app.game_rooms(id) ON DELETE CASCADE,
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),UNIQUE(room_id,id)
);
CREATE TABLE app.game_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),room_id uuid NOT NULL REFERENCES app.game_rooms(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES app.principals(id),nickname text NOT NULL CHECK(char_length(nickname) BETWEEN 2 AND 20),
  location_consent_at timestamptz NOT NULL DEFAULT now(),sharing boolean NOT NULL DEFAULT true,
  lat double precision CHECK(lat BETWEEN -90 AND 90),lng double precision CHECK(lng BETWEEN -180 AND 180),
  accuracy double precision CHECK(accuracy BETWEEN 0 AND 10000),observed_at timestamptz,last_seen_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),UNIQUE(room_id,principal_id),UNIQUE(room_id,id),
  CHECK((lat IS NULL AND lng IS NULL AND accuracy IS NULL AND observed_at IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL AND accuracy IS NOT NULL AND observed_at IS NOT NULL))
);
CREATE UNIQUE INDEX game_player_nickname ON app.game_players(room_id,lower(nickname));
CREATE TABLE app.game_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),room_id uuid NOT NULL REFERENCES app.game_rooms(id) ON DELETE CASCADE,
  player_id uuid NOT NULL,mission_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('incorrect','pending','approved','rejected')),
  response jsonb NOT NULL,attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 10),
  score integer NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 1000),reason text CHECK(char_length(reason)<=500),
  version bigint NOT NULL DEFAULT 1,submitted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(room_id,player_id) REFERENCES app.game_players(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY(room_id,mission_id) REFERENCES app.game_room_missions(room_id,id) ON DELETE CASCADE,
  UNIQUE(player_id,mission_id),CHECK((status='approved' AND score>0) OR (status<>'approved' AND score=0))
);
CREATE TABLE app.game_attempt_requests (
  room_id uuid NOT NULL REFERENCES app.game_rooms(id) ON DELETE CASCADE,player_id uuid NOT NULL,mission_id uuid NOT NULL,
  request_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,
  FOREIGN KEY(room_id,player_id) REFERENCES app.game_players(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY(room_id,mission_id) REFERENCES app.game_room_missions(room_id,id) ON DELETE CASCADE,
  PRIMARY KEY(player_id,mission_id,request_id)
);
CREATE INDEX game_maps_source ON app.game_maps(source_map_id,created_at DESC);
CREATE INDEX game_rooms_host ON app.game_rooms(host_principal_id,created_at DESC);
CREATE INDEX game_rooms_expiry ON app.game_rooms(status,ends_at,join_expires_at) WHERE status<>'ended';
CREATE INDEX game_submissions_room ON app.game_submissions(room_id,status);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['game_maps','game_points','game_missions','game_rooms','game_room_missions','game_players','game_submissions','game_attempt_requests'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY backend_access ON app.%I FOR ALL TO app_backend USING(true) WITH CHECK(true)',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO app_backend',t);
    EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,anon,authenticated',t);
  END LOOP;
END $$;
-- No history: retain only a recent position while the class room is open.
CREATE FUNCTION app_private.expire_game_rooms() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,app_private AS $$ BEGIN
  UPDATE app.game_rooms r SET status='ended',ended_at=COALESCE(r.ends_at,clock_timestamp())
  WHERE r.status<>'ended' AND ((r.status='running' AND r.ends_at<=clock_timestamp()) OR (r.status='lobby' AND r.join_expires_at<=clock_timestamp())
    OR EXISTS(SELECT 1 FROM app.game_maps g JOIN app.maps m ON m.id=g.source_map_id WHERE g.id=r.game_id AND (g.status<>'active' OR m.status<>'active')));
  UPDATE app.game_players p SET lat=NULL,lng=NULL,accuracy=NULL,observed_at=NULL,
    sharing=CASE WHEN r.status='ended' THEN false ELSE p.sharing END
  FROM app.game_rooms r WHERE r.id=p.room_id AND (r.status='ended' OR p.observed_at<clock_timestamp()-interval '90 seconds');
END $$;
REVOKE ALL ON FUNCTION app_private.expire_game_rooms() FROM PUBLIC,anon,authenticated,app_backend;
COMMIT;
