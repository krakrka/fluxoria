import { NextResponse } from "next/server";
import { fieldUpdateSchema } from "@/lib/schemas";
import { apiError, requireApi } from "@/server/http";
import { updateDocumentField } from "@/services/documents";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const access = await requireApi("documents.update");
  if (access.error) return access.error;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = fieldUpdateSchema.safeParse(body);
  if (!parsed.success) return apiError(new Error("Champ invalide."));
  try {
    const field = await updateDocumentField({
      organizationId: access.tenant.organizationId,
      userId: access.tenant.userId,
      documentId: id,
      key: parsed.data.key,
      value: parsed.data.value,
    });
    return NextResponse.json({ data: field });
  } catch (error) {
    return apiError(error);
  }
}
