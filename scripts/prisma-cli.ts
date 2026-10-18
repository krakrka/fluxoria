import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { directUrlForPrisma } from "../lib/prisma-datasource";

function loadMissingEnv() {
  if (!existsSync(".env")) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function redact(text: string) {
  return text.replace(/(?:postgres(?:ql)?|libsql):\/\/\S+/gi, "[redacted]");
}

function main() {
  loadMissingEnv();
  const resolved = directUrlForPrisma(process.env.DATABASE_URL ?? "", process.env.DIRECT_URL);
  if ("error" in resolved) {
    console.error(resolved.error);
    process.exitCode = 1;
    return;
  }
  process.env.DIRECT_URL = resolved.directUrl;
  const args = process.argv.slice(2);
  if (args.length === 0 || args.some((arg) => !/^[a-z-]+$/i.test(arg))) {
    console.error("Commande Prisma refusée.");
    process.exitCode = 1;
    return;
  }
  try {
    const output = execFileSync(`npx prisma ${args.join(" ")}`, {
      env: process.env,
      encoding: "utf8",
      shell: true,
    });
    const text = redact(output ?? "");
    if (text.trim()) process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout ?? "") : "";
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    const message = error instanceof Error ? error.message : "Commande Prisma impossible.";
    process.stderr.write(redact(`${stdout}\n${stderr}\n${message}`).slice(0, 2000));
    process.exitCode = 1;
  }
}

main();
