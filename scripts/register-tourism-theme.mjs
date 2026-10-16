// Add only the tourism preset. Existing templates and map configurations are immutable.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
if (existsSync(".env.migrate.local")) loadEnvFile(".env.migrate.local");
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required to register the tourism template");

const source = JSON.parse(await readFile(resolve("docs", "contracts", "theme-presets.json"), "utf8"));
const matches = source.templates.filter(theme => theme.key === "tourism");
if (matches.length !== 1) throw new Error("Expected one published tourism template");
const theme = matches[0];
if (!Number.isInteger(theme.version) || theme.version < 1 || !theme.categories?.length) throw new Error("Invalid tourism template");

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(20261016, 1)");
  const inserted = await client.query(
    "INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3) ON CONFLICT (theme_key,version) DO NOTHING RETURNING id",
    [theme.key, theme.version, JSON.stringify(theme)],
  );
  const existing = await client.query(
    "SELECT definition = $3::jsonb AS matches FROM app.theme_templates WHERE theme_key=$1 AND version=$2",
    [theme.key, theme.version, JSON.stringify(theme)],
  );
  if (!existing.rows[0]?.matches) throw new Error(`Published template conflict: tourism v${theme.version}; create a new version instead`);
  await client.query("COMMIT");
  console.log(JSON.stringify({ theme: theme.key, version: theme.version, categories: theme.categories.length,
    emojis: theme.categories.reduce((sum, category) => sum + category.emojiOptions.length, 0),
    registered: inserted.rowCount === 1 }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
