import type { AccountingConnector, AccountingInvoice, AccountingSupplier } from "@/connectors/accounting/types";

const ROOT = "https://app.pennylane.com/api/external/v1";
type FetchLike = typeof fetch;

export function createPennylaneConnector(fetchImpl: FetchLike = fetch): AccountingConnector {
  return {
    id: "PENNYLANE",
    async listSuppliers(token) {
      const payload = await pennylaneJson(fetchImpl, token, `${ROOT}/suppliers`);
      return asList(payload, ["suppliers", "items"]).flatMap(readSupplier);
    },
    async listInvoices(token) {
      const payload = await pennylaneJson(fetchImpl, token, `${ROOT}/supplier_invoices`);
      return asList(payload, ["invoices", "supplier_invoices", "items"]).flatMap(readInvoice);
    },
    async exportInvoice(token, invoice) {
      const response = await fetchImpl(`${ROOT}/supplier_invoices`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          invoice_number: invoice.number,
          currency: invoice.currency,
          currency_amount: invoice.amountTtc,
          supplier_name: invoice.supplierName,
        }),
      });
      if (!response.ok) throw new Error("L'export Pennylane a été refusé.");
      const json = (await response.json()) as { id?: string | number };
      if (json.id === undefined) throw new Error("Pennylane n'a pas confirmé l'export.");
      return { externalId: String(json.id) };
    },
  };
}

export function pennylaneFixtureFetch(): FetchLike {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith("/suppliers")) {
      return json({
        suppliers: [{ id: "sup-1", name: "Atelier Fixture", reg_no: "552100554", vat_number: "FR75552100554" }],
      });
    }
    if (url.endsWith("/supplier_invoices") && (!init || !init.method || init.method === "GET")) {
      return json({
        invoices: [{ id: "inv-1", invoice_number: "PL-100", currency_amount: "120.50", currency: "EUR", date: "2026-03-01", supplier: { name: "Atelier Fixture" } }],
      });
    }
    if (init?.method === "POST") return json({ id: "exported-1" });
    return json({}, 404);
  };
}

function readSupplier(value: unknown): AccountingSupplier[] {
  const row = asRecord(value);
  const name = text(row.name);
  if (!name) return [];
  return [{ externalId: text(row.id) || name, name, siren: text(row.reg_no) || text(row.siren) || null, vatNumber: text(row.vat_number) || null }];
}

function readInvoice(value: unknown): AccountingInvoice[] {
  const row = asRecord(value);
  const number = text(row.invoice_number) || text(row.number);
  const supplier = asRecord(row.supplier);
  const supplierName = text(supplier.name) || text(row.supplier_name);
  const amount = text(row.currency_amount) || text(row.amount);
  if (!number || !supplierName || !amount) return [];
  return [{
    externalId: text(row.id) || number,
    number,
    supplierName,
    supplierSiren: text(supplier.reg_no) || null,
    amountTtc: amount,
    currency: text(row.currency) || "EUR",
    issuedAt: text(row.date) || null,
  }];
}

async function pennylaneJson(fetchImpl: FetchLike, token: string, url: string) {
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Pennylane n'a pas répondu.");
  return response.json() as Promise<unknown>;
}

function asList(payload: unknown, keys: string[]) {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
