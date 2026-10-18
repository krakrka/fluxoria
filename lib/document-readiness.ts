import { isInvoiceKind } from "@/lib/document-types";
import { parseAmountToCents } from "@/lib/money";

type FieldRef = { key: string; value: string | null };

function valueOf(fields: FieldRef[], key: string) {
  return fields.find((field) => field.key === key)?.value ?? null;
}

export function documentReadyToValidate(input: { kind: string; fields: FieldRef[] }) {
  if (input.kind === "UNKNOWN") {
    return { ok: false as const, message: "Le type du document n'est pas identifié." };
  }
  const number = valueOf(input.fields, "invoice_number") || valueOf(input.fields, "purchase_order_number");
  if (!number) {
    return { ok: false as const, message: "Le numéro du document est manquant." };
  }
  if (!valueOf(input.fields, "issue_date")) {
    return { ok: false as const, message: "La date du document est manquante." };
  }
  if (isInvoiceKind(input.kind)) {
    const party = valueOf(input.fields, "supplier_name") || valueOf(input.fields, "customer_name");
    if (!party) return { ok: false as const, message: "Le fournisseur ou le client est manquant." };
    const total = parseAmountToCents(valueOf(input.fields, "amount_ttc"));
    if (total === null) return { ok: false as const, message: "Le montant TTC n'est pas lisible." };
    const ht = parseAmountToCents(valueOf(input.fields, "amount_ht"));
    const vat = parseAmountToCents(valueOf(input.fields, "amount_vat"));
    if (ht !== null && vat !== null && Math.abs(ht + vat - total) > 2) {
      return { ok: false as const, message: "Le HT, la TVA et le TTC ne concordent pas." };
    }
  }
  return { ok: true as const };
}
