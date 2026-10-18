import { NextResponse } from "next/server";
import { can, type Permission } from "@/lib/permissions";
import { publicErrorMessage } from "@/lib/security";
import { PlanLimitError } from "@/services/billing";
import { getTenant, type TenantContext } from "@/server/tenant";

export async function requireApi(permission?: Permission): Promise<
  { tenant: TenantContext; error?: undefined } | { tenant?: undefined; error: NextResponse }
> {
  const tenant = await getTenant();
  if (!tenant) {
    return {
      error: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentification requise." } },
        { status: 401 },
      ),
    };
  }
  if (permission && !can(tenant.role, permission)) {
    return {
      error: NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Action non autorisée pour ce rôle." } },
        { status: 403 },
      ),
    };
  }
  return { tenant };
}

export function apiError(error: unknown) {
  if (error instanceof PlanLimitError) {
    return NextResponse.json({ error: { code: "PLAN_LIMIT", message: error.message } }, { status: 402 });
  }
  const message = publicErrorMessage(error);
  const status = /introuvable/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: { code: "BAD_REQUEST", message } }, { status });
}
