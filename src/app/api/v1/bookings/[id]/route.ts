import { NextResponse } from "next/server";
import { requireParent } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireParent();
  const bookingId = Number((await params).id);
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) {
    return NextResponse.json({ error: "invalid_booking" }, { status: 400 });
  }
  const result = await getPool().query(
    `SELECT b.id, b.student_id, b.trial_class_id, b.status, b.amount_cents,
            b.held_at, c.subject, c.starts_at
     FROM bookings b
     JOIN students s ON s.id = b.student_id
     JOIN trial_classes c ON c.id = b.trial_class_id
     WHERE b.id = $1 AND s.parent_id = $2`,
    [bookingId, session.parentId],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
  }
  return NextResponse.json(result.rows[0]);
}
