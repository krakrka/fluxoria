import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";

describe("permissions", () => {
  it("lets the owner delete the organization and manage billing", () => {
    expect(can("OWNER", "org.delete")).toBe(true);
    expect(can("OWNER", "billing.manage")).toBe(true);
  });

  it("keeps members away from billing, deletion and audit", () => {
    expect(can("MEMBER", "documents.validate")).toBe(true);
    expect(can("MEMBER", "org.delete")).toBe(false);
    expect(can("MEMBER", "billing.manage")).toBe(false);
    expect(can("MEMBER", "audit.read")).toBe(false);
    expect(can("MEMBER", "rules.manage")).toBe(false);
  });

  it("lets accountants validate and read the journal, not manage members", () => {
    expect(can("ACCOUNTANT", "invoices.update")).toBe(true);
    expect(can("ACCOUNTANT", "audit.read")).toBe(true);
    expect(can("ACCOUNTANT", "members.manage")).toBe(false);
  });

  it("lets a manager approve without managing billing, members or global settings", () => {
    expect(can("MANAGER", "approvals.manage")).toBe(true);
    expect(can("MANAGER", "documents.validate")).toBe(true);
    expect(can("MANAGER", "audit.read")).toBe(true);
    expect(can("MANAGER", "rules.read")).toBe(true);
    expect(can("MANAGER", "members.manage")).toBe(false);
    expect(can("MANAGER", "billing.manage")).toBe(false);
    expect(can("MANAGER", "rules.manage")).toBe(false);
    expect(can("MANAGER", "org.update")).toBe(false);
  });

  it("keeps the employee account, stored as MEMBER, away from approvals and settings", () => {
    expect(can("MEMBER", "documents.read")).toBe(true);
    expect(can("MEMBER", "approvals.manage")).toBe(false);
    expect(can("MEMBER", "org.update")).toBe(false);
    expect(can("MEMBER", "members.manage")).toBe(false);
    expect(can("MEMBER", "billing.manage")).toBe(false);
    expect(can("MEMBER", "rules.manage")).toBe(false);
  });

  it("lets admins manage members but not assign the owner role permission", () => {
    expect(can("ADMIN", "members.manage")).toBe(true);
    expect(can("ADMIN", "members.assignOwner")).toBe(false);
    expect(can("ADMIN", "org.delete")).toBe(false);
  });
});
