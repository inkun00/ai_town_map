// Register the new presets without changing published templates or existing maps.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import nextEnv from "@next/env";
import pg from "pg";

const source = JSON.parse(await readFile(resolve("docs", "contracts", "theme-presets.json"), "utf8"));
const keys = ["heritage", "weather_data"];
const templates = keys.map(key => {
  const matches = source.templates.filter(theme => theme.key === key);
  if (matches.length !== 1) throw new Error(`Expected one published ${key} template`);
  const theme = matches[0];
  if (!Number.isInteger(theme.version) || theme.version < 1 || !theme.categories?.length)
    throw new Error(`Invalid ${key} template`);
  const categoryKeys = new Set();
  for (const category of theme.categories) {
    if (categoryKeys.has(category.key) || !category.emojiOptions?.length)
      throw new Error(`Invalid category in ${key}`);
    categoryKeys.add(category.key);
    const emojiKeys = new Set(category.emojiOptions.map(emoji => emoji.key));
    if (emojiKeys.size !== category.emojiOptions.length || !emojiKeys.has(category.defaultEmojiKey))
      throw new Error(`Invalid emoji choices in ${key}/${category.key}`);
  }
  return theme;
});
const summary = theme => ({ theme: theme.key, version: theme.version, categories: theme.categories.length,
  emojis: theme.categories.reduce((sum, category) => sum + category.emojiOptions.length, 0) });

if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ checked: templates.map(summary) }));
} else {
  nextEnv.loadEnvConfig(process.cwd());
  if (existsSync(".env.migrate.local")) loadEnvFile(".env.migrate.local");
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required to register specialty templates");
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(20261018, 1)");
    const registered = [];
    for (const theme of templates) {
      const inserted = await client.query(
        "INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3) ON CONFLICT (theme_key,version) DO NOTHING RETURNING id",
        [theme.key, theme.version, JSON.stringify(theme)],
      );
      const existing = await client.query(
        "SELECT definition = $3::jsonb AS matches FROM app.theme_templates WHERE theme_key=$1 AND version=$2",
        [theme.key, theme.version, JSON.stringify(theme)],
      );
      if (!existing.rows[0]?.matches)
        throw new Error(`Published template conflict: ${theme.key} v${theme.version}; create a new version instead`);
      registered.push({ ...summary(theme), registered: inserted.rowCount === 1 });
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ templates: registered }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
