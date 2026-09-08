import Link from "next/link";
import styles from "../../app.module.css";

export default function AdminLoginPage() {
  return (
    <main className={styles.shell}>
      <section className={`${styles.card} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Roster management</p>
        <h1 className={styles.heading}>Admin login</h1>
        <p className={styles.subtitle}>View live class capacity and confirmed rosters.</p>
        <form className={styles.form} action="/api/v1/admin/sessions" method="post">
          <label className={styles.field} htmlFor="username">
            Username
            <input className={styles.input} id="username" name="username" required />
          </label>
          <label className={styles.field} htmlFor="password">
            Password
            <input className={styles.input} id="password" name="password" type="password" required />
          </label>
          <button className={styles.button} type="submit">Log in</button>
        </form>
        <p className={styles.meta}>
          Parent? <Link href="/login">Parent login</Link>
        </p>
      </section>
    </main>
  );
}
