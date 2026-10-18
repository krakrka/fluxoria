import path from "path";
import { createFileProbeJournal, createProbeIdentity, evaluateProbeConfig, formatProbeFailure, formatProbeReport, journalConfirmsProbe, ProbeFailure, runStorageProbe } from "../lib/s3-live-check";
import { createS3Client } from "../services/s3";

const decision = evaluateProbeConfig(process.env);
if (!decision.ok) {
  console.log(decision.reason);
  console.log("Aucun appel réseau. S3 n'est pas validé.");
  process.exit(2);
}

const identity = createProbeIdentity();
const journal = createFileProbeJournal(path.join("storage", "probe-journal"));
journal.record({ id: identity.id, key: identity.key, state: "non démarré", issues: [] });
console.log(`Identifiant : ${identity.id}`);
console.log(`Clé : ${identity.key}`);
console.log("État : non démarré");
console.log(`Journal : storage/probe-journal/${identity.id}.json`);

const client = createS3Client(decision.target);

runStorageProbe(client, { identity, journal })
  .then((report) => {
    for (const line of formatProbeReport(report)) console.log(line);
    if (report.residual || !journalConfirmsProbe(path.join("storage", "probe-journal"), report)) {
      console.log("Le journal relu ne confirme pas cet état. Ne pas conclure depuis la sortie seule.");
      process.exit(1);
    }
  })
  .catch((error: unknown) => {
    if (error instanceof ProbeFailure) {
      for (const line of formatProbeFailure(error)) console.error(line);
      process.exit(1);
    }
    console.error("Probe S3 échoué.");
    console.error(`Identifiant : ${identity.id}`);
    console.error(`Clé : ${identity.key}`);
    process.exit(1);
  });
