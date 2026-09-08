import type { Pool } from "pg";

export interface ParentIdentity {
  id: number;
}

export class ParentRepository {
  constructor(private readonly pool: Pool) {}

  async findByUsername(username: string): Promise<ParentIdentity | null> {
    const result = await this.pool.query<ParentIdentity>(
      "SELECT id FROM parents WHERE username = $1",
      [username],
    );
    return result.rows[0] ?? null;
  }
}
