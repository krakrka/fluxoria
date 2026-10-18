import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { apiError, requireApi } from "@/server/http";
import { StorageError, storageDownloadStatus } from "@/lib/storage-error";
import { getStorage, readForOrganization } from "@/services/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const access = await requireApi("documents.read");
  if (access.error) return access.error;
  const { id } = await params;
  const document = await prisma.document.findFirst({
    where: { id, organizationId: access.tenant.organizationId, deletedAt: null },
  });
  if (!document || document.storageKey === "pending") return apiError(new Error("Document introuvable."));
  const download = new URL(_request.url).searchParams.get("download") === "1";
  try {
    const bytes = await readForOrganization(getStorage(), access.tenant.organizationId, document.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(document.filename)}"`,
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof StorageError) {
      const failure = storageDownloadStatus(error);
      return NextResponse.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status });
    }
    return apiError(error);
  }
}
