import { NextResponse } from "next/server";
import { apiError, requireApi } from "@/server/http";
import { previewCsv, type CsvKind } from "@/services/csv-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const access = await requireApi("imports.manage");
  if (access.error) return access.error;
  const body = (await request.json()) as { kind?: string; csv?: string };
  const kind = body.kind;
  if (kind !== "suppliers" && kind !== "customers" && kind !== "orders") return apiError(new Error("Type d'import inconnu."));
  return NextResponse.json({ data: previewCsv(kind as CsvKind, body.csv ?? "") });
}
