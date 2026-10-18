export type AccountingSupplier = {
  externalId: string;
  name: string;
  siren: string | null;
  vatNumber: string | null;
};

export type AccountingInvoice = {
  externalId: string;
  number: string;
  supplierName: string;
  supplierSiren: string | null;
  amountTtc: string;
  currency: string;
  issuedAt: string | null;
};

export type AccountingExport = {
  number: string;
  supplierName: string | null;
  amountTtc: string;
  currency: string;
};

export interface AccountingConnector {
  readonly id: "PENNYLANE" | "SAGE" | "CEGID" | "EBP";
  listSuppliers(token: string): Promise<AccountingSupplier[]>;
  listInvoices(token: string): Promise<AccountingInvoice[]>;
  exportInvoice(token: string, invoice: AccountingExport): Promise<{ externalId: string }>;
}
