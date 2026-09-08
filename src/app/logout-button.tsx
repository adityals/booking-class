import styles from "./app.module.css";

export function LogoutButton() {
  return (
    <form action="/api/v1/sessions/logout" method="post">
      <button className={`${styles.button} ${styles.secondary}`} type="submit">Log out</button>
    </form>
  );
}
