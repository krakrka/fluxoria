import Link from "next/link";
import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { formatDateTime } from "@/lib/format";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/server/actions";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const tenant = await requireTenant();
  const notifications = await prisma.notification.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Suivi"
        title="Notifications"
        description="Approbations, anomalies critiques, erreurs de traitement et factures qui demandent une intervention."
        action={
          notifications.some((item) => !item.read) ? (
            <form action={markAllNotificationsReadAction}>
              <SubmitButton variant="secondary">Tout marquer comme lu</SubmitButton>
            </form>
          ) : null
        }
      />
      {notifications.length === 0 ? (
        <EmptyState title="Aucune notification" body="Les décisions et les erreurs de traitement apparaîtront ici." />
      ) : (
        <div className="space-y-2">
          {notifications.map((item) => (
            <Panel key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-muted">{item.body}</p>
                <p className="text-xs text-muted">{formatDateTime(item.createdAt)} · {item.read ? "Lue" : "Non lue"}</p>
                {item.href && <Link className="underline" href={item.href}>Ouvrir</Link>}
              </div>
              {!item.read && (
                <form action={markNotificationReadAction}>
                  <input type="hidden" name="notificationId" value={item.id} />
                  <SubmitButton variant="secondary">Marquer comme lu</SubmitButton>
                </form>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
