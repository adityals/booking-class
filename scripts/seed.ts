import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { closePool, getPool } from "../src/infra/db/pool";

async function main(): Promise<void> {
  const sql = await readFile(join(import.meta.dirname, "seed.sql"), "utf8");
  await getPool().query(sql);
  console.log("seed applied");
  await closePool();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
