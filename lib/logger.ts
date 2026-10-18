import { randomUUID } from "crypto";
import { redactLog } from "@/lib/security";

type LogFields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

const metrics = { errors: 0, warnings: 0 };

function allow(level: Level) {
  if (level !== "debug") return true;
  return process.env.NODE_ENV !== "production" || process.env.LOG_LEVEL === "debug";
}

let lastAlertAt = 0;

function write(level: Level, message: string, fields?: LogFields) {
  if (!allow(level)) return;
  if (level === "error") metrics.errors += 1;
  if (level === "warn") metrics.warnings += 1;
  const entry = redactLog({
    ts: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    service: "fluxora",
    ...fields,
  });
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
  if (level === "error") void notifyAlert(entry);
}

async function notifyAlert(entry: unknown) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const now = Date.now();
  if (now - lastAlertAt < 10_000) return;
  lastAlertAt = now;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => undefined);
}

async function trackError(entry: unknown) {
  const url = process.env.ERROR_TRACKING_URL;
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => undefined);
}

export const logger = {
  debug(message: string, fields?: LogFields) {
    write("debug", message, fields);
  },
  info(message: string, fields?: LogFields) {
    write("info", message, fields);
  },
  warn(message: string, fields?: LogFields) {
    write("warn", message, fields);
  },
  error(message: string, fields?: LogFields) {
    write("error", message, fields);
  },
};

export function logMetrics() {
  return { errors: metrics.errors, warnings: metrics.warnings };
}

export function captureException(error: unknown, context?: LogFields) {
  const correlationId = randomUUID();
  const message = error instanceof Error ? error.message : String(error);
  const entry = {
    correlationId,
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
    ...context,
  };
  logger.error("application_error", entry);
  void trackError(redactLog(entry));
  return correlationId;
}
