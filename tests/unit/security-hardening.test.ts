import { describe, expect, it } from "vitest";
import { publicErrorMessage, secretsMatch } from "@/lib/security";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";
import { rateLimit } from "@/lib/rate-limit";

describe("security hardening", () => {
  it("compares secrets without accepting a different value", () => {
    expect(secretsMatch("inbound-secret", "inbound-secret")).toBe(true);
    expect(secretsMatch("inbound-secret", "inbound-secret-other")).toBe(false);
    expect(secretsMatch("a", "ab")).toBe(false);
  });

  it("hides secrets and database URLs from client errors", () => {
    expect(publicErrorMessage(new Error("Document introuvable."))).toBe("Document introuvable.");
    expect(publicErrorMessage(new Error("postgres://user:secret@localhost/fluxora"))).toBe("Erreur interne.");
    expect(publicErrorMessage(new Error("refused sk_live_secretvalue"))).toBe("Erreur interne.");
  });

  it("keeps unsafe-eval out of the production content policy", () => {
    const production = contentSecurityPolicy(true);
    const development = contentSecurityPolicy(false);
    expect(production).not.toContain("unsafe-eval");
    expect(production).toContain("unsafe-inline");
    expect(development).toContain("unsafe-eval");
    expect(securityHeaders(true).some((header) => header.key === "Strict-Transport-Security")).toBe(true);
    expect(securityHeaders(false).some((header) => header.key === "Strict-Transport-Security")).toBe(false);
  });

  it("stops a key after the local limit", () => {
    const key = `invite-test-${Date.now()}`;
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(true);
    expect(rateLimit(key, 2, 60_000).ok).toBe(false);
  });
});
