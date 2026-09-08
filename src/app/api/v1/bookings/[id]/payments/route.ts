import { NextResponse } from "next/server";
import { requireParent } from "@/src/auth/server";
import { BookingReadRepository } from "@/src/booking/read-repository";
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

  const booking = await new BookingReadRepository(getPool()).findForParent(
    bookingId,
    session.parentId,
  );
  if (!booking) {
    return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
  }

  const form = await request.formData();
  const forceValue = form.get("force");
  const force =
    forceValue === "ok" || forceValue === "decline" || forceValue === "timeout"
      ? forceValue
      : undefined;

  try {
    const service = new BookingService(
      new BookingRepository(getPool()),
      new HttpPaymentService(),
    );
    const paid = await service.pay(bookingId, force);

    if (paid.status === "seat_held") {
      return new Response(null, {
        status: 303,
        headers: { Location: `/bookings/${paid.id}?payment=in_progress` },
      });
    }

    return new Response(null, {
      status: 303,
      headers: { Location: `/bookings/${paid.id}` },
    });
  } catch {
    return Response.redirect(new URL("/500", request.url), 303);
  }
}
