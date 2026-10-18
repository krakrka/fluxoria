import type { EmailProvider } from "@/connectors/email/types";

export const OUTLOOK_SCOPES = ["https://graph.microsoft.com/Mail.Read"] as const;

export const outlookProvider: EmailProvider = {
  id: "OUTLOOK",
  scopes: OUTLOOK_SCOPES,
  authorizationUrl(input) {
    const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OUTLOOK_SCOPES.join(" "));
    url.searchParams.set("state", input.state);
    return url.toString();
  },
  async listNewMessages() {
    throw new Error("Le connecteur Outlook est prévu dans l'architecture et n'est pas encore branché. Utilisez la boîte Fluxora ou Gmail.");
  },
};
