import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { apiError, requireApi } from "@/server/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const access = await requireApi("documents.read");
  if (access.error) return access.error;
  const { id } = await params;
  const document = await prisma.document.findFirst({
    where: { id, organizationId: access.tenant.organizationId, deletedAt: null },
    include: {
      fields: { orderBy: { key: "asc" } },
      lines: { orderBy: { position: "asc" } },
      invoice: { select: { id: true, number: true, matchStatus: true, supplierId: true } },
      purchaseOrder: { select: { id: true, number: true } },
    },
  });
  if (!document) return apiError(new Error("Document introuvable."));
  return NextResponse.json({ data: document });
}
