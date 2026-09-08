import { Pool, types } from "pg";
import type { PoolClient } from "pg";

/**
 * `pg` hands back `bigint` (OID 20) as a string to protect precision beyond 2^53.
 * Every bigint here is an identity column on a single internal database, so it can
 * never reach that range, and leaving them as strings silently breaks every row type
 * that declares `id: number` — `Number.isSafeInteger` on an id would reject it.
 */
types.setTypeParser(20, (value) => Number(value));

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Runs `fn` inside a transaction, rolling back on throw. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
