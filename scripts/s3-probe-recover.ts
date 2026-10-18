import path from "path";
import { beginProbeRecovery, formatProbeRecovery, recoverStoredProbe } from "../lib/s3-live-check";
import { createS3Client } from "../services/s3";

const id = process.argv[2] ?? "";
if (process.argv.length !== 3) {
  console.log("Indiquer uniquement l'identifiant du probe.");
  console.log("Aucun appel réseau. S3 n'est pas validé.");
  process.exit(2);
}

const started = beginProbeRecovery(process.env, id, path.join("storage", "probe-journal"), (target) => createS3Client(target));
if (!started.ok) {
  console.log(started.reason);
  console.log("Aucun appel réseau. S3 n'est pas validé.");
  process.exit(2);
}
if (started.action === "none") {
  console.log(started.reason);
  console.log(`Identifiant : ${started.record.id}`);
  console.log(`Clé : ${started.record.key}`);
  console.log("Aucun appel réseau. S3 n'est pas validé.");
  process.exit(0);
}

recoverStoredProbe(started.client, path.join("storage", "probe-journal"), id)
  .then((result) => {
    for (const line of formatProbeRecovery(result)) console.log(line);
    if (!result.confirmed || !result.journalUpdated) process.exit(1);
  })
  .catch(() => {
    console.error("Reprise du probe refusée.");
    console.error(`Identifiant : ${id}`);
    console.error("Suppression non confirmée. Un objet peut rester. S3 n'est pas validé.");
    process.exit(1);
  });
