import { readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactLog } from "@/lib/security";
import { assertProductionSafety, demoLoginHint, ENV_CATALOG, serviceConfiguration } from "@/lib/runtime-config";
import { signS3Request } from "@/services/s3";
import { assertTenantStorageKey } from "@/services/storage";
import { canEditStatus } from "@/services/status";
import { can } from "@/lib/permissions";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production configuration", () => {
  it("lists environment names without values", () => {
    const example = readFileSync(".env.example", "utf8");
    expect(example).not.toMatch(/sk_live_|sk_test_|whsec_|postgresql:\/\//);
    for (const entry of ENV_CATALOG) {
      expect(example).toContain(`${entry.name}=`);
      expect(entry.purpose).not.toMatch(/sk_live_|whsec_/);
    }
  });

  it("refuses an exposed reset link and a non-https origin in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXPOSE_RESET_LINK", "true");
    vi.stubEnv("APP_URL", "https://fluxora.example");
    expect(() => assertProductionSafety()).toThrow(/EXPOSE_RESET_LINK/);
    vi.stubEnv("EXPOSE_RESET_LINK", "");
    vi.stubEnv("APP_URL", "http://fluxora.example");
    vi.stubEnv("AUTH_URL", "");
    expect(() => assertProductionSafety()).toThrow(/https/);
  });

  it("requires s3 settings before a production process starts", () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXPOSE_RESET_LINK", "false");
    vi.stubEnv("APP_URL", "https://fluxora.example");
    vi.stubEnv("STORAGE_DRIVER", "local");
    expect(() => assertProductionSafety()).toThrow(/STORAGE_DRIVER=s3/);
    vi.stubEnv("STORAGE_DRIVER", "s3");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", secret);
    expect(() => assertProductionSafety()).toThrow(/S3_BUCKET/);
    try {
      assertProductionSafety();
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(secret);
    }
    vi.stubEnv("S3_BUCKET", "fluxora-documents");
    vi.stubEnv("S3_REGION", "eu-west-3");
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE");
    vi.stubEnv("S3_ENDPOINT", "http://storage.internal");
    expect(() => assertProductionSafety()).toThrow(/S3_ENDPOINT/);
    vi.stubEnv("S3_ENDPOINT", "");
    expect(() => assertProductionSafety()).not.toThrow();
  });

  it("hides the demo hint in production and keeps secrets out of service status", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_LOGIN_HINT", "owner@atlas-industrie.test · Fluxora-Demo-2026");
    expect(demoLoginHint()).toBe("");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example");
    const status = JSON.stringify(serviceConfiguration());
    expect(status).not.toContain("sk_test_example");
    expect(status).not.toContain("DATABASE_URL");
  });

  it("signs object storage without putting the secret in the URL", () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const signed = signS3Request({
      target: {
        bucket: "fluxora",
        region: "eu-west-3",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: secret,
      },
      method: "GET",
      key: "organizations/org-a/documents/doc/original",
      now: new Date("2026-10-04T12:00:00.000Z"),
    });
    expect(signed.url).toContain("organizations/org-a/documents/doc/original");
    expect(signed.url).not.toContain(secret);
    expect(JSON.stringify(signed.headers)).not.toContain(secret);
  });

  it("refuses a storage key that belongs to another organization", () => {
    expect(() => assertTenantStorageKey("organizations/org-a/documents/doc/original", "org-b")).toThrow(/introuvable/);
    expect(() => assertTenantStorageKey("../organizations/org-b/documents/doc/original", "org-b")).toThrow(/invalide/);
    expect(assertTenantStorageKey("organizations/org-a/documents/doc/original", "org-a")).toBeUndefined();
  });

  it("lets only listed emails publish a status incident", () => {
    vi.stubEnv("STATUS_EDITOR_EMAILS", "editor@fluxora.test");
    expect(canEditStatus("editor@fluxora.test")).toBe(true);
    expect(canEditStatus("member@client.test")).toBe(false);
  });

  it("keeps client roles out of billing, members, audit and the system console", () => {
    for (const role of ["MANAGER", "MEMBER"] as const) {
      expect(can(role, "billing.manage")).toBe(false);
      expect(can(role, "system.read")).toBe(false);
      expect(can(role, "members.manage")).toBe(false);
      expect(can(role, "connectors.manage")).toBe(false);
    }
    expect(can("ADMIN", "system.read")).toBe(true);
    expect(can("ADMIN", "billing.manage")).toBe(false);
    expect(can("OWNER", "billing.manage")).toBe(true);
    expect(can("MEMBER", "audit.read")).toBe(false);
  });

  it("redacts secret-looking values", () => {
    expect(redactLog("sk_live_abcdefghijklmnopqrstuvwxyz")).toBe("[redacted]");
    expect(redactLog({ apiKey: "present", note: "ok" })).toEqual({ apiKey: "[redacted]", note: "ok" });
  });
});
