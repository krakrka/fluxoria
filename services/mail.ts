import "server-only";
import { prisma } from "@/server/db";
import { logger } from "@/lib/logger";

export type MailTemplate = "verification" | "invitation" | "password_reset" | "approval" | "onboarding" | "billing" | "support";

export type MailMessage = {
  to: string;
  template: MailTemplate;
  subject: string;
  text: string;
  organizationId?: string | null;
  idempotencyKey?: string;
};

export interface MailProvider {
  readonly name: string;
  send(message: MailMessage): Promise<{ delivered: boolean }>;
}

/** Production provider. Any HTTPS endpoint that accepts the same JSON can replace it. */
export class HttpMailProvider implements MailProvider {
  readonly name = "http";

  async send(message: MailMessage) {
    if (process.env.EMAIL_DELIVERY_ENABLED !== "true") return { delivered: false };
    const url = process.env.EMAIL_API_URL;
    const key = process.env.EMAIL_API_KEY;
    if (!url || !key) {
      logger.warn("mail_failed", { template: message.template, error: "email_not_configured" });
      return { delivered: false };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(message.idempotencyKey ? { "idempotency-key": message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        to: message.to,
        subject: message.subject,
        text: message.text,
        template: message.template,
        idempotencyKey: message.idempotencyKey,
      }),
    });
    if (!response.ok) logger.warn("mail_failed", { template: message.template, status: response.status });
    return { delivered: response.ok };
  }
}

class RecordedMailProvider implements MailProvider {
  readonly name = "recorded";
  private readonly transport = new HttpMailProvider();

  async send(message: MailMessage) {
    const delivered = (await this.transport.send(message)).delivered;
    await prisma.mailDelivery.create({
      data: {
        organizationId: message.organizationId ?? null,
        toAddress: message.to,
        template: message.template,
        subject: message.subject,
        delivered,
      },
    });
    return { delivered };
  }
}

let provider: MailProvider = new RecordedMailProvider();

export function setMailProvider(next: MailProvider | null) {
  provider = next ?? new RecordedMailProvider();
}

export async function sendMail(message: MailMessage) {
  try {
    return await provider.send(message);
  } catch (error) {
    logger.warn("mail_failed", { template: message.template, error: error instanceof Error ? error.message : "mail" });
    return { delivered: false };
  }
}
