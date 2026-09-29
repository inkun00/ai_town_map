// Schedule the reviewed, bounded purge at 02:00 KST (17:00 UTC).
// Re-running updates the named job. It does not execute the purge immediately.
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
if (existsSync(".env.migrate.local")) loadEnvFile(".env.migrate.local");
if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required");
const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL, application_name: "aimap-retention-scheduler", connectionTimeoutMillis: 5000 });
try {
  await db.connect();
  const migration = await db.query("SELECT 1 FROM app_private.schema_migrations WHERE name='005_retention.sql'");
  if (!migration.rowCount) throw new Error("Apply migration 005_retention.sql first");
  await db.query("CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions");
  const scheduled = await db.query("SELECT cron.schedule($1,$2,$3) AS jobid",[
    "aimap-retention-30d", "0 17 * * *", "SELECT app_private.purge_expired_content();",
  ]);
  const job = await db.query("SELECT jobname, schedule, command, active FROM cron.job WHERE jobid=$1",[scheduled.rows[0].jobid]);
  if (job.rows[0]?.schedule!=="0 17 * * *" || !job.rows[0].active ||
      job.rows[0].command!=="SELECT app_private.purge_expired_content();")
    throw new Error("Retention schedule verification failed");
  console.log(JSON.stringify({jobName:job.rows[0].jobname,scheduleUtc:job.rows[0].schedule,active:job.rows[0].active}));
} finally {
  await db.end();
}
