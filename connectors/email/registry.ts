import { createGmailProvider } from "@/connectors/email/gmail";
import { fluxoraInboxProvider } from "@/connectors/email/inbox";
import { outlookProvider } from "@/connectors/email/outlook";
import type { EmailProvider } from "@/connectors/email/types";

const providers: Record<EmailProvider["id"], EmailProvider> = {
  FLUXORA_INBOX: fluxoraInboxProvider,
  GMAIL: createGmailProvider(),
  OUTLOOK: outlookProvider,
};

export function getEmailProvider(id: EmailProvider["id"]) {
  return providers[id];
}
