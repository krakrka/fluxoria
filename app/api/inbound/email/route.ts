import { NextResponse } from "next/server";
import { normalizeForwardedEmail } from "@/connectors/email/inbox";
import { secretsMatch } from "@/lib/security";
import { acceptInboundEmail, findOrganizationByInbox } from "@/services/email-ingestion";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  const provided = request.headers.get("x-fluxora-inbound-secret");
  if (!secret || !provided || !secretsMatch(provided, secret)) {
    return NextResponse.json({ error: { message: "Import email non autorisé." } }, { status: 401 });
  }
  const form = await request.formData();
  const recipient = String(form.get("to") ?? "");
  const organizationId = await findOrganizationByInbox(recipient);
  if (!organizationId) return NextResponse.json({ error: { message: "Boîte inconnue." } }, { status: 404 });
  const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  const result = await acceptInboundEmail({
    organizationId,
    userId: null,
    provider: "FLUXORA_INBOX",
    message: normalizeForwardedEmail({
      externalId: String(form.get("messageId") ?? `hook-${Date.now()}`),
      from: String(form.get("from") ?? ""),
      recipient,
      subject: String(form.get("subject") ?? ""),
      attachments: await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      ),
    }),
  });
  return NextResponse.json({ data: result }, { status: 201 });
}
