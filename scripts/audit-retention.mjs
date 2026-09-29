// Read-only inventory of operational data. No titles, IDs, coordinates or credentials are logged.
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
if (existsSync(".env.migrate.local")) loadEnvFile(".env.migrate.local");
if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required");
const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL, application_name: "aimap-retention-audit", connectionTimeoutMillis: 5000 });
const integer = value => Number(value);
try {
  await db.connect();
  await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await db.query("SET LOCAL statement_timeout = '10s'");
  const one = async sql => (await db.query(sql)).rows[0];
  const report = {
    measuredAt: new Date().toISOString(),
    maps: await one(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status='active')::int AS active,
      count(*) FILTER (WHERE status='archived')::int AS archived,
      count(*) FILTER (WHERE status='deleted' AND deleted_at >= now()-interval '30 days')::int AS restorable,
      count(*) FILTER (WHERE status='deleted' AND deleted_at < now()-interval '30 days')::int AS "pastRestoreWindow",
      count(*) FILTER (WHERE (status='deleted') != (deleted_at IS NOT NULL))::int AS "inconsistentDeleteState"
      FROM app.maps`),
    observations: await one(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status='published')::int AS published,
      count(*) FILTER (WHERE status='deleted' AND deleted_at >= now()-interval '30 days')::int AS restorable,
      count(*) FILTER (WHERE status='deleted' AND deleted_at < now()-interval '30 days')::int AS "pastRestoreWindow",
      count(*) FILTER (WHERE (status='deleted') != (deleted_at IS NOT NULL))::int AS "inconsistentDeleteState"
      FROM app.observations`),
    photos: await one(`SELECT count(*)::int AS total, coalesce(sum(octet_length(content)),0)::bigint AS bytes,
      count(*) FILTER (WHERE o.status='deleted')::int AS "attachedToDeletedObservation"
      FROM app.observation_photos p JOIN app.observations o ON o.id=p.observation_id`),
    comments: await one(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status='deleted' AND updated_at < now()-interval '30 days')::int AS "pastRestoreWindow"
      FROM app.comments`),
    proposals: await one(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
      count(*) FILTER (WHERE deleted_at < now()-interval '30 days')::int AS "pastRestoreWindow"
      FROM app.proposals`),
    privateLifecycle: await one(`SELECT
      (SELECT count(*) FROM app_private.sessions WHERE expires_at<now() OR revoked_at IS NOT NULL)::int AS "expiredOrRevokedSessions",
      (SELECT count(*) FROM app_private.invites WHERE expires_at<now() OR revoked_at IS NOT NULL)::int AS "expiredOrRevokedInvites",
      (SELECT count(*) FROM app_private.idempotency_keys WHERE expires_at<now())::int AS "expiredIdempotencyKeys",
      (SELECT count(*) FROM app_private.invite_attempts WHERE window_start<now()-interval '10 minutes')::int AS "oldInviteAttemptWindows"`),
  };
  report.photos.bytes = integer(report.photos.bytes);
  await db.query("COMMIT");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  try { await db.query("ROLLBACK"); } catch { /* Connection may already be closed. */ }
  throw error;
} finally {
  await db.end();
}
