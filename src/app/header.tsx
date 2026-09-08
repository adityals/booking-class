import Link from "next/link";
import { LogoutButton } from "./logout-button";
import styles from "./app.module.css";

export function AppHeader({ admin = false }: { admin?: boolean }) {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href={admin ? "/admin" : "/classes"}>
        Sample <span>Trial Booking</span>
      </Link>
      <LogoutButton />
    </header>
  );
}
