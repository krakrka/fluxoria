import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { apiError, requireApi } from "@/server/http";
import { validateDocument } from "@/services/documents";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const access = await requireApi("documents.validate");
  if (access.error) return access.error;
  const { id } = await params;
  try {
    await validateDocument({
      organizationId: access.tenant.organizationId,
      userId: access.tenant.userId,
      documentId: id,
    });
    const document = await prisma.document.findFirst({
      where: { id, organizationId: access.tenant.organizationId },
      select: { id: true, status: true },
    });
    return NextResponse.json({ data: document });
  } catch (error) {
    return apiError(error);
  }
}
