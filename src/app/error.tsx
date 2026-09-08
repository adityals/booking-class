"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./app.module.css";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.shell}>
      <section className={`${styles.card} ${styles.narrow}`}>
        <p className={styles.eyebrow}>500 · Internal server error</p>
        <h1 className={styles.heading}>We couldn&apos;t load this page</h1>
        <p className={styles.subtitle}>
          The request failed on the server. Your session and booking data were not changed by this page error.
        </p>
        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={() => reset()}>
            Try again
          </button>
          <Link className={`${styles.linkButton} ${styles.secondary}`} href="/">
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}
