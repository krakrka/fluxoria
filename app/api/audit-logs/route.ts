import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireApi } from "@/server/http";

export const runtime = "nodejs";

export async function GET() {
  const access = await requireApi("audit.read");
  if (access.error) return access.error;
  const logs = await prisma.auditLog.findMany({
    where: { organizationId: access.tenant.organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { name: true, email: true } } },
  });
  return NextResponse.json({ data: logs });
}
