import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/src/infra/db/pool";
import { requireParent } from "@/src/auth/server";
import { TrialClassReadRepository } from "@/src/trial-class/read";
import { LogoutButton } from "../../logout-button";
import styles from "../../app.module.css";

export const dynamic = "force-dynamic";

function formatPrice(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(2)}`;
}

export default async function ClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireParent();
  const students = await getPool().query<{ id: number; name: string }>(
    "SELECT id, name FROM students WHERE parent_id = $1 ORDER BY id",
    [session.parentId],
  );
  const { id } = await params;
  const trialClass = (await new TrialClassReadRepository(getPool()).listClasses()).find(
    (item) => item.id === Number(id),
  );
  if (!trialClass) {
    notFound();
  }

  const full = trialClass.availableSeats === 0;
  return (
    <main className={styles.shell}>
      <section className={`${styles.card} ${styles.narrow}`}>
        <div className={styles.actions}>
          <LogoutButton />
        </div>
        <Link href="/classes">← All trial classes</Link>
        <p className={styles.eyebrow}>Choose a spot</p>
        <h1 className={styles.title}>{trialClass.subject}</h1>
        <p className={styles.subtitle}>
          {trialClass.startsAt.toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "UTC",
          })}
          <br />
          {trialClass.seatsTaken}/{trialClass.capacity} seats taken · {formatPrice(trialClass.priceCents)}
        </p>
        {full ? (
          <p className={styles.status}>This class is full.</p>
        ) : (
          <form className={styles.form} method="post" action="/api/v1/bookings">
            <input type="hidden" name="trial_class_id" value={trialClass.id} />
            <label className={styles.field} htmlFor="student_id">
              Choose a child
              <select className={styles.select} id="student_id" name="student_id" required>
                {students.rows.map((student) => (
                  <option key={student.id} value={student.id}>{student.name}</option>
                ))}
              </select>
            </label>
            <button className={styles.button} type="submit">Continue to payment</button>
          </form>
        )}
      </section>
    </main>
  );
}
