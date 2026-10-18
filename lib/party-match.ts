import { normalizeName } from "@/lib/utils";

const LEGAL_FORMS = /\b(s a s|s a r l|s a|sas|sarl|eurl|sasu|sci|earl)\b/g;

export function companyKey(name: string) {
  return normalizeName(name).replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();
}

export function sameCompanyName(left: string, right: string) {
  const key = companyKey(left);
  return key.length > 0 && key === companyKey(right);
}

export type PartyIdentity = {
  id: string;
  name: string;
  siren: string | null;
  vatNumber: string | null;
};

export function matchParty(parties: PartyIdentity[], input: { name: string | null; siren: string | null; vatNumber: string | null }) {
  const siren = input.siren?.replace(/\s/g, "") || null;
  if (siren) {
    const bySiren = parties.find((party) => party.siren?.replace(/\s/g, "") === siren);
    if (bySiren) return bySiren;
  }
  const vat = input.vatNumber?.replace(/\s/g, "").toUpperCase() || null;
  if (vat) {
    const byVat = parties.find((party) => party.vatNumber?.replace(/\s/g, "").toUpperCase() === vat);
    if (byVat) return byVat;
  }
  if (input.name) {
    return parties.find((party) => sameCompanyName(party.name, input.name ?? "")) ?? null;
  }
  return null;
}
