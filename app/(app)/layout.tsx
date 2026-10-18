import { prisma } from "@/server/db";
import { refreshOverdue } from "@/services/organization";
import { requireTenant } from "@/server/tenant";
import { isDemoOrganization } from "@/lib/roi";
import { trialRemainingDays } from "@/services/billing";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await requireTenant();
  await refreshOverdue(tenant.organizationId);
  const [organization, notifications, memberships, subscription] = await Promise.all([
    prisma.organization.findFirst({ where: { id: tenant.organizationId, deletedAt: null } }),
    prisma.notification.findMany({
      where: { organizationId: tenant.organizationId, read: false },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.organizationMember.findMany({
      where: { userId: tenant.userId },
      include: { organization: { select: { id: true, name: true, deletedAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.subscription.findUnique({ where: { organizationId: tenant.organizationId } }),
  ]);

  return (
    <Shell
      organizationId={tenant.organizationId}
      organizationName={organization?.name ?? "Organisation"}
      organizations={memberships.filter((membership) => !membership.organization.deletedAt).map((membership) => membership.organization)}
      userName={tenant.name}
      role={tenant.role}
      emailVerified={tenant.emailVerified}
      demo={isDemoOrganization(organization?.settings)}
      trialDaysLeft={subscription?.status === "TRIALING" ? trialRemainingDays(subscription.trialEndsAt) : null}
      notifications={notifications}
    >
      {children}
    </Shell>
  );
}
