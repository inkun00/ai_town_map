import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getServerConfig } from "./env";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getServerConfig().databaseUrl, max: process.env.VERCEL ? 2 : 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query<T>(sql, values)).rows;
}

export async function withTransaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
