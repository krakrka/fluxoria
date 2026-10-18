import { amountsWithinTolerance, quantitiesWithinTolerance } from "@/lib/match-tolerances";
import { normalizeName } from "@/lib/utils";

export type MatchLine = {
  description: string;
  quantity: number;
  unitPriceCents: number;
};

export type MatchParty = {
  name: string;
  purchaseOrderNumber: string | null;
  totalTtcCents: number;
  currency?: string;
  lines: MatchLine[];
};

export type MatchCheck = {
  key: "supplier" | "currency" | "amount" | "quantities" | "lines";
  label: string;
  state: "ok" | "warning" | "fail";
  detail: string;
};

export type FieldDiff = {
  field: string;
  label: string;
  invoice: string;
  order: string;
  equal: boolean;
};

export type MatchResult = {
  status: "MATCH" | "PARTIAL_MATCH" | "MISMATCH";
  diffs: FieldDiff[];
  score: number;
  checks: MatchCheck[];
};

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

function sameMoney(left: number, right: number, tolerances?: { amountTolerancePercent: number; amountToleranceCents: number }) {
  return amountsWithinTolerance(left, right, tolerances);
}

export function compareInvoiceAndOrder(
  invoice: MatchParty,
  order: MatchParty,
  tolerances?: { amountTolerancePercent: number; amountToleranceCents: number },
): MatchResult {
  const diffs: FieldDiff[] = [
    {
      field: "supplier",
      label: "Fournisseur",
      invoice: invoice.name,
      order: order.name,
      equal: normalizeName(invoice.name) === normalizeName(order.name) && invoice.name.length > 0,
    },
    {
      field: "purchase_order_number",
      label: "Numéro de commande",
      invoice: invoice.purchaseOrderNumber ?? "—",
      order: order.purchaseOrderNumber ?? "—",
      equal:
        Boolean(invoice.purchaseOrderNumber) &&
        invoice.purchaseOrderNumber?.toLowerCase() === order.purchaseOrderNumber?.toLowerCase(),
    },
    {
      field: "total",
      label: "Montant TTC",
      invoice: money(invoice.totalTtcCents),
      order: money(order.totalTtcCents),
      equal: sameMoney(invoice.totalTtcCents, order.totalTtcCents, tolerances),
    },
  ];

  const pairCount = Math.max(invoice.lines.length, order.lines.length);
  for (let index = 0; index < pairCount; index += 1) {
    const left = invoice.lines[index];
    const right = order.lines[index];
    diffs.push({
      field: `line_${index + 1}_description`,
      label: `Ligne ${index + 1} — libellé`,
      invoice: left?.description ?? "—",
      order: right?.description ?? "—",
      equal: Boolean(left && right) && normalizeName(left.description) === normalizeName(right.description),
    });
    diffs.push({
      field: `line_${index + 1}_quantity`,
      label: `Ligne ${index + 1} — quantité`,
      invoice: left ? String(left.quantity) : "—",
      order: right ? String(right.quantity) : "—",
      equal: Boolean(left && right) && quantitiesWithinTolerance(left.quantity, right.quantity),
    });
    diffs.push({
      field: `line_${index + 1}_price`,
      label: `Ligne ${index + 1} — prix unitaire`,
      invoice: left ? money(left.unitPriceCents) : "—",
      order: right ? money(right.unitPriceCents) : "—",
      equal: Boolean(left && right) && sameMoney(left.unitPriceCents, right.unitPriceCents, tolerances),
    });
  }

  const invoiceCurrency = (invoice.currency ?? "EUR").toUpperCase();
  const orderCurrency = (order.currency ?? "EUR").toUpperCase();
  diffs.splice(2, 0, {
    field: "currency",
    label: "Devise",
    invoice: invoiceCurrency,
    order: orderCurrency,
    equal: invoiceCurrency === orderCurrency,
  });

  const supplierOk = diffs.find((diff) => diff.field === "supplier")?.equal === true;
  const numberOk = diffs.find((diff) => diff.field === "purchase_order_number")?.equal === true;
  const currencyOk = diffs.find((diff) => diff.field === "currency")?.equal === true;
  const totalOk = diffs.find((diff) => diff.field === "total")?.equal === true;
  const lineDiffs = diffs.filter((diff) => diff.field.startsWith("line_"));
  const quantityOk = lineDiffs.filter((diff) => diff.field.endsWith("_quantity")).every((diff) => diff.equal);
  const linesOk = lineDiffs.every((diff) => diff.equal);
  const amountDelta = order.totalTtcCents === 0 ? 0 : ((invoice.totalTtcCents - order.totalTtcCents) / order.totalTtcCents) * 100;

  const checks: MatchCheck[] = [
    { key: "supplier", label: "Fournisseur", state: supplierOk ? "ok" : "fail", detail: supplierOk ? "Identique" : "Différent" },
    { key: "currency", label: "Devise", state: currencyOk ? "ok" : "fail", detail: currencyOk ? invoiceCurrency : `${invoiceCurrency} / ${orderCurrency}` },
    {
      key: "amount",
      label: "Montant",
      state: totalOk ? "ok" : "warning",
      detail: totalOk ? "Dans la tolérance" : `${amountDelta > 0 ? "+" : ""}${amountDelta.toFixed(1)} %`,
    },
    { key: "quantities", label: "Quantités", state: quantityOk ? "ok" : "fail", detail: quantityOk ? "Identiques" : "Écart" },
    { key: "lines", label: "Lignes", state: linesOk ? "ok" : "warning", detail: linesOk ? "Identiques" : "Écart" },
  ];
  const weights = checks.map((check) => (check.state === "ok" ? 1 : check.state === "warning" ? 0.5 : 0));
  const score = Math.round((weights.reduce<number>((sum, value) => sum + value, 0) / checks.length) * 100);

  let status: MatchResult["status"] = "MISMATCH";
  if (supplierOk && numberOk && currencyOk && totalOk && linesOk) status = "MATCH";
  else if (supplierOk && numberOk && (!totalOk || !linesOk || !currencyOk)) status = "PARTIAL_MATCH";

  return { status, diffs, score, checks };
}
