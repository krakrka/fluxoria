import { NextResponse } from "next/server";
import { REJECT_REASON_LABEL } from "@/lib/labels";
import { rejectSchema } from "@/lib/schemas";
import { apiError, requireApi } from "@/server/http";
import { rejectDocument } from "@/services/documents";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const access = await requireApi("documents.validate");
  if (access.error) return access.error;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return apiError(new Error("Indiquez un motif de rejet."));
  const label = REJECT_REASON_LABEL[parsed.data.code];
  const reason = parsed.data.detail ? `${label} — ${parsed.data.detail}` : label;
  try {
    await rejectDocument({
      organizationId: access.tenant.organizationId,
      userId: access.tenant.userId,
      documentId: id,
      reason,
    });
    return NextResponse.json({ data: { id, status: "REJECTED" } });
  } catch (error) {
    return apiError(error);
  }
}
