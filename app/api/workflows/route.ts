import { NextResponse } from "next/server";
import { ruleSchema } from "@/lib/schemas";
import { prisma } from "@/server/db";
import { apiError, requireApi } from "@/server/http";
import { createRule } from "@/services/organization";

export const runtime = "nodejs";

export async function GET() {
  const access = await requireApi("rules.read");
  if (access.error) return access.error;
  const workflows = await prisma.workflow.findMany({
    where: { organizationId: access.tenant.organizationId },
    orderBy: { createdAt: "desc" },
    include: { rules: true },
  });
  return NextResponse.json({ data: workflows });
}

export async function POST(request: Request) {
  const access = await requireApi("rules.manage");
  if (access.error) return access.error;
  const body = await request.json().catch(() => null);
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) return apiError(new Error(parsed.error.issues[0]?.message ?? "Règle invalide."));
  try {
    const rule = await createRule({
      organizationId: access.tenant.organizationId,
      userId: access.tenant.userId,
      ...parsed.data,
    });
    return NextResponse.json({ data: rule }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
