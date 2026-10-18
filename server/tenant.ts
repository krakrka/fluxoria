import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { resolveActiveMembership } from "@/lib/active-organization";
import { assertCan, type MemberRole, type Permission } from "@/lib/permissions";

export type TenantContext = {
  userId: string;
  organizationId: string;
  role: MemberRole;
  email: string;
  name: string;
  emailVerified: boolean;
};

export async function getTenant(): Promise<TenantContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      name: true,
      sessionVersion: true,
      emailVerifiedAt: true,
      activeOrganizationId: true,
      memberships: {
        where: { organization: { deletedAt: null } },
        orderBy: { createdAt: "asc" },
        select: { organizationId: true, role: true, userId: true },
      },
    },
  });

  if (!user || user.sessionVersion !== session.sessionVersion) return null;
  const membership = resolveActiveMembership(user.memberships, user.activeOrganizationId);
  if (!membership) return null;

  return {
    userId: session.user.id,
    organizationId: membership.organizationId,
    role: membership.role,
    email: user.email,
    name: user.name,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

export async function requireTenant() {
  const tenant = await getTenant();
  if (!tenant) redirect("/login");
  return tenant;
}

export async function requirePermission(permission: Permission) {
  const tenant = await requireTenant();
  assertCan(tenant.role, permission);
  return tenant;
}
