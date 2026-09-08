import type { Pool } from "pg";
import type { BookingStatus, PaymentAttemptStatus } from "../domain/types";

export interface BookingDetails {
  id: number;
  studentId: number;
  trialClassId: number;
  status: BookingStatus;
  amountCents: number;
  heldAt: Date | null;
  subject: string;
  startsAt: Date;
  attemptStatus: PaymentAttemptStatus | null;
}

interface BookingDetailsRow {
  id: number;
  student_id: number;
  trial_class_id: number;
  status: BookingStatus;
  amount_cents: number;
  held_at: Date | null;
  subject: string;
  starts_at: Date;
  attempt_status: PaymentAttemptStatus | null;
}

export class BookingReadRepository {
  constructor(private readonly pool: Pool) {}

  async findForParent(bookingId: number, parentId: number): Promise<BookingDetails | null> {
    const result = await this.pool.query<BookingDetailsRow>(
      `SELECT b.id, b.student_id, b.trial_class_id, b.status, b.amount_cents,
              b.held_at, c.subject, c.starts_at, a.status AS attempt_status
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       JOIN trial_classes c ON c.id = b.trial_class_id
       LEFT JOIN LATERAL (
         SELECT status FROM payment_attempts
         WHERE booking_id = b.id
         ORDER BY id DESC
         LIMIT 1
       ) a ON true
       WHERE b.id = $1 AND s.parent_id = $2`,
      [bookingId, parentId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      studentId: row.student_id,
      trialClassId: row.trial_class_id,
      status: row.status,
      amountCents: row.amount_cents,
      heldAt: row.held_at,
      subject: row.subject,
      startsAt: row.starts_at,
      attemptStatus: row.attempt_status,
    };
  }
}
