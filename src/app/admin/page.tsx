import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { TrialClassReadRepository } from "@/src/trial-class/read";
import { AppHeader } from "../header";
import styles from "../app.module.css";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      redirect("/admin/login");
    }
    throw error;
  }

  const classes = await new TrialClassReadRepository(getPool()).listClasses();
  return (
    <main className={styles.shell}>
      <AppHeader admin />
      <section className={styles.card}>
        <p className={styles.eyebrow}>Roster management</p>
        <h1 className={styles.heading}>Trial classes</h1>
        <ul className={styles.list}>
          {classes.map((trialClass) => (
            <li className={styles.item} key={trialClass.id}>
              <div className={styles.itemContent}>
                <Link className={styles.itemTitle} href={`/admin/classes/${trialClass.id}/roster`}>
                  {trialClass.subject}
                </Link>
                <span className={styles.meta}>
                  {trialClass.seatsTaken}/{trialClass.capacity} seats taken
                </span>
              </div>
              <Link
                className={`${styles.linkButton} ${styles.secondary}`}
                href={`/admin/classes/${trialClass.id}/roster`}
              >
                View roster
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
