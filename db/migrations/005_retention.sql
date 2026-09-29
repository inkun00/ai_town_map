BEGIN;

-- Only the database owner can invoke this routine. The application role has no EXECUTE grant.
CREATE FUNCTION app_private.purge_expired_content()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, app_private
AS $$
DECLARE
  cutoff timestamptz := clock_timestamp() - interval '30 days';
  map_row record;
  target_ids uuid[];
  comment_ids uuid[];
  report_ids uuid[];
  removed_maps integer := 0;
  removed_observations integer := 0;
  removed_comments integer := 0;
  removed_proposals integer := 0;
BEGIN
  -- Three configuration FKs and proposal revision FKs are cyclic and deferred.
  SET CONSTRAINTS ALL DEFERRED;

  -- A map is the deletion unit: all its records, photos, moderation and private invites go.
  FOR map_row IN
    SELECT id FROM app.maps
    WHERE status='deleted' AND deleted_at < cutoff
    ORDER BY deleted_at, id LIMIT 20 FOR UPDATE SKIP LOCKED
  LOOP
    DELETE FROM app.proposal_versions WHERE map_id=map_row.id;
    DELETE FROM app.proposals WHERE map_id=map_row.id;
    DELETE FROM app.audit_events WHERE map_id=map_row.id;
    DELETE FROM app.reports WHERE map_id=map_row.id;
    DELETE FROM app.comments WHERE map_id=map_row.id;
    DELETE FROM app.observation_photos WHERE map_id=map_row.id;
    DELETE FROM app.observations WHERE map_id=map_row.id;
    DELETE FROM app.map_config_revisions WHERE map_id=map_row.id;
    DELETE FROM app.question_versions WHERE map_id=map_row.id;
    DELETE FROM app.questions WHERE map_id=map_row.id;
    DELETE FROM app.rating_options WHERE map_id=map_row.id;
    DELETE FROM app.rating_schemes WHERE map_id=map_row.id;
    DELETE FROM app.emoji_options WHERE map_id=map_row.id;
    DELETE FROM app.categories WHERE map_id=map_row.id;
    DELETE FROM app_private.invites WHERE map_id=map_row.id;
    DELETE FROM app.map_members WHERE map_id=map_row.id;
    DELETE FROM app.maps WHERE id=map_row.id;
    removed_maps := removed_maps + 1;
  END LOOP;

  SELECT array_agg(id) INTO target_ids FROM (
    SELECT o.id FROM app.observations o JOIN app.maps m ON m.id=o.map_id
    WHERE m.status <> 'deleted' AND o.status='deleted' AND o.deleted_at < cutoff
    ORDER BY o.deleted_at, o.id LIMIT 500 FOR UPDATE OF o SKIP LOCKED
  ) targets;
  IF target_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO comment_ids FROM app.comments WHERE observation_id=ANY(target_ids);
    SELECT array_agg(id) INTO report_ids FROM app.reports
      WHERE (target_type='observation' AND target_id=ANY(target_ids))
         OR (target_type='comment' AND target_id=ANY(comment_ids));
    DELETE FROM app.audit_events
      WHERE (target_type='observation' AND target_id=ANY(target_ids))
         OR (target_type='comment' AND target_id=ANY(comment_ids))
         OR (target_type='report' AND target_id=ANY(report_ids));
    DELETE FROM app.reports WHERE id=ANY(report_ids);
    DELETE FROM app.comments WHERE observation_id=ANY(target_ids);
    DELETE FROM app.observation_photos WHERE observation_id=ANY(target_ids);
    DELETE FROM app.observations WHERE id=ANY(target_ids);
    GET DIAGNOSTICS removed_observations = ROW_COUNT;
  END IF;

  SELECT array_agg(id) INTO target_ids FROM (
    SELECT c.id FROM app.comments c JOIN app.maps m ON m.id=c.map_id
    WHERE m.status <> 'deleted' AND c.status='deleted' AND c.updated_at < cutoff
    ORDER BY c.updated_at, c.id LIMIT 500 FOR UPDATE OF c SKIP LOCKED
  ) targets;
  IF target_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO report_ids FROM app.reports
      WHERE target_type='comment' AND target_id=ANY(target_ids);
    DELETE FROM app.audit_events
      WHERE (target_type='comment' AND target_id=ANY(target_ids))
         OR (target_type='report' AND target_id=ANY(report_ids));
    DELETE FROM app.reports WHERE id=ANY(report_ids);
    DELETE FROM app.comments WHERE id=ANY(target_ids);
    GET DIAGNOSTICS removed_comments = ROW_COUNT;
  END IF;

  SELECT array_agg(id) INTO target_ids FROM (
    SELECT p.id FROM app.proposals p JOIN app.maps m ON m.id=p.map_id
    WHERE m.status <> 'deleted' AND p.deleted_at < cutoff
    ORDER BY p.deleted_at, p.id LIMIT 200 FOR UPDATE OF p SKIP LOCKED
  ) targets;
  IF target_ids IS NOT NULL THEN
    DELETE FROM app.audit_events WHERE target_type='proposal' AND target_id=ANY(target_ids);
    DELETE FROM app.proposal_versions WHERE proposal_id=ANY(target_ids);
    DELETE FROM app.proposals WHERE id=ANY(target_ids);
    GET DIAGNOSTICS removed_proposals = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('maps',removed_maps,'observations',removed_observations,
    'comments',removed_comments,'proposals',removed_proposals,'cutoff',cutoff);
END $$;

REVOKE ALL ON FUNCTION app_private.purge_expired_content() FROM PUBLIC, anon, authenticated, app_backend;
CREATE INDEX maps_retention_idx ON app.maps(deleted_at, id) WHERE status='deleted';
CREATE INDEX observations_retention_idx ON app.observations(deleted_at, id) WHERE status='deleted';
CREATE INDEX comments_retention_idx ON app.comments(updated_at, id) WHERE status='deleted';
CREATE INDEX proposals_retention_idx ON app.proposals(deleted_at, id) WHERE deleted_at IS NOT NULL;

COMMIT;
