import "server-only";
import { prisma } from "@/server/db";

export type StatusLevel = "operational" | "degraded" | "outage" | "unmeasured";

export function statusEditors() {
  return (process.env.STATUS_EDITOR_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function canEditStatus(email: string) {
  return statusEditors().includes(email.toLowerCase());
}

export async function readServiceStatus() {
  const incidents = await prisma.serviceIncident.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const open = incidents.filter((incident) => !incident.resolvedAt);
  const forced = process.env.STATUS_LEVEL;
  const level: StatusLevel =
    forced === "outage" || forced === "degraded" || forced === "operational"
      ? forced
      : open.some((incident) => incident.level === "outage")
        ? "outage"
        : open.some((incident) => incident.level === "degraded")
          ? "degraded"
          : open.some((incident) => incident.level === "operational")
            ? "operational"
            : "unmeasured";
  return { level, incidents };
}

export async function publishIncident(input: { level: string; title: string; message: string }) {
  if (input.level !== "degraded" && input.level !== "outage" && input.level !== "operational") {
    throw new Error("Niveau d'incident inconnu.");
  }
  const title = input.title.trim();
  const message = input.message.trim();
  if (title.length < 3 || title.length > 120) throw new Error("Le titre doit rester court.");
  if (message.length < 10 || message.length > 500) throw new Error("Décrivez l'incident en quelques phrases, sans donnée client.");
  return prisma.serviceIncident.create({ data: { level: input.level, title, message } });
}

export async function resolveIncident(id: string) {
  await prisma.serviceIncident.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date() } });
}
