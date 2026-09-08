import { NextResponse } from "next/server";
import { requireParent } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { BookingRepository } from "@/src/booking/repository";

export async function POST(request: Request): Promise<Response> {
  const session = await requireParent();
  const form = await request.formData();
  const studentId = Number(form.get("student_id"));
  const trialClassId = Number(form.get("trial_class_id"));
  if (!Number.isSafeInteger(studentId) || !Number.isSafeInteger(trialClassId)) {
    return NextResponse.json({ error: "invalid_booking" }, { status: 400 });
  }
  const ownership = await getPool().query(
    "SELECT 1 FROM students WHERE id = $1 AND parent_id = $2",
    [studentId, session.parentId],
  );
  if (ownership.rows.length === 0) {
    return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  }
  try {
    const booking = await new BookingRepository(getPool()).createOrGet(studentId, trialClassId);
    return new Response(null, {
      status: 303,
      headers: { Location: `/bookings/${booking.id}` },
    });
  } catch {
    return Response.redirect(new URL("/500", request.url), 303);
  }
}
