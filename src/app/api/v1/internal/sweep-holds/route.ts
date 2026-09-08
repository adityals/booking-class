import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { BookingRepository } from "@/src/booking/repository";
import { BookingService } from "@/src/booking/service";
import { HttpPaymentService } from "@/src/booking/payment-client";

export async function POST(): Promise<Response> {
  await requireAdmin();
  const service = new BookingService(
    new BookingRepository(getPool()),
    new HttpPaymentService(),
  );
  return NextResponse.json(await service.sweep());
}
