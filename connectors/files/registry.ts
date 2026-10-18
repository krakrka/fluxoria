import { createGoogleDriveProvider } from "@/connectors/files/google-drive";
import { oneDriveProvider } from "@/connectors/files/onedrive";
import type { FileSourceProvider } from "@/connectors/files/types";

const providers: Record<FileSourceProvider["id"], FileSourceProvider> = {
  GOOGLE_DRIVE: createGoogleDriveProvider(),
  ONEDRIVE: oneDriveProvider,
};

export function getFileSourceProvider(id: FileSourceProvider["id"]) {
  return providers[id];
}
