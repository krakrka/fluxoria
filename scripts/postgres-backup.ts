import { assertIsolatedRestore, backupFailurePayload, databaseName } from "../lib/backup-plan";

if (process.argv.includes("--restore")) {
  console.error("Ce script ne restaure pas la base. Suivre docs/production-backups.md vers une base dont le nom se termine par _restore.");
  console.error(JSON.stringify(backupFailurePayload("restore-check")));
  process.exit(1);
}

const sourceUrl = process.env.DATABASE_URL?.trim();
if (!sourceUrl) {
  console.log("DATABASE_URL absente. Aucun dump ni restauration n'est lancé.");
  console.log("La cible autorisée se termine par _restore et ne peut pas être la base active.");
  console.log("BACKUP_CONFIGURED reste vide.");
  process.exit(0);
}
let source = "";
try {
  source = databaseName(sourceUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : "DATABASE_URL illisible.");
  process.exit(1);
}

try {
  assertIsolatedRestore(source, `${source}_restore`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Plan de restauration refusé.");
  process.exit(1);
}

console.log(`Plan de sauvegarde. Base source : ${source}. Aucun dump ni restauration n'est lancé.`);
console.log("1. pg_dump custom vers un fichier hors du dépôt.");
console.log("2. sha256sum du dump, puis chiffrement age ou GPG, puis suppression du fichier clair.");
console.log("3. Copier seulement le fichier chiffré hors du serveur, dans un stockage distinct du bucket des documents.");
console.log(`4. Restaurer plus tard dans ${source}_restore, jamais dans ${source}.`);
console.log("5. prisma migrate status sur cette base isolée, puis comparer les comptes métier.");
console.log("BACKUP_CONFIGURED reste vide. L'alerte d'échec ne contient que l'étape : " + JSON.stringify(backupFailurePayload("dump")));
