import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/security";
import { prisma } from "@/server/db";
import { apiError, requireApi } from "@/server/http";
import { createUploadedDocuments } from "@/services/documents";
import { enqueueDocumentProcessing } from "@/services/queue";

export const runtime = "nodejs";

const querySchema = z.object({
  status: z.enum(["RECEIVED", "PROCESSING", "PROCESSED", "NEEDS_REVIEW", "VALIDATED", "REJECTED", "ERROR"]).optional(),
});

export async function GET(request: Request) {
  const access = await requireApi("documents.read");
  if (access.error) return access.error;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ status: url.searchParams.get("status") ?? undefined });
  if (!parsed.success) return apiError(new Error("Filtre de statut invalide."));
  const documents = await prisma.document.findMany({
    where: {
      organizationId: access.tenant.organizationId,
      deletedAt: null,
      status: parsed.data.status,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      filename: true,
      status: true,
      kind: true,
      confidence: true,
      createdAt: true,
      mimeType: true,
    },
  });
  return NextResponse.json({ data: documents });
}

export async function POST(request: Request) {
  const access = await requireApi("documents.upload");
  if (access.error) return access.error;
  try {
    assertSameOrigin(request);
  } catch (error) {
    return apiError(error);
  }
  const limit = rateLimit(`upload:${access.tenant.organizationId}`, 30, 60 * 1000);
  if (!limit.ok) return apiError(new Error("Trop d'envois. Réessayez dans une minute."));
  const form = await request.formData();
  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  if (files.length === 0) return apiError(new Error("Aucun fichier."));
  if (files.length > 10) return apiError(new Error("10 fichiers maximum par envoi."));
  try {
    const created = await createUploadedDocuments({
      organizationId: access.tenant.organizationId,
      userId: access.tenant.userId,
      files: await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      ),
    });
    for (const document of created) {
      await enqueueDocumentProcessing(access.tenant.organizationId, document.id);
    }
    return NextResponse.json(
      { data: created.map((document) => ({ id: document.id, filename: document.filename, status: document.status })) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
