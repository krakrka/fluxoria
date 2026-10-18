export type MembershipRef = {
  organizationId: string;
  role: string;
};

/**
 * Picks the organization from memberships the server already loaded.
 * A requested id is ignored unless it belongs to this user.
 */
export function resolveActiveMembership<T extends MembershipRef>(
  memberships: T[],
  requestedOrganizationId: string | null | undefined,
) {
  if (memberships.length === 0) return null;
  const requested = memberships.find((membership) => membership.organizationId === requestedOrganizationId);
  return requested ?? memberships[0];
}
