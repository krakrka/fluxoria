import type { AccountingConnector } from "@/connectors/accounting/types";

function pending(id: AccountingConnector["id"], label: string): AccountingConnector {
  const error = () => {
    throw new Error(`Le connecteur ${label} est prévu dans l'architecture et n'est pas encore branché. Pennylane est le connecteur actif.`);
  };
  return { id, listSuppliers: async () => error(), listInvoices: async () => error(), exportInvoice: async () => error() };
}

export const sageConnector = pending("SAGE", "Sage");
export const cegidConnector = pending("CEGID", "Cegid");
export const ebpConnector = pending("EBP", "EBP");
