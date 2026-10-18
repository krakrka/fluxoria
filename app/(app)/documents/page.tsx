import Link from "next/link";
import { listDocuments } from "@/services/document-list";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { canDeleteDocument, canRejectDocument, canValidateDocument } from "@/lib/document-status";
import { DOCUMENT_TYPE_CATALOG, documentTypeLabel } from "@/lib/document-types";
import { DOCUMENT_STATUS_LABEL } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { DocumentTable } from "@/components/document-table";
import { EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { UploadForm } from "@/components/upload-form";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const tenant = await requireTenant();
  const params = await searchParams;
  const query = {
    q: one(params.q),
    status: one(params.status),
    type: one(params.type),
    supplier: one(params.supplier),
    customer: one(params.customer),
    from: one(params.from),
    to: one(params.to),
    minAmount: one(params.minAmount),
    maxAmount: one(params.maxAmount),
    minConfidence: one(params.minConfidence),
    sort: one(params.sort),
    page: one(params.page),
  };
  const result = await listDocuments({ organizationId: tenant.organizationId, ...query });
  const rows = result.documents.map((document) => {
    const field = (key: string) => document.fields.find((item) => item.key === key)?.value ?? null;
    const party = field("supplier_name") || field("customer_name") || "—";
    const amount = field("amount_ttc");
    return {
      id: document.id,
      filename: document.filename,
      typeLabel: documentTypeLabel(document.kind),
      party,
      dateLabel: field("issue_date") ? formatDate(field("issue_date")!) : formatDate(document.createdAt),
      amountLabel: amount ? formatMoney(amount) : "—",
      status: document.status,
      statusLabel: DOCUMENT_STATUS_LABEL[document.status],
      confidence: document.confidence,
      updatedLabel: formatDateTime(document.updatedAt),
      canValidate: canValidateDocument(document.status),
      canReject: canRejectDocument(document.status),
      canDelete: canDeleteDocument(document.status),
    };
  });
  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) next.set(key, value);
    }
    next.set("page", String(page));
    return `/documents?${next.toString()}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Inbox"
        title="Documents"
        description="Importez une facture, une commande ou un autre document. Le traitement démarre sans bloquer l'écran."
      />
      <div id="importer">
        <UploadForm />
      </div>
      <form className="mt-6 grid gap-3 rounded-2xl border border-line bg-card p-4 md:grid-cols-4" action="/documents">
        <label className="text-sm md:col-span-2">
          Recherche
          <Input name="q" defaultValue={query.q} placeholder="Nom, numéro, fournisseur, client" aria-label="Recherche" />
        </label>
        <label className="text-sm">
          Statut
          <Select name="status" defaultValue={query.status ?? ""} aria-label="Statut">
            <option value="">Tous</option>
            {Object.entries(DOCUMENT_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Type
          <Select name="type" defaultValue={query.type ?? ""} aria-label="Type">
            <option value="">Tous</option>
            {DOCUMENT_TYPE_CATALOG.filter((entry) => entry.id !== "UNKNOWN").map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Fournisseur
          <Input name="supplier" defaultValue={query.supplier} aria-label="Fournisseur" />
        </label>
        <label className="text-sm">
          Client
          <Input name="customer" defaultValue={query.customer} aria-label="Client" />
        </label>
        <label className="text-sm">
          Du
          <Input name="from" type="date" defaultValue={query.from} aria-label="Date de début" />
        </label>
        <label className="text-sm">
          Au
          <Input name="to" type="date" defaultValue={query.to} aria-label="Date de fin" />
        </label>
        <label className="text-sm">
          Montant min
          <Input name="minAmount" defaultValue={query.minAmount} inputMode="decimal" aria-label="Montant minimum" />
        </label>
        <label className="text-sm">
          Montant max
          <Input name="maxAmount" defaultValue={query.maxAmount} inputMode="decimal" aria-label="Montant maximum" />
        </label>
        <label className="text-sm">
          Confiance min. %
          <Input name="minConfidence" defaultValue={query.minConfidence} inputMode="numeric" aria-label="Confiance minimum" />
        </label>
        <label className="text-sm">
          Tri
          <Select name="sort" defaultValue={query.sort ?? "date"} aria-label="Tri">
            <option value="date">Date</option>
            <option value="amount">Montant</option>
            <option value="name">Nom</option>
            <option value="status">Statut</option>
            <option value="updated">Dernière modification</option>
          </Select>
        </label>
        <div className="flex items-end">
          <button className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground" type="submit">
            Filtrer
          </button>
        </div>
      </form>
      <div className="mt-6">
        {result.total === 0 ? (
          <EmptyState
            title="Aucun document pour le moment."
            body="Importez votre première facture, commande ou document."
            href="#importer"
            action="Importer un document"
          />
        ) : (
          <DocumentTable rows={rows} canDelete={can(tenant.role, "documents.delete")} />
        )}
      </div>
      {result.pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted">Page {result.page} / {result.pageCount}</span>
          <span className="flex gap-3">
            {result.page > 1 && <Link href={pageHref(result.page - 1)}>Précédente</Link>}
            {result.page < result.pageCount && <Link href={pageHref(result.page + 1)}>Suivante</Link>}
          </span>
        </div>
      )}
    </div>
  );
}
