export type EmailAttachment = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

export type InboundEmail = {
  externalId: string;
  from: string;
  recipient: string;
  receivedAt: Date;
  subject: string | null;
  attachments: EmailAttachment[];
};

export type EmailToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  accountId: string;
};

export interface EmailProvider {
  readonly id: "FLUXORA_INBOX" | "GMAIL" | "OUTLOOK";
  readonly scopes: readonly string[];
  authorizationUrl?(input: { clientId: string; redirectUri: string; state: string }): string;
  exchangeCode?(input: { code: string; clientId: string; clientSecret: string; redirectUri: string }): Promise<EmailToken>;
  listNewMessages(input: { accessToken: string; since?: Date | null }): Promise<InboundEmail[]>;
}
