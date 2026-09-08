import type { Pool } from "pg";

export interface StudentOption {
  id: number;
  name: string;
}

export class StudentRepository {
  constructor(private readonly pool: Pool) {}

  async belongsToParent(studentId: number, parentId: number): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM students WHERE id = $1 AND parent_id = $2",
      [studentId, parentId],
    );
    return result.rows.length > 0;
  }

  async listForParent(parentId: number): Promise<StudentOption[]> {
    const result = await this.pool.query<StudentOption>(
      "SELECT id, name FROM students WHERE parent_id = $1 ORDER BY id",
      [parentId],
    );
    return result.rows;
  }
}
