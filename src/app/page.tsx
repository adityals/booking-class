import { redirect } from "next/navigation";
import { getSession } from "@/src/auth/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (session?.kind === "parent") {
    redirect("/classes");
  }
  if (session?.kind === "admin") {
    redirect("/admin");
  }
  redirect("/login");
}
