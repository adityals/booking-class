import Link from "next/link";
import { notFound } from "next/navigation";
import { requireParent } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { LogoutButton } from "../../logout-button";
import styles from "../../app.module.css";

export const dynamic = "force-dynamic";

export default async function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireParent();
  const bookingId = Number((await params).id);
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) {
    notFound();
  }
  const result = await getPool().query(
    `SELECT b.id, b.status, b.amount_cents, c.subject
     FROM bookings b
     JOIN students s ON s.id = b.student_id
     JOIN trial_classes c ON c.id = b.trial_class_id
     WHERE b.id = $1 AND s.parent_id = $2`,
    [bookingId, session.parentId],
  );
  if (result.rows.length === 0) {
    notFound();
  }
  const booking = result.rows[0] as {
    id: number;
    status: string;
    amount_cents: number;
    subject: string;
  };
  return (
    <main className={styles.shell}>
      <section className={`${styles.card} ${styles.narrow}`}>
        <div className={styles.actions}>
          <LogoutButton />
        </div>
        <Link href="/classes">← All trial classes</Link>
        <p className={styles.eyebrow}>Booking status</p>
        <h1 className={styles.title}>{booking.subject}</h1>
        <p className={styles.status}>Status: {booking.status.replaceAll("_", " ")}</p>
        {booking.status === "pending_payment" ? (
          <form className={styles.form} method="post" action={`/api/v1/bookings/${booking.id}/payments`}>
            <label className={styles.field} htmlFor="force">
              Payment result
              <select className={styles.select} id="force" name="force" defaultValue="ok">
                <option value="ok">Success</option>
                <option value="decline">Decline</option>
                <option value="timeout">Timeout</option>
              </select>
            </label>
            <button className={styles.button} type="submit">
              Pay ${(booking.amount_cents / 100).toFixed(2)}
            </button>
          </form>
        ) : null}
        {booking.status === "seat_held" ? (
          <p className={styles.subtitle}>Payment is in progress. Refresh shortly.</p>
        ) : null}
      </section>
    </main>
  );
}
