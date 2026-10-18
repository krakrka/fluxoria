import type { FileSourceProvider } from "@/connectors/files/types";

export const ONEDRIVE_SCOPES = ["https://graph.microsoft.com/Files.Read"] as const;

export const oneDriveProvider: FileSourceProvider = {
  id: "ONEDRIVE",
  scopes: ONEDRIVE_SCOPES,
  authorizationUrl(input) {
    const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", ONEDRIVE_SCOPES.join(" "));
    url.searchParams.set("state", input.state);
    return url.toString();
  },
  async listFiles() {
    throw new Error("Le connecteur OneDrive est prévu dans l'architecture et n'est pas encore branché. Utilisez Google Drive.");
  },
  async download() {
    throw new Error("Le connecteur OneDrive est prévu dans l'architecture et n'est pas encore branché.");
  },
};
