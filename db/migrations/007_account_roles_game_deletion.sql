BEGIN;
ALTER TABLE app.principals ADD COLUMN account_role text
  CHECK(account_role IN ('teacher','student','member'));
ALTER TABLE app.principals ADD CONSTRAINT guest_has_no_account_role
  CHECK(kind='account' OR account_role IS NULL);
ALTER TABLE app.game_maps ADD COLUMN deleted_at timestamptz;
ALTER TABLE app.game_maps ADD CONSTRAINT deleted_game_is_archived CHECK(deleted_at IS NULL OR status='archived');
CREATE INDEX game_maps_deleted ON app.game_maps(created_by,deleted_at) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION app_private.expire_game_rooms() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,app_private AS $$ BEGIN
  UPDATE app.game_rooms r SET status='ended',ended_at=COALESCE(r.ends_at,clock_timestamp())
  WHERE r.status<>'ended' AND ((r.status='running' AND r.ends_at<=clock_timestamp()) OR (r.status='lobby' AND r.join_expires_at<=clock_timestamp())
    OR EXISTS(SELECT 1 FROM app.game_maps g JOIN app.maps m ON m.id=g.source_map_id WHERE g.id=r.game_id AND (g.deleted_at IS NOT NULL OR g.status<>'active' OR m.status<>'active')));
  UPDATE app.game_players p SET lat=NULL,lng=NULL,accuracy=NULL,observed_at=NULL,
    sharing=CASE WHEN r.status='ended' THEN false ELSE p.sharing END
  FROM app.game_rooms r WHERE r.id=p.room_id AND (r.status='ended' OR p.observed_at<clock_timestamp()-interval '90 seconds');
END $$;
REVOKE ALL ON FUNCTION app_private.expire_game_rooms() FROM PUBLIC,anon,authenticated,app_backend;

-- Preserve the existing content purge and extend its already scheduled entry point.
ALTER FUNCTION app_private.purge_expired_content() RENAME TO purge_expired_content_v1;
CREATE FUNCTION app_private.purge_expired_content() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app,app_private AS $$
DECLARE result jsonb; removed_games integer; BEGIN
  DELETE FROM app.game_maps WHERE id IN (
    SELECT id FROM app.game_maps WHERE deleted_at<clock_timestamp()-interval '30 days'
    ORDER BY deleted_at,id LIMIT 200 FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS removed_games=ROW_COUNT;
  result:=app_private.purge_expired_content_v1();
  RETURN result || jsonb_build_object('gameMaps',removed_games);
END $$;
REVOKE ALL ON FUNCTION app_private.purge_expired_content(),app_private.purge_expired_content_v1() FROM PUBLIC,anon,authenticated,app_backend;
COMMIT;
