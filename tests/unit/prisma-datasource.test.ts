import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { directUrlForPrisma } from "@/lib/prisma-datasource";

const pooled = "postgresql://app:local@ep-example-pooler.eu-central-1.aws.neon.tech/app?sslmode=require&pgbouncer=true";
const direct = "postgresql://app:local@ep-example.eu-central-1.aws.neon.tech/app?sslmode=require";

describe("Neon Prisma datasource", () => {
  it("keeps the pooled runtime URL and a direct migration URL in the current Prisma schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(schema).toContain('provider  = "postgresql"');
    expect(schema).toContain('url       = env("DATABASE_URL")');
    expect(schema).toContain('directUrl = env("DIRECT_URL")');
    expect(pkg.scripts["db:deploy"]).toBe("tsx scripts/prisma-cli.ts migrate deploy");
    expect(pkg.scripts.build).toContain("tsx scripts/prisma-cli.ts generate");
    expect(pkg.scripts.build).not.toContain("migrate deploy");
    expect(readFileSync(".env.example", "utf8")).toContain("DIRECT_URL=");
  });

  it("uses the direct URL for migrations and refuses a pooled substitute", () => {
    expect(directUrlForPrisma(pooled, direct)).toEqual({ directUrl: direct });
    expect(directUrlForPrisma("postgresql://app:local@127.0.0.1:5432/app", "")).toEqual({
      directUrl: "postgresql://app:local@127.0.0.1:5432/app",
    });
    const missing = directUrlForPrisma(pooled, "");
    const pooledDirect = directUrlForPrisma(direct, pooled);
    expect(missing).toEqual({ error: "DIRECT_URL est absent. Une URL poolée ne peut pas migrer." });
    expect(pooledDirect).toEqual({ error: "DIRECT_URL pointe vers un pooler. Les migrations exigent la connexion directe." });
    expect(JSON.stringify(missing)).not.toContain("local");
    expect(JSON.stringify(pooledDirect)).not.toContain("ep-example");
  });
});
