import Link from "next/link";
import styles from "../app.module.css";

export default function ServerErrorPage() {
  return (
    <main className={styles.shell}>
      <section className={`${styles.card} ${styles.narrow}`}>
        <p className={styles.eyebrow}>5xx · Internal server error</p>
        <h1 className={styles.heading}>We couldn&apos;t complete that request</h1>
        <p className={styles.subtitle}>
          The server hit an unexpected problem. No booking was confirmed by this error response.
        </p>
        <Link className={styles.linkButton} href="/">
          Return home
        </Link>
      </section>
    </main>
  );
}
