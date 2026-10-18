export const MEMBER_ROLES = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PERMISSIONS = {
  "org.read": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "org.update": ["OWNER", "ADMIN"],
  "org.delete": ["OWNER"],
  "members.manage": ["OWNER", "ADMIN"],
  "members.assignOwner": ["OWNER"],
  "billing.manage": ["OWNER"],
  "documents.upload": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "documents.read": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "documents.update": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "documents.validate": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "documents.delete": ["OWNER", "ADMIN"],
  "approvals.manage": ["OWNER", "ADMIN", "MANAGER"],
  "invoices.read": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "invoices.update": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"],
  "orders.read": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "orders.update": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"],
  "parties.manage": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "rules.read": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "rules.manage": ["OWNER", "ADMIN"],
  "audit.read": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"],
  "reports.read": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"],
  "gdpr.export": ["OWNER", "ADMIN"],
  "reminders.manage": ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"],
  "connectors.manage": ["OWNER", "ADMIN"],
  "imports.manage": ["OWNER", "ADMIN", "ACCOUNTANT"],
  "system.read": ["OWNER", "ADMIN"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: string, permission: Permission) {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function assertCan(role: string, permission: Permission) {
  if (!can(role, permission)) {
    const error = new Error("Action non autorisée pour ce rôle.");
    error.name = "ForbiddenError";
    throw error;
  }
}
