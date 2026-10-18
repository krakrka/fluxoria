import { createHash, timingSafeEqual } from "crypto";

const SECRET_KEY = /password|token|secret|authorization|cookie|api[_-]?key|stripe-signature|dsn/i;
const SECRET_VALUE = /(sk_live_|sk_test_|whsec_|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._\-]{12,})/;

export function redactLog(value: unknown): unknown {
  if (typeof value === "string") return SECRET_VALUE.test(value) ? "[redacted]" : value;
  if (Array.isArray(value)) return value.map((item) => redactLog(item));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? "[redacted]" : redactLog(item);
  }
  return output;
}

export function secretsMatch(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function publicErrorMessage(error: unknown, fallback = "Erreur interne.") {
  const message = error instanceof Error ? error.message : "";
  if (!message || message.length > 300 || message.includes("\n")) return fallback;
  if (SECRET_VALUE.test(message) || /postgres(ql)?:\/\//i.test(message)) return fallback;
  return message;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("Origine refusée.");
  }
  if (!host || originHost !== host) throw new Error("Origine refusée.");
}
