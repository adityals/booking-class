"use client";

import { useEffect } from "react";
import styles from "./app.module.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className={styles.shell}>
          <section className={`${styles.card} ${styles.narrow}`}>
            <p className={styles.eyebrow}>500 · Internal server error</p>
            <h1 className={styles.heading}>The application needs a retry</h1>
            <p className={styles.subtitle}>The server could not render this page.</p>
            <button className={styles.button} type="button" onClick={() => reset()}>
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
