import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireApi } from "@/server/http";

export const runtime = "nodejs";

export async function GET() {
  const access = await requireApi("orders.read");
  if (access.error) return access.error;
  const orders = await prisma.purchaseOrder.findMany({
    where: { organizationId: access.tenant.organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { supplier: true, lines: true },
  });
  return NextResponse.json({ data: orders });
}
