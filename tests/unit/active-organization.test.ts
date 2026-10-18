import { describe, expect, it } from "vitest";
import { resolveActiveMembership } from "@/lib/active-organization";

const memberships = [
  { organizationId: "org-a", role: "OWNER" },
  { organizationId: "org-b", role: "MEMBER" },
];

describe("active organization", () => {
  it("uses the stored organization when the user is a member", () => {
    expect(resolveActiveMembership(memberships, "org-b")?.organizationId).toBe("org-b");
  });

  it("ignores an organization id that does not belong to the user", () => {
    expect(resolveActiveMembership(memberships, "org-c")?.organizationId).toBe("org-a");
  });

  it("returns nothing when the user has no membership", () => {
    expect(resolveActiveMembership([], "org-a")).toBeNull();
  });
});
