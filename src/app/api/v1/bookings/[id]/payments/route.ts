import { NextResponse } from "next/server";
import { requireParent } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { BookingService } from "@/src/booking/service";
import { BookingRepository } from "@/src/booking/repository";
import { HttpPaymentService } from "@/src/booking/payment-client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireParent();
  const { id } = await params;
  const bookingId = Number(id);
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) {
    return NextResponse.json({ error: "invalid_booking" }, { status: 400 });
  }
  const ownership = await getPool().query(
    `SELECT 1
     FROM bookings b
     JOIN students s ON s.id = b.student_id
     WHERE b.id = $1 AND s.parent_id = $2`,
    [bookingId, session.parentId],
  );
  if (ownership.rows.length === 0) {
    return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
  }
  const form = await request.formData();
  const forceValue = form.get("force");
  const force = forceValue === "ok" || forceValue === "decline" || forceValue === "timeout"
    ? forceValue
    : undefined;
  try {
    const service = new BookingService(
      new BookingRepository(getPool()),
      new HttpPaymentService(),
    );
    const booking = await service.pay(bookingId, force);
    if (booking.status === "seat_held") {
      return new Response(null, {
        status: 303,
        headers: { Location: `/bookings/${booking.id}?payment=in_progress` },
      });
    }
    return new Response(null, {
      status: 303,
      headers: { Location: `/bookings/${booking.id}` },
    });
  } catch {
    return Response.redirect(new URL("/500", request.url), 303);
  }
}
