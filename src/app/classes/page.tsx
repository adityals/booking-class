import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "../logout-button";
import { requireParent } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { TrialClassReadRepository } from "@/src/trial-class/read";
import styles from "../app.module.css";

export const dynamic = "force-dynamic";

function formatPrice(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(2)}`;
}

function formatStart(startsAt: Date): string {
  return startsAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

export default async function ClassesPage() {
  try {
    await requireParent();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      redirect("/login");
    }
    throw error;
  }

  const classes = await new TrialClassReadRepository(getPool()).listClasses();
  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <div className={styles.actions}>
          <LogoutButton />
        </div>
        <p className={styles.eyebrow}>Explore science and math</p>
        <h1 className={styles.heading}>Trial classes</h1>
        <ul className={styles.list}>
          {classes.map((trialClass) => {
            const full = trialClass.availableSeats === 0;
            return (
              <li className={styles.item} key={trialClass.id}>
                <div className={styles.itemContent}>
                  {full ? (
                    <span className={styles.disabled}>{trialClass.subject}</span>
                  ) : (
                    <Link className={styles.itemTitle} href={`/classes/${trialClass.id}`}>
                      {trialClass.subject}
                    </Link>
                  )}
                  <span className={styles.meta}>{formatStart(trialClass.startsAt)}</span>
                  <span className={styles.meta}>{trialClass.seatsTaken}/{trialClass.capacity} seats taken</span>
                </div>
                <div className={styles.actions}>
                  <span className={styles.meta}>{full ? "Full" : `${trialClass.availableSeats} available`}</span>
                  <span className={styles.meta}>{formatPrice(trialClass.priceCents)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
