export function inboxAddressFor(organizationId: string) {
  return `factures+${organizationId.slice(-10).toLowerCase()}@inbox.fluxora.test`;
}

export function isInboxAddress(value: string) {
  return /^factures\+[a-z0-9]+@inbox\.fluxora\.test$/i.test(value.trim());
}
