import Link from "next/link";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { DEMO_PATH } from "@/lib/demo-story";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ParcoursPage() {
  const tenant = await requireTenant();
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: tenant.organizationId, number: { in: ["FAC-2026-1001", "FAC-2026-1002", "FAC-AUTO-700", "FAC-MGR-2500", "FAC-OWN-8000", "FAC-SANS-BC"] } },
    select: { id: true, number: true, documentId: true, supplierId: true, matchedPurchaseOrderId: true },
  });
  const byNumber = new Map<string, (typeof invoices)[number]>();
  for (const invoice of invoices) {
    const current = byNumber.get(invoice.number);
    if (!current || (invoice.documentId && !current.documentId)) byNumber.set(invoice.number, invoice);
  }
  const order = await prisma.purchaseOrder.findFirst({
    where: { organizationId: tenant.organizationId, number: "BC-2026-0142" },
    select: { id: true },
  });

  function hrefFor(stepId: string) {
    if (stepId === "po" && order) return `/purchase-orders/${order.id}`;
    if (stepId === "rule") return "/automations";
    if (stepId === "audit") return "/audit";
    const number = stepId === "anomaly" ? "FAC-2026-1002" : stepId === "decision" ? "FAC-AUTO-700" : "FAC-2026-1001";
    const invoice = byNumber.get(number);
    if (!invoice) return null;
    if (stepId === "pdf" || stepId === "extraction") return invoice.documentId ? `/documents/${invoice.documentId}` : `/invoices/${invoice.id}`;
    if (stepId === "supplier" && invoice.supplierId) return `/suppliers/${invoice.supplierId}`;
    if (stepId === "matching" && invoice.matchedPurchaseOrderId) return `/purchase-orders/${invoice.matchedPurchaseOrderId}`;
    return `/invoices/${invoice.id}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Démonstration" title="Parcours Atlas" description="Neuf étapes, dans l'ordre d'une facture réelle. Chaque lien ouvre la pièce correspondante de cette organisation." />
      <ol className="space-y-3">
        {DEMO_PATH.map((step, index) => {
          const href = hrefFor(step.id);
          return (
            <li key={step.id}>
              <Panel className="p-5">
                <p className="text-xs text-muted">0{index + 1} · {step.title}</p>
                <p className="mt-2 text-sm leading-6">{step.body}</p>
                {href ? <Link className="mt-3 inline-block text-sm underline" href={href}>Ouvrir</Link> : <p className="mt-3 text-sm text-muted">Cette étape apparaît avec le jeu de démonstration Atlas Industrie.</p>}
              </Panel>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
