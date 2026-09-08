import { requireAdmin } from "@/src/auth/server";
import { getPool } from "@/src/infra/db/pool";
import { TrialClassReadRepository } from "@/src/trial-class/read";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAdmin();
    const { id } = await params;
    const trialClassId = Number(id);
    if (!Number.isSafeInteger(trialClassId) || trialClassId <= 0) {
      return Response.json({ error: "Invalid trial class id" }, { status: 400 });
    }

    const roster = await new TrialClassReadRepository(getPool()).getRoster(trialClassId);
    if (!roster) {
      return Response.json({ error: "Trial class not found" }, { status: 404 });
    }
    return Response.json(roster);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
