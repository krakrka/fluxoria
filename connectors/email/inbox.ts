import type { EmailProvider, InboundEmail } from "@/connectors/email/types";

const SUBJECT_LIMIT = 180;

export const fluxoraInboxProvider: EmailProvider = {
  id: "FLUXORA_INBOX",
  scopes: ["inbound:attachments"],
  async listNewMessages() {
    return [];
  },
};

export function normalizeForwardedEmail(input: {
  externalId: string;
  from: string;
  recipient: string;
  subject?: string | null;
  receivedAt?: Date;
  attachments: InboundEmail["attachments"];
}): InboundEmail {
  return {
    externalId: input.externalId,
    from: input.from.trim().slice(0, 200),
    recipient: input.recipient.trim().slice(0, 200),
    receivedAt: input.receivedAt ?? new Date(),
    subject: input.subject?.replace(/\s+/g, " ").trim().slice(0, SUBJECT_LIMIT) || null,
    attachments: input.attachments,
  };
}
