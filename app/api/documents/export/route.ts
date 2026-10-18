import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/server/db";
import { apiError, requireApi } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await requireApi("documents.read");
  if (access.error) return access.error;
  const limit = rateLimit(`export:${access.tenant.organizationId}`, 10, 60 * 60 * 1000);
  if (!limit.ok) return NextResponse.json({ error: { message: "Trop d'exports. Réessayez plus tard." } }, { status: 429 });
  const ids = new URL(request.url).searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  if (ids.length === 0 || ids.length > 100) return apiError(new Error("Sélectionnez entre 1 et 100 documents."));
  const documents = await prisma.document.findMany({
    where: { organizationId: access.tenant.organizationId, id: { in: ids }, deletedAt: null },
    include: { fields: { where: { key: { in: ["invoice_number", "supplier_name", "customer_name", "amount_ttc"] } } } },
    orderBy: { updatedAt: "desc" },
  });
  const header = ["id", "filename", "kind", "status", "confidence", "number", "party", "amount_ttc"];
  const lines = documents.map((document) => {
    const field = (key: string) => document.fields.find((item) => item.key === key)?.value ?? "";
    return [
      document.id,
      document.filename,
      document.kind,
      document.status,
      document.confidence ?? "",
      field("invoice_number"),
      field("supplier_name") || field("customer_name"),
      field("amount_ttc"),
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",");
  });
  return new NextResponse([header.join(","), ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"documents.csv\"",
    },
  });
}
