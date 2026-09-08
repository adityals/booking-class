import { requireParent } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { TrialClassReadRepository } from "@/src/trial-class/read";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireParent();
    const classes = await new TrialClassReadRepository(getPool()).listClasses();
    return Response.json({ classes });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
