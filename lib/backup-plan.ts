const RESERVED = new Set(["postgres", "template0", "template1"]);

export function databaseName(databaseUrl: string) {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL illisible.");
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, "").split("/")[0] ?? "");
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Nom de base illisible.");
  return name;
}

export function assertIsolatedRestore(sourceName: string, targetName: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(targetName)) throw new Error("Nom de base cible illisible.");
  if (RESERVED.has(targetName) || targetName === sourceName) {
    throw new Error("La restauration ne peut pas viser la base active.");
  }
  if (!targetName.endsWith("_restore")) {
    throw new Error("La base cible doit se terminer par _restore.");
  }
}

export function backupFailurePayload(step: "dump" | "checksum" | "encrypt" | "copy" | "restore-check") {
  return { alert: "backup_failed", step };
}
