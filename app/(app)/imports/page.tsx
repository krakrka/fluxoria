import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { CsvWorkshop } from "@/components/csv-workshop";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { UploadForm } from "@/components/upload-form";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const tenant = await requireTenant();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Entrées" title="Imports" description="Déposez un lot de documents, une archive ZIP, ou prévisualisez un CSV avant de l'enregistrer." />
      <Panel className="p-5">
        <h2 className="mb-3 text-sm font-medium">Documents en lot</h2>
        <UploadForm />
      </Panel>
      {can(tenant.role, "imports.manage") ? (
        <Panel className="p-5">
          <h2 className="mb-1 text-sm font-medium">CSV</h2>
          <p className="mb-3 text-sm text-muted">Colonnes fournisseurs : nom, siren, tva, email. Clients : nom, siren, tva, email. Commandes : numero, fournisseur, siren, montant_ttc, devise, date.</p>
          <CsvWorkshop />
        </Panel>
      ) : (
        <EmptyState title="Import CSV réservé" body="Le propriétaire, l'admin et le comptable peuvent importer des référentiels." />
      )}
    </div>
  );
}
