// Restore the app schemas into an isolated, temporary PostgreSQL instance.
// Requires PostgreSQL 17 binaries and DATABASE_ADMIN_URL. No production writes.
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import pg from "pg";

const execFile = promisify(execFileCallback);
nextEnv.loadEnvConfig(process.cwd());
if (existsSync(".env.migrate.local")) loadEnvFile(".env.migrate.local");
if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required");
const binaryDir = resolve(process.env.PG_BIN ?? "");
if (!process.env.PG_BIN || !existsSync(join(binaryDir, "pg_dump.exe"))) {
  throw new Error("PG_BIN must point to a PostgreSQL 17 bin directory");
}

const sourceUrl = new URL(process.env.DATABASE_ADMIN_URL);
const sourcePassword = decodeURIComponent(sourceUrl.password);
const sourceArgs = [
  "-h", sourceUrl.hostname,
  "-p", sourceUrl.port || "5432",
  "-U", decodeURIComponent(sourceUrl.username),
  "-d", decodeURIComponent(sourceUrl.pathname.slice(1)),
];
const tempRoot = await mkdtemp(join(tmpdir(), "aimap-restore-drill-"));
const dataDir = join(tempRoot, "data");
const dumpPath = join(tempRoot, "app.dump");
const passwordPath = join(tempRoot, "local-password.txt");
const logPath = join(tempRoot, "postgres.log");
const localPassword = randomBytes(32).toString("hex");
const startedAt = Date.now();
let serverStarted = false;
let source;

function command(name, args, env = {}, timeout = 120_000) {
  return execFile(join(binaryDir, `${name}.exe`), args, {
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...env },
  }).catch(error => {
    const detail = String(error.stderr || error.message)
      .replaceAll(sourcePassword, "[redacted]")
      .replaceAll(localPassword, "[redacted]")
      .trim().slice(0, 900);
    throw new Error(`${name} failed: ${detail}`);
  });
}

async function portNumber() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((ready, reject) => server.once("error", reject).listen(0, "127.0.0.1", ready));
  const port = server.address().port;
  await new Promise((ready, reject) => server.close(error => error ? reject(error) : ready()));
  return port;
}

const quote = identifier => `"${identifier.replaceAll('"', '""')}"`;
async function inventory(client) {
  const tables = (await client.query(`SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname IN ('app','app_private') ORDER BY schemaname, tablename`)).rows;
  const counts = {};
  for (const { schemaname, tablename } of tables) {
    const key = `${schemaname}.${tablename}`;
    counts[key] = (await client.query(`SELECT count(*)::bigint AS n FROM ${quote(schemaname)}.${quote(tablename)}`)).rows[0].n;
  }
  const photoBytes = (await client.query(
    "SELECT coalesce(sum(octet_length(content)),0)::bigint AS n FROM app.observation_photos"
  )).rows[0].n;
  const photoDigests = (await client.query(
    "SELECT encode(sha256(content),'hex') AS digest FROM app.observation_photos ORDER BY digest"
  )).rows.map(row => row.digest);
  const migrations = (await client.query(
    "SELECT name FROM app_private.schema_migrations ORDER BY name"
  )).rows.map(row => row.name);
  return { counts, photoBytes, photoDigests, migrations };
}

async function localSecurity(client) {
  const privileges = (await client.query(`SELECT
    has_schema_privilege('anon','app','USAGE') AS anon_schema,
    has_table_privilege('anon','app.maps','SELECT') AS anon_maps,
    has_schema_privilege('authenticated','app','USAGE') AS authenticated_schema,
    has_table_privilege('authenticated','app.maps','SELECT') AS authenticated_maps,
    has_table_privilege('app_backend','app.maps','SELECT') AS backend_maps,
    has_function_privilege('app_backend','app_private.purge_expired_content()','EXECUTE') AS backend_purge`
  )).rows[0];
  const missingRls = (await client.query(`SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='app' AND c.relkind='r' AND NOT c.relrowsecurity`)).rows[0].n;
  const policyCount = (await client.query(`SELECT count(*)::int AS n FROM pg_policies
    WHERE schemaname='app' AND policyname='backend_access'`)).rows[0].n;
  if (privileges.anon_schema || privileges.anon_maps || privileges.authenticated_schema ||
      privileges.authenticated_maps || !privileges.backend_maps || privileges.backend_purge ||
      missingRls !== 0 || policyCount === 0) {
    throw new Error(`Restored access controls differ from expected app policy: ${JSON.stringify({ privileges, missingRls, policyCount })}`);
  }
  for (const role of ["anon", "authenticated"]) {
    await client.query(`SET ROLE ${quote(role)}`);
    let denied = false;
    try { await client.query("SELECT count(*) FROM app.maps"); }
    catch (error) { denied = error.code === "42501"; }
    finally { await client.query("RESET ROLE"); }
    if (!denied) throw new Error(`${role} unexpectedly read the restored app maps`);
  }
  await client.query("SET ROLE app_backend");
  try { await client.query("SELECT count(*) FROM app.maps"); }
  finally { await client.query("RESET ROLE"); }
  return { missingRls, policyCount, directAccessDenied: true, backendPurgeDenied: true };
}

try {
  await mkdir(dataDir);
  await writeFile(passwordPath, `${localPassword}\n`, { mode: 0o600 });
  await command("initdb", ["-D", dataDir, "-U", "postgres", "--auth=scram-sha-256", "--pwfile", passwordPath, "--encoding=UTF8", "--locale=C"]);
  await rm(passwordPath);
  const port = await portNumber();
  await command("pg_ctl", ["-D", dataDir, "-l", logPath, "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  serverStarted = true;
  const localEnv = { PGPASSWORD: localPassword };
  await command("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "aimap_restore"], localEnv);

  source = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL, application_name: "aimap-restore-drill", connectionTimeoutMillis: 10_000 });
  await source.connect();
  const roles = (await source.query("SELECT rolname FROM pg_roles WHERE rolname <> 'postgres' AND rolname !~ '^pg_' ORDER BY rolname")).rows.map(row => row.rolname);
  const roleSql = roles.map(role => `CREATE ROLE ${quote(role)} NOLOGIN NOBYPASSRLS;`).join(" ");
  await command("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", roleSql], localEnv);
  await source.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await source.query("SET LOCAL statement_timeout = '30s'");
  const snapshot = (await source.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
  const original = await inventory(source);
  await command("pg_dump", [...sourceArgs, "--snapshot", snapshot, "--schema=app", "--schema=app_private", "--no-owner", "--format=custom", "--file", dumpPath], {
    PGPASSWORD: sourcePassword,
    PGSSLMODE: sourceUrl.searchParams.get("sslmode") || "require",
  }, 180_000);
  await source.query("COMMIT");
  await source.end();
  source = undefined;

  await command("pg_restore", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "aimap_restore", "--single-transaction", "--exit-on-error", "--no-owner", dumpPath], localEnv, 180_000);
  const restored = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: localPassword, database: "aimap_restore" });
  await restored.connect();
  try {
    const copy = await inventory(restored);
    if (JSON.stringify(original) !== JSON.stringify(copy)) throw new Error("Restored table counts, photo bytes, or migration names differ from source snapshot");
    const security = await localSecurity(restored);
    console.log(JSON.stringify({
      status: "passed", postgres: "17", tablesCompared: Object.keys(original.counts).length,
      photosCompared: original.counts["app.observation_photos"],
      migrationCount: original.migrations.length,
      security, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    }, null, 2));
  } finally {
    await restored.end();
  }
} finally {
  if (source) {
    try { await source.query("ROLLBACK"); } catch { /* Source may have disconnected. */ }
    await source.end().catch(() => {});
  }
  if (serverStarted) {
    try {
      await command("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
      serverStarted = false;
    } catch (error) {
      console.error(`Local database shutdown failed; inspect ${tempRoot} before cleanup: ${error.message}`);
    }
  }
  if (!serverStarted && dirname(tempRoot) === resolve(tmpdir()) && basename(tempRoot).startsWith("aimap-restore-drill-")) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
