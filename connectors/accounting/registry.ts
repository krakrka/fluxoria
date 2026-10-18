import { cegidConnector, ebpConnector, sageConnector } from "@/connectors/accounting/placeholders";
import { createPennylaneConnector } from "@/connectors/accounting/pennylane";
import type { AccountingConnector } from "@/connectors/accounting/types";

const providers: Record<AccountingConnector["id"], AccountingConnector> = {
  PENNYLANE: createPennylaneConnector(),
  SAGE: sageConnector,
  CEGID: cegidConnector,
  EBP: ebpConnector,
};

export function getAccountingConnector(id: AccountingConnector["id"], connector?: AccountingConnector) {
  return connector ?? providers[id];
}
