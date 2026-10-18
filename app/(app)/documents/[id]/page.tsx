import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { DOCUMENT_STATUS_LABEL } from "@/lib/labels";
import { isMockAiMode } from "@/lib/env";
import { readConfidenceThresholds } from "@/lib/confidence";
import { canDeleteDocument, canRejectDocument, canReprocessDocument, canValidateDocument } from "@/lib/document-status";
import { formatDateTime } from "@/lib/format";
import { DocumentPanel } from "@/components/document-panel";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  "document.uploaded": "Document reçu",
  "document.processing_started": "Analyse commencée",
  "document.processed": "Extraction terminée",
  "document.processing_failed": "Analyse interrompue",
  "document.field_updated": "Champ modifié",
  "document.validated": "Document validé",
  "document.rejected": "Document rejeté",
  "document.deleted": "Document supprimé",
};

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function DocumentPage({ params, searchParams }: Params) {
  const tenant = await requireTenant();
  const { id } = await params;
  const query = await searchParams;
  const document = await prisma.document.findFirst({
    where: { id, organizationId: tenant.organizationId, deletedAt: null },
    include: {
      fields: { orderBy: { label: "asc" } },
      lines: { orderBy: { position: "asc" } },
    },
  });
  if (!document) notFound();
  const [organization, events] = await Promise.all([
    prisma.organization.findFirst({ where: { id: tenant.organizationId } }),
    prisma.auditLog.findMany({
      where: { organizationId: tenant.organizationId, documentId: document.id },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const settings = (organization?.settings ?? {}) as { minutesPerDocument?: number };
  const thresholds = readConfidenceThresholds(organization?.settings);
  const usage = await prisma.aiUsage.findFirst({
    where: { documentId: document.id, organizationId: tenant.organizationId },
    orderBy: { createdAt: "desc" },
  });
  const warnings = Array.isArray(document.warnings) ? document.warnings.filter((item): item is string => typeof item === "string") : [];
  const allowedDelete = can(tenant.role, "documents.delete") && canDeleteDocument(document.status);
  const allowedValidate = can(tenant.role, "documents.validate") && canValidateDocument(document.status);

  return (
    <div>
      {query.error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">{query.error}</p>}
      <DocumentPanel
        id={document.id}
        status={document.status}
        statusLabel={DOCUMENT_STATUS_LABEL[document.status]}
        filename={document.filename}
        mimeType={document.mimeType}
        warnings={warnings}
        errorMessage={document.errorMessage}
        rejectionReason={document.rejectionReason}
        mockMode={isMockAiMode() && (!usage || usage.strategy === "mock")}
        minutesSaved={settings.minutesPerDocument ?? 12}
        thresholds={thresholds}
        canValidate={allowedValidate}
        canReject={allowedValidate && canRejectDocument(document.status)}
        canReprocess={can(tenant.role, "documents.update") && canReprocessDocument(document.status)}
        canDelete={allowedDelete}
        timeline={events.map((event) => ({
          id: event.id,
          label: describeEvent(event.action, event.newValue),
          at: formatDateTime(event.createdAt),
        }))}
        fields={document.fields.map((field) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          value: field.value,
          confidence: field.confidence,
          source: field.source,
          validated: field.validated,
          page: field.page,
          zone: field.zone,
          sourceText: field.sourceText,
        }))}
        lines={document.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toString(),
          vatRate: line.vatRate.toString(),
          amountHt: line.amountHt.toString(),
          confidence: line.confidence,
        }))}
      />
    </div>
  );
}

function describeEvent(action: string, value: unknown) {
  const base = EVENT_LABEL[action] ?? action;
  if (!value || typeof value !== "object") return base;
  const record = value as { kind?: string; confidence?: number; status?: string };
  if (action === "document.processed") {
    if (record.status === "NEEDS_REVIEW") return "Vérification nécessaire";
    const percent = typeof record.confidence === "number" ? Math.round(record.confidence * 100) : null;
    return percent === null ? "Extraction terminée" : `Extraction terminée · confiance ${percent} %`;
  }
  return base;
}
