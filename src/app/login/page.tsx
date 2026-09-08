import Link from "next/link";
import styles from "../app.module.css";

export default function LoginPage() {
  return (
    <main className={styles.shell}>
      <section className={`${styles.card} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Science and math trial classes</p>
        <h1 className={styles.heading}>Parent login</h1>
        <p className={styles.subtitle}>Sign in to choose a child and book a science or math trial.</p>
        <form className={styles.form} action="/api/v1/sessions" method="post">
          <label className={styles.field} htmlFor="username">
            Username
            <input className={styles.input} id="username" name="username" required />
          </label>
          <button className={styles.button} type="submit">Log in</button>
        </form>
        <p className={styles.meta}>
          Staff member? <Link href="/admin/login">Admin login</Link>
        </p>
      </section>
    </main>
  );
}
