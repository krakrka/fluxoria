export type RemoteFile = {
  externalId: string;
  filename: string;
  mimeType: string;
};

export interface FileSourceProvider {
  readonly id: "GOOGLE_DRIVE" | "ONEDRIVE";
  readonly scopes: readonly string[];
  authorizationUrl?(input: { clientId: string; redirectUri: string; state: string }): string;
  listFiles(input: { accessToken: string }): Promise<RemoteFile[]>;
  download(input: { accessToken: string; externalId: string }): Promise<{ filename: string; mimeType: string; bytes: Buffer }>;
}
