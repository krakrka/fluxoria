import type { FileSourceProvider, RemoteFile } from "@/connectors/files/types";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"] as const;
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);

type FetchLike = typeof fetch;

export function createGoogleDriveProvider(fetchImpl: FetchLike = fetch): FileSourceProvider {
  return {
    id: "GOOGLE_DRIVE",
    scopes: DRIVE_SCOPES,
    authorizationUrl(input) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", input.clientId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", DRIVE_SCOPES.join(" "));
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", input.state);
      return url.toString();
    },
    async listFiles({ accessToken }) {
      const query = encodeURIComponent("mimeType='application/pdf' or mimeType='image/png' or mimeType='image/jpeg'");
      const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=20&fields=files(id,name,mimeType)`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("La lecture Google Drive a échoué.");
      const json = (await response.json()) as { files?: Array<{ id?: string; name?: string; mimeType?: string }> };
      return (json.files ?? []).flatMap((file): RemoteFile[] => {
        if (!file.id || !file.name || !file.mimeType || !ALLOWED.has(file.mimeType)) return [];
        return [{ externalId: file.id, filename: file.name, mimeType: file.mimeType }];
      });
    },
    async download({ accessToken, externalId }) {
      const meta = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${externalId}?fields=name,mimeType`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!meta.ok) throw new Error("Le fichier Google Drive est introuvable.");
      const file = (await meta.json()) as { name?: string; mimeType?: string };
      const media = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${externalId}?alt=media`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!media.ok) throw new Error("Le téléchargement Google Drive a échoué.");
      return {
        filename: file.name ?? "document",
        mimeType: file.mimeType ?? "application/octet-stream",
        bytes: Buffer.from(await media.arrayBuffer()),
      };
    },
  };
}
