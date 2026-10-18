import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { apiError, requireApi } from "@/server/http";
import { exportOrganization } from "@/services/organization";

export const runtime = "nodejs";

export async function GET() {
  const access = await requireApi("gdpr.export");
  if (access.error) return access.error;
  const limit = rateLimit(`export:${access.tenant.organizationId}`, 10, 60 * 60 * 1000);
  if (!limit.ok) return NextResponse.json({ error: { message: "Trop d'exports. Réessayez plus tard." } }, { status: 429 });
  try {
    const data = await exportOrganization(access.tenant.organizationId);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=fluxora-export.json",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
