import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/security";
import { apiError, requireApi } from "@/server/http";
import { importBulkDocuments } from "@/services/bulk-import";

export const runtime = "nodejs";

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
  const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) return apiError(new Error("Aucun fichier."));
  if (files.length > 30) return apiError(new Error("30 fichiers maximum par envoi."));
  try {
    const result = await importBulkDocuments({
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
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
