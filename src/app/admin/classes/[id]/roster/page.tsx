import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { TrialClassReadRepository, type RosterBooking } from "@/src/trial-class/read";
import { AppHeader } from "../../../../header";
import styles from "../../../../app.module.css";

export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
  return value.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function BookingRow({ booking }: { booking: RosterBooking }) {
  return (
    <li className={styles.rosterRow}>
      <strong>{booking.studentName}</strong> ({booking.parentName}) — {booking.status}
      {booking.needsReconciliation ? " — needs reconciliation" : ""}
      {booking.attemptStatus ? ` — attempt ${booking.attemptStatus}` : ""}
    </li>
  );
}

function BookingSection({ title, bookings }: { title: string; bookings: RosterBooking[] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {bookings.length === 0 ? <p className={styles.meta}>None.</p> : <ul>{bookings.map((booking) => <BookingRow key={booking.id} booking={booking} />)}</ul>}
    </section>
  );
}

export default async function AdminRosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      redirect("/admin/login");
    }
    throw error;
  }

  const trialClassId = Number((await params).id);
  if (!Number.isSafeInteger(trialClassId) || trialClassId <= 0) {
    notFound();
  }
  const roster = await new TrialClassReadRepository(getPool()).getRoster(trialClassId);
  if (!roster) {
    notFound();
  }

  const held = roster.operational.filter((booking) => booking.status === "seat_held");
  const failed = roster.operational.filter((booking) => booking.status === "payment_failed");
  const unavailable = roster.operational.filter((booking) => booking.status === "seat_unavailable");
  return (
    <main className={styles.shell}>
      <AppHeader admin />
      <section className={styles.card}>
        <p className={styles.eyebrow}>Roster management</p>
        <h1 className={styles.title}>{roster.trialClass.subject}</h1>
        <p className={styles.subtitle}>{formatDate(roster.trialClass.startsAt)}</p>
        <p className={styles.status}>
          {roster.seatsTaken}/{roster.trialClass.capacity} seats taken · consistency {roster.seatsTakenMatches ? "ok" : "mismatch"}
        </p>
        <BookingSection title="Confirmed roster" bookings={roster.confirmed} />
        <BookingSection title="Seat held" bookings={held} />
        <BookingSection title="Payment failed" bookings={failed} />
        <BookingSection title="Seat unavailable" bookings={unavailable} />
      </section>
    </main>
  );
}
