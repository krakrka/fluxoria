import type { EmailProvider, EmailToken, InboundEmail } from "@/connectors/email/types";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"] as const;

type FetchLike = typeof fetch;

export function gmailAuthorizationUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function createGmailProvider(fetchImpl: FetchLike = fetch): EmailProvider {
  return {
    id: "GMAIL",
    scopes: GMAIL_SCOPES,
    authorizationUrl: gmailAuthorizationUrl,
    async exchangeCode(input) {
      const response = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: input.code,
          client_id: input.clientId,
          client_secret: input.clientSecret,
          redirect_uri: input.redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!response.ok) throw new Error("L'échange OAuth Gmail a échoué.");
      const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!json.access_token) throw new Error("Gmail n'a pas renvoyé de jeton.");
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : undefined,
        accountId: "gmail",
      } satisfies EmailToken;
    },
    async listNewMessages({ accessToken }) {
      const list = await gmailJson(fetchImpl, accessToken, "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=has:attachment&maxResults=10");
      const ids = Array.isArray(list.messages) ? list.messages.flatMap((item) => (item && typeof item === "object" && "id" in item && typeof item.id === "string" ? [item.id] : [])) : [];
      const messages: InboundEmail[] = [];
      for (const id of ids) {
        const message = await gmailJson(fetchImpl, accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
        messages.push(await toInbound(fetchImpl, accessToken, id, message));
      }
      return messages;
    },
  };
}

async function toInbound(fetchImpl: FetchLike, accessToken: string, id: string, message: Record<string, unknown>): Promise<InboundEmail> {
  const payload = asRecord(message.payload);
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const from = header(headers, "from").slice(0, 200);
  const subject = header(headers, "subject").replace(/\s+/g, " ").trim().slice(0, 180) || null;
  const parts = collectParts(payload);
  const attachments = [];
  for (const part of parts) {
    const filename = typeof part.filename === "string" ? part.filename : "";
    if (!filename) continue;
    const body = asRecord(part.body);
    const attachmentId = typeof body.attachmentId === "string" ? body.attachmentId : "";
    if (!attachmentId) continue;
    const downloaded = await gmailJson(fetchImpl, accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${attachmentId}`);
    const data = typeof downloaded.data === "string" ? Buffer.from(downloaded.data, "base64url") : Buffer.alloc(0);
    attachments.push({
      filename,
      mimeType: typeof part.mimeType === "string" ? part.mimeType : "application/octet-stream",
      bytes: data,
    });
  }
  const internalDate = typeof message.internalDate === "string" ? Number(message.internalDate) : Date.now();
  return { externalId: id, from, recipient: "", receivedAt: new Date(internalDate), subject, attachments };
}

function collectParts(part: Record<string, unknown>): Array<Record<string, unknown>> {
  const nested = Array.isArray(part.parts) ? part.parts.flatMap((item) => (item && typeof item === "object" ? collectParts(item as Record<string, unknown>) : [])) : [];
  return [part, ...nested];
}

function header(headers: unknown[], name: string) {
  const found = headers.find((item) => item && typeof item === "object" && "name" in item && String(item.name).toLowerCase() === name);
  return found && typeof found === "object" && "value" in found && typeof found.value === "string" ? found.value : "";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function gmailJson(fetchImpl: FetchLike, accessToken: string, url: string) {
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("La lecture Gmail a échoué.");
  return (await response.json()) as Record<string, unknown>;
}
