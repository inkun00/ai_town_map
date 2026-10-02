// End expired rooms and remove stale coordinates without requiring an open browser.
import {existsSync} from "node:fs";
import {loadEnvFile} from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
nextEnv.loadEnvConfig(process.cwd());
if(existsSync(".env.migrate.local")) loadEnvFile(".env.migrate.local");
if(!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required");
const db=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL,application_name:"aimap-game-scheduler",connectionTimeoutMillis:5000});
try{
  await db.connect();
  const migration=await db.query("SELECT 1 FROM app_private.schema_migrations WHERE name='006_exploration_games.sql'");
  if(!migration.rowCount) throw new Error("Apply migration 006_exploration_games.sql first");
  await db.query("CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions");
  const command="SELECT app_private.expire_game_rooms();";
  const result=await db.query("SELECT cron.schedule($1,$2,$3) AS jobid",["aimap-game-expiry","* * * * *",command]);
  const job=(await db.query("SELECT jobname,schedule,command,active FROM cron.job WHERE jobid=$1",[result.rows[0].jobid])).rows[0];
  if(!job?.active||job.schedule!=="* * * * *"||job.command!==command)throw new Error("Game expiry schedule verification failed");
  console.log(JSON.stringify({jobName:job.jobname,scheduleUtc:job.schedule,active:job.active}));
}finally{await db.end();}
