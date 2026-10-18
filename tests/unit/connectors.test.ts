import { describe, expect, it } from "vitest";
import { createGmailProvider } from "@/connectors/email/gmail";
import { normalizeForwardedEmail } from "@/connectors/email/inbox";
import { outlookProvider } from "@/connectors/email/outlook";
import { createGoogleDriveProvider } from "@/connectors/files/google-drive";
import { oneDriveProvider } from "@/connectors/files/onedrive";
import { createPennylaneConnector, pennylaneFixtureFetch } from "@/connectors/accounting/pennylane";
import { sageConnector } from "@/connectors/accounting/placeholders";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { previewCsv } from "@/services/csv-import";
import { findValidSirens, vatFromSiren } from "@/lib/siren";
import { unzip, zipStored } from "@/lib/zip";

describe("connector boundaries", () => {
  it("keeps only the attachment when reading a Gmail message", async () => {
    const secret = "SECRET-BODY-SHOULD-NOT-LEAK";
    const pdf = Buffer.from("%PDF-1.4\n");
    const provider = createGmailProvider(async (input) => {
      const url = String(input);
      if (url.includes("/messages?")) return Response.json({ messages: [{ id: "m1" }] });
      if (url.includes("/attachments/")) return Response.json({ data: pdf.toString("base64url") });
      return Response.json({
        id: "m1",
        internalDate: "1710000000000",
        payload: {
          headers: [
            { name: "From", value: "fournisseur@exemple.fr" },
            { name: "Subject", value: "Facture" },
          ],
          parts: [
            { mimeType: "text/plain", filename: "", body: { data: Buffer.from(secret).toString("base64url") } },
            { mimeType: "application/pdf", filename: "facture.pdf", body: { attachmentId: "a1" } },
          ],
        },
      });
    });
    const [message] = await provider.listNewMessages({ accessToken: "token" });
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe("facture.pdf");
    expect(JSON.stringify(message)).not.toContain(secret);
    expect(message.subject).toBe("Facture");
  });

  it("truncates a forwarded subject and never accepts a body field", () => {
    const message = normalizeForwardedEmail({
      externalId: "1",
      from: "a@b.fr",
      recipient: "factures+abc@inbox.fluxora.test",
      subject: "x".repeat(400),
      attachments: [],
    });
    expect(message.subject?.length).toBe(180);
    expect("body" in message).toBe(false);
  });

  it("leaves Outlook, OneDrive and Sage unplugged", async () => {
    await expect(outlookProvider.listNewMessages({ accessToken: "x" })).rejects.toThrow(/Outlook/);
    await expect(oneDriveProvider.listFiles({ accessToken: "x" })).rejects.toThrow(/OneDrive/);
    await expect(sageConnector.listSuppliers("x")).rejects.toThrow(/Sage/);
  });

  it("reads Pennylane suppliers and invoices through the connector", async () => {
    const connector = createPennylaneConnector(pennylaneFixtureFetch());
    const suppliers = await connector.listSuppliers("fixture");
    const invoices = await connector.listInvoices("fixture");
    expect(suppliers[0].name).toBe("Atelier Fixture");
    expect(invoices[0].number).toBe("PL-100");
    await expect(connector.exportInvoice("fixture", { number: "PL-100", supplierName: "Atelier Fixture", amountTtc: "10.00", currency: "EUR" })).resolves.toEqual({ externalId: "exported-1" });
  });

  it("round-trips encrypted tokens", () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "fluxora-test-secret-value";
    const cipher = encryptSecret("pennylane-token");
    expect(cipher).not.toContain("pennylane-token");
    expect(decryptSecret(cipher)).toBe("pennylane-token");
  });

  it("rejects a bad SIREN in the CSV preview and keeps a valid row", () => {
    const siren = findValidSirens(1)[0];
    const preview = previewCsv("suppliers", `nom,siren,tva\nMauvaise,123,FR00\nBonne,${siren},${vatFromSiren(siren)}`);
    expect(preview.rows[0].message).toMatch(/SIREN/);
    expect(preview.rows[1].status).toBe("ok");
  });

  it("extracts a stored zip entry", () => {
    const pdf = Buffer.from("%PDF-1.4\n");
    const archive = zipStored([{ name: "docs/facture.pdf", bytes: pdf }]);
    const entries = unzip(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("facture.pdf");
    expect(entries[0].bytes.equals(pdf)).toBe(true);
  });

  it("downloads a Drive file through the file-source interface", async () => {
    const pdf = Buffer.from("%PDF-1.4\n");
    const provider = createGoogleDriveProvider(async (input) => {
      const url = String(input);
      if (url.includes("alt=media")) return new Response(pdf);
      if (url.includes("/files/f1")) return Response.json({ name: "facture.pdf", mimeType: "application/pdf" });
      return Response.json({ files: [{ id: "f1", name: "facture.pdf", mimeType: "application/pdf" }] });
    });
    const files = await provider.listFiles({ accessToken: "token" });
    const downloaded = await provider.download({ accessToken: "token", externalId: files[0].externalId });
    expect(downloaded.bytes.equals(pdf)).toBe(true);
  });
});
