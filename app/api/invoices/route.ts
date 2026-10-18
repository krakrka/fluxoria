import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireApi } from "@/server/http";

export const runtime = "nodejs";

export async function GET() {
  const access = await requireApi("invoices.read");
  if (access.error) return access.error;
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: access.tenant.organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { supplier: true, customer: true },
  });
  return NextResponse.json({ data: invoices });
}
