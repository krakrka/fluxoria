import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const tenant = await requireTenant();
  if (!can(tenant.role, "audit.read")) {
    return <EmptyState title="Accès limité" body="Le journal est visible par le propriétaire, l'admin et le comptable." />;
  }
  const logs = await prisma.auditLog.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { user: { select: { name: true } } },
  });

  return (
    <div>
      <PageHeader eyebrow="Traçabilité" title="Journal d'audit" description="Qui a modifié quoi, avec l'ancienne et la nouvelle valeur." />
      <Panel>
        <ul className="divide-y divide-line">
          {logs.map((log) => (
            <li key={log.id} className="px-5 py-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <p>
                  <span className="font-medium">{log.user?.name ?? "Système"}</span> {log.action}
                </p>
                <p className="text-xs text-muted">{formatDateTime(log.createdAt)}</p>
              </div>
              <p className="mt-1 text-xs text-muted">
                {log.entityType} · {log.entityId}
                {log.documentId ? ` · document ${log.documentId}` : ""}
              </p>
              {(log.oldValue || log.newValue) && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-3 text-xs">
                  {JSON.stringify({ avant: log.oldValue ?? null, apres: log.newValue ?? null }, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
