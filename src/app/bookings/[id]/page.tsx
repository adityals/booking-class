import Link from "next/link";
import { notFound } from "next/navigation";
import { requireParent } from "@/src/auth/server";
import { BookingReadRepository } from "@/src/booking/read-repository";
import { getPool } from "@/src/infra/db/pool";
import { AppHeader } from "../../header";
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
  const booking = await new BookingReadRepository(getPool()).findForParent(
    bookingId,
    session.parentId,
  );
  if (!booking) {
    notFound();
  }
  const unresolved = booking.status === "seat_held" && booking.attemptStatus === "unknown";
  return (
    <main className={styles.shell}>
      <AppHeader />
      <section className={`${styles.card} ${styles.narrow}`}>
        <Link href="/classes">← All trial classes</Link>
        <p className={styles.eyebrow}>Booking status</p>
        <h1 className={styles.title}>{booking.subject}</h1>
        <p className={styles.status}>Status: {booking.status.replaceAll("_", " ")}</p>
        {booking.status === "pending_payment" || unresolved ? (
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
              {unresolved ? "Retry payment" : `Pay $${(booking.amountCents / 100).toFixed(2)}`}
            </button>
          </form>
        ) : null}
        {booking.status === "seat_held" && !unresolved ? (
          <p className={styles.subtitle}>Payment is in progress. Refresh shortly.</p>
        ) : null}
        {unresolved ? (
          <p className={styles.subtitle}>
            We did not hear back from the provider. Retrying is safe and reuses the payment attempt.
          </p>
        ) : null}
      </section>
    </main>
  );
}
