import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
if (existsSync(".env.migrate.local")) loadEnvFile(".env.migrate.local");
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required for migrations");
const backendConnection = process.env.DATABASE_URL;
if (!backendConnection || /replace-me|your-project/i.test(backendConnection)) throw new Error("DATABASE_URL must be set to the intended app_backend connection before migrations");
let backendUrl;
try { backendUrl = new URL(backendConnection); }
catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
const backendUser = decodeURIComponent(backendUrl.username);
const backendPassword = decodeURIComponent(backendUrl.password);
if (backendUser !== "app_backend" && !backendUser.startsWith("app_backend.")) throw new Error("DATABASE_URL must use the app_backend role");
if (backendPassword.length < 20) throw new Error("DATABASE_URL must contain a strong app_backend password of at least 20 characters");

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query("CREATE SCHEMA IF NOT EXISTS app_private");
  await client.query(`CREATE TABLE IF NOT EXISTS app_private.schema_migrations(
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const migrations = ["001_core.sql", "002_observations.sql", "003_community_moderation.sql", "004_analysis_proposals.sql"];
  for (const name of migrations) {
    const previous = await client.query("SELECT 1 FROM app_private.schema_migrations WHERE name=$1", [name]);
    if (previous.rowCount) continue;
    const sql = await readFile(resolve("db", "migrations", name), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO app_private.schema_migrations(name) VALUES($1)", [name]);
    process.stdout.write(`Applied ${name}\n`);
  }
  await client.query("REVOKE ALL ON app_private.schema_migrations FROM app_backend");
  await client.query(`ALTER ROLE app_backend WITH LOGIN PASSWORD ${client.escapeLiteral(backendPassword)}`);
  const source = JSON.parse(await readFile(resolve("docs", "contracts", "theme-presets.json"), "utf8"));
  for (const theme of source.templates) {
    const existing = await client.query(
      "SELECT definition = $3::jsonb AS matches FROM app.theme_templates WHERE theme_key=$1 AND version=$2",
      [theme.key, theme.version, JSON.stringify(theme)]);
    if (existing.rowCount && !existing.rows[0].matches) throw new Error(`Published theme ${theme.key} v${theme.version} differs from the source; create a new version`);
    if (!existing.rowCount) await client.query("INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3)", [theme.key, theme.version, JSON.stringify(theme)]);
  }
  process.stdout.write("Theme templates checked\n");
} finally {
  await client.end();
}
