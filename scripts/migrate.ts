import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { closePool, getPool } from "../src/infra/db/pool";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

async function applied(): Promise<Set<string>> {
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const { rows } = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations",
  );
  return new Set(rows.map((row) => row.filename));
}

export async function migrate(): Promise<string[]> {
  const done = await applied();
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  const client = await getPool().connect();
  try {
    for (const file of files) {
      if (done.has(file)) {
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
        ran.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
  } finally {
    client.release();
  }
  return ran;
}

export async function resetSchema(): Promise<void> {
  await getPool().query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
}

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset");
  if (reset) {
    await resetSchema();
  }
  const ran = await migrate();
  console.log(ran.length ? `applied: ${ran.join(", ")}` : "already up to date");
  await closePool();
}

if (process.argv[1]?.endsWith("/scripts/migrate.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
