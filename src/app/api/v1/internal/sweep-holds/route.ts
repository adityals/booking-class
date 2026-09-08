import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/auth/server";
import { getPool, withTransaction } from "@/src/infra/db/pool";

export async function POST(): Promise<Response> {
  await requireAdmin();
  const ttlSeconds = Number(process.env.HOLD_TTL_SECONDS ?? 30);
  const released = await withTransaction(getPool(), async (tx) => {
    const stale = await tx.query<{ booking_id: number; trial_class_id: number }>(
      `SELECT b.id AS booking_id, b.trial_class_id
       FROM bookings b
       WHERE b.status = 'seat_held'
         AND b.held_at < now() - ($1 * interval '1 second')
         AND NOT EXISTS (
           SELECT 1 FROM payment_attempts a
           WHERE a.booking_id = b.id AND a.status IN ('processing', 'unknown')
         )
       FOR UPDATE OF b`,
      [ttlSeconds],
    );
    for (const row of stale.rows) {
      await tx.query(
        `UPDATE trial_classes SET seats_taken = seats_taken - 1
         WHERE id = $1 AND seats_taken > 0`,
        [row.trial_class_id],
      );
      await tx.query(
        `UPDATE bookings
         SET status = CASE WHEN EXISTS (
           SELECT 1 FROM payment_attempts
           WHERE booking_id = $1 AND status = 'failed'
         ) THEN 'payment_failed' ELSE 'seat_unavailable' END,
         updated_at = now()
         WHERE id = $1 AND status = 'seat_held'`,
        [row.booking_id],
      );
    }
    return stale.rows.length;
  });
  return NextResponse.json({ released });
}
