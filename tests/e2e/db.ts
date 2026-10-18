import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function databaseUrl() {
  const current = process.env.DATABASE_URL?.trim().replace(/^["']|["']$/g, "");
  if (current) return current;
  const raw = readFileSync(path.join(process.cwd(), ".env"), "utf8");
  const line = raw.split(/\r?\n/).find((row) => row.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL absent pour le contrôle d'isolation.");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

export function e2ePrisma() {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl();
  return new PrismaClient();
}
