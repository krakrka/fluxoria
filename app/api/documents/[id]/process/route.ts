import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { apiError, requireApi } from "@/server/http";
import { enqueueDocumentProcessing } from "@/services/queue";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const access = await requireApi("documents.update");
  if (access.error) return access.error;
  const { id } = await params;
  const document = await prisma.document.findFirst({
    where: { id, organizationId: access.tenant.organizationId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!document) return apiError(new Error("Document introuvable."));
  if (document.status !== "RECEIVED" && document.status !== "ERROR") {
    return NextResponse.json({ data: { id: document.id, status: document.status } });
  }
  await enqueueDocumentProcessing(access.tenant.organizationId, document.id);
  return NextResponse.json({ data: { id: document.id, status: document.status } });
}
