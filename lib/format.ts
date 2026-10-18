import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { decimalToCents, formatEurFromCents } from "@/lib/money";

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "d MMM yyyy", { locale: fr });
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "d MMM yyyy 'à' HH:mm", { locale: fr });
}

export function formatMoney(value: { toString(): string } | number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return formatEurFromCents(decimalToCents(value));
}

export function formatPercent(confidence: number) {
  return `${Math.round(confidence * 100)} %`;
}

export function daysLate(dueAt: Date | string | null | undefined, now = new Date()) {
  if (!dueAt) return 0;
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const diff = now.getTime() - due.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}
