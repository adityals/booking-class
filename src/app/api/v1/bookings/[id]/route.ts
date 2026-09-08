import { NextResponse } from "next/server";
import { requireParent } from "@/src/auth/server";
import { BookingReadRepository } from "@/src/booking/read-repository";
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

  const booking = await new BookingReadRepository(getPool()).findForParent(
    bookingId,
    session.parentId,
  );
  if (!booking) {
    return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
  }

  return NextResponse.json(booking);
}
