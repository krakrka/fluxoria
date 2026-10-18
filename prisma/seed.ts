import { loadEnvFile } from "node:process";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient, type DocumentKind, type DocumentStatus, type InvoiceStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { buildSimplePdf } from "../services/pdf";
import { compareInvoiceAndOrder } from "../services/matching";
import { FIELD_LABELS } from "../lib/field-labels";
import { findValidSirens, isValidSiret, vatFromSiren } from "../lib/siren";

loadEnvFile(path.resolve(process.cwd(), ".env"));

const prisma = new PrismaClient();
const password = "Fluxora-Demo-2026";
const root = path.resolve(process.cwd(), "storage");

  const sirens = findValidSirens(12);
  const siretFor = (siren: string) => {
    for (let nic = 0; nic < 100000; nic += 1) {
      const siret = `${siren}${String(nic).padStart(5, "0")}`;
      if (isValidSiret(siret)) return siret;
    }
    return null;
  };

async function main() {
  const emails = [
    "owner@atlas-industrie.test",
    "admin@atlas-industrie.test",
    "member@atlas-industrie.test",
    "accountant@atlas-industrie.test",
    "owner@brume-conseil.test",
    "manager@atlas-industrie.test",
    "employee@atlas-industrie.test",
  ];
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.organization.deleteMany({ where: { name: { in: ["Atlas Industrie", "Brume Conseil"] } } });

  const passwordHash = await bcrypt.hash(password, 12);
  const atlas = await prisma.organization.create({
    data: {
      name: "Atlas Industrie",
      siren: sirens[0],
      siret: siretFor(sirens[0]),
      vatNumber: vatFromSiren(sirens[0]),
      addressLine: "18 rue des Forges",
      postalCode: "69007",
      city: "Lyon",
      sector: "Metallurgie",
      companySize: "20-49",
      plan: "PRO",
      retentionDays: 365,
      settings: { minutesPerDocument: 12, hourlyCostCents: 3500 },
    },
  });

  const users = await Promise.all(
    [
      ["Camille Laurent", emails[0], "OWNER"],
      ["Hugo Bernard", emails[1], "ADMIN"],
      ["Lea Martin", emails[2], "MEMBER"],
      ["Pierre Dubois", emails[3], "ACCOUNTANT"],
      ["Inès Morel", emails[5], "MANAGER"],
      ["Noah Petit", emails[6], "MEMBER"],
    ].map(([name, email, role]) =>
      prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          emailVerifiedAt: new Date(),
          consentAt: new Date(),
          consentVersion: "2026-10-01",
          memberships: { create: { organizationId: atlas.id, role: role as "OWNER" } },
        },
      }),
    ),
  );
  await prisma.user.updateMany({
    where: { id: { in: users.map((user) => user.id) } },
    data: { activeOrganizationId: atlas.id },
  });
  const owner = users[0];

  const supplierNames = ["Aciers Durand", "Energie Rhone", "Bureau Plus", "Transport Loire", "Outillage Martin"];
  const suppliers = await Promise.all(
    supplierNames.map((name, index) =>
      prisma.supplier.create({
        data: {
          organizationId: atlas.id,
          name,
          siren: sirens[index + 1],
          vatNumber: vatFromSiren(sirens[index + 1]),
          email: `contact@${name.toLowerCase().replace(/ /g, "")}.test`,
          category: ["Matieres premieres", "Energie", "Fournitures", "Logistique", "Equipement"][index],
        },
      }),
    ),
  );

  const customerNames = ["Atelier Nord", "BatiSud", "Cuisine Pro Lyon", "Commune de Val-Fleuri", "Clinique des Cedres"];
  const customers = await Promise.all(
    customerNames.map((name, index) =>
      prisma.customer.create({
        data: {
          organizationId: atlas.id,
          name,
          siren: sirens[index + 6],
          email: `factures@${name.toLowerCase().replace(/ /g, "")}.test`,
        },
      }),
    ),
  );

  const orders = [];
  for (let index = 0; index < 10; index += 1) {
    const supplier = suppliers[index % suppliers.length];
    const quantity = 4 + index;
    const unit = 80 + index * 15;
    const amountHt = quantity * unit;
    const amountTtc = Math.round(amountHt * 1.2);
    const number = `BC-2026-${String(142 + index).padStart(4, "0")}`;
    const document = await createDocument({
      organizationId: atlas.id,
      userId: owner.id,
      filename: `${number}.pdf`,
      status: "VALIDATED",
      kind: "PURCHASE_ORDER",
      confidence: 0.95,
      lines: [`Bon de commande ${number}`, supplier.name, `Total TTC ${amountTtc}.00 EUR`],
      fields: [
        ["invoice_number", number, 0.98],
        ["purchase_order_number", number, 0.98],
        ["supplier_name", supplier.name, 0.96],
        ["issue_date", "2026-08-12", 0.94],
        ["amount_ht", amountHt.toFixed(2), 0.95],
        ["amount_ttc", amountTtc.toFixed(2), 0.95],
        ["currency", "EUR", 0.99],
      ],
      docLines: [{ description: "Marchandise", quantity, unitPrice: unit, amountHt }],
    });
    const order = await prisma.purchaseOrder.create({
      data: {
        organizationId: atlas.id,
        documentId: document.id,
        supplierId: supplier.id,
        number,
        issuedAt: new Date("2026-08-12"),
        amountHt: amountHt.toFixed(2),
        amountTtc: amountTtc.toFixed(2),
        lines: {
          create: [{ organizationId: atlas.id, position: 0, description: "Marchandise", quantity, unitPrice: unit.toFixed(2), amountHt: amountHt.toFixed(2) }],
        },
      },
      include: { lines: true, supplier: true },
    });
    orders.push(order);
  }

  const invoicePlan: Array<{
    number: string;
    direction: "SUPPLIER" | "CUSTOMER";
    supplier?: number;
    customer?: number;
    order?: number;
    status: InvoiceStatus;
    docStatus: DocumentStatus;
    confidence: number;
    unitDelta?: number;
    qtyDelta?: number;
    supplierOverride?: string;
    amount?: number;
  }> = [
    { number: "FAC-2026-1001", direction: "SUPPLIER", supplier: 0, order: 0, status: "DUE", docStatus: "VALIDATED", confidence: 0.97 },
    { number: "FAC-2026-1002", direction: "SUPPLIER", supplier: 1, order: 1, status: "DUE", docStatus: "NEEDS_REVIEW", confidence: 0.9, unitDelta: 10 },
    { number: "FAC-2026-1003", direction: "SUPPLIER", supplier: 3, order: 2, status: "DUE", docStatus: "NEEDS_REVIEW", confidence: 0.88 },
    { number: "FAC-2026-1004", direction: "CUSTOMER", customer: 0, status: "OVERDUE", docStatus: "VALIDATED", confidence: 0.96, amount: 2400 },
    { number: "FAC-2026-1005", direction: "CUSTOMER", customer: 1, status: "PAID", docStatus: "VALIDATED", confidence: 0.97, amount: 1800 },
    { number: "FAC-2026-1006", direction: "CUSTOMER", customer: 2, status: "DUE", docStatus: "PROCESSED", confidence: 0.93, amount: 860 },
    { number: "FAC-2026-1007", direction: "CUSTOMER", customer: 3, status: "SENT", docStatus: "PROCESSED", confidence: 0.91, amount: 430 },
    { number: "FAC-2026-1008", direction: "CUSTOMER", customer: 4, status: "DRAFT", docStatus: "NEEDS_REVIEW", confidence: 0.7, amount: 2100 },
  ];

  for (let index = 0; index < 12; index += 1) {
    invoicePlan.push({
      number: `FAC-2026-${1010 + index}`,
      direction: index % 3 === 0 ? "CUSTOMER" : "SUPPLIER",
      supplier: index % 5,
      customer: index % 5,
      status: index % 4 === 0 ? "OVERDUE" : "DUE",
      docStatus: index % 5 === 0 ? "NEEDS_REVIEW" : index % 2 === 0 ? "VALIDATED" : "PROCESSED",
      confidence: index % 5 === 0 ? 0.66 : 0.94,
      amount: 400 + index * 320,
    });
  }

  for (const plan of invoicePlan) {
    const order = plan.order !== undefined ? orders[plan.order] : undefined;
    const supplier = plan.supplier !== undefined ? suppliers[plan.supplier] : order?.supplier;
    const customer = plan.customer !== undefined ? customers[plan.customer] : customers[0];
    const quantity = order ? Number(order.lines[0].quantity) + (plan.qtyDelta ?? 0) : 2;
    const unit = order ? Number(order.lines[0].unitPrice) + (plan.unitDelta ?? 0) : (plan.amount ?? 500) / 1.2 / 2;
    const amountHt = plan.amount ? plan.amount / 1.2 : quantity * unit;
    const amountVat = amountHt * 0.2;
    const amountTtc = amountHt + amountVat;
    const due = plan.status === "OVERDUE" ? "2026-08-15" : plan.status === "DRAFT" ? "2026-10-28" : "2026-10-20";
    const partyName = plan.direction === "CUSTOMER" ? customer.name : plan.supplierOverride ?? supplier?.name ?? "Fournisseur";
    const low = plan.confidence < 0.8;
    const document = await createDocument({
      organizationId: atlas.id,
      userId: owner.id,
      filename: `${plan.number}.pdf`,
      status: plan.docStatus,
      kind: plan.direction === "CUSTOMER" ? "CUSTOMER_INVOICE" : "SUPPLIER_INVOICE",
      confidence: plan.confidence,
      warnings: low ? ["Le montant TTC est peu lisible."] : [],
      lines: [`Facture ${plan.number}`, partyName, `TTC ${amountTtc.toFixed(2)} EUR`, `Echeance ${due}`],
      fields: [
        ["invoice_number", plan.number, 0.97],
        ["issue_date", "2026-09-02", 0.94],
        ["due_date", due, low ? 0.61 : 0.9],
        ["supplier_name", plan.direction === "CUSTOMER" ? "Atlas Industrie" : partyName, low ? 0.7 : 0.95],
        ["customer_name", plan.direction === "CUSTOMER" ? partyName : "Atlas Industrie", 0.92],
        ["siren", supplier?.siren ?? sirens[0], low ? 0.42 : 0.9],
        ["vat_number", supplier?.vatNumber ?? vatFromSiren(sirens[0]), 0.86],
        ["amount_ht", amountHt.toFixed(2), low ? 0.64 : 0.96],
        ["amount_vat", amountVat.toFixed(2), low ? 0.64 : 0.96],
        ["amount_ttc", amountTtc.toFixed(2), low ? 0.62 : 0.97],
        ["currency", "EUR", 0.99],
        ["payment_terms", "30 jours", 0.84],
        ["purchase_order_number", order?.number ?? "", order ? 0.93 : 0.4],
      ],
      docLines: [{ description: "Marchandise", quantity, unitPrice: unit, amountHt }],
    });

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: atlas.id,
        documentId: document.id,
        direction: plan.direction,
        supplierId: plan.direction === "SUPPLIER" ? supplier?.id : null,
        customerId: plan.direction === "CUSTOMER" ? customer.id : null,
        number: plan.number,
        issuedAt: new Date("2026-09-02"),
        dueAt: new Date(due),
        amountHt: amountHt.toFixed(2),
        amountVat: amountVat.toFixed(2),
        amountTtc: amountTtc.toFixed(2),
        paymentTerms: "30 jours",
        purchaseOrderNumber: order?.number,
        status: plan.status,
        category: partyName === "Aciers Durand" ? "Matieres premieres" : null,
      },
    });

    if (order && plan.direction === "SUPPLIER") {
      const result = compareInvoiceAndOrder(
        {
          name: partyName,
          purchaseOrderNumber: order.number,
          totalTtcCents: Math.round(amountTtc * 100),
          lines: [{ description: "Marchandise", quantity, unitPriceCents: Math.round(unit * 100) }],
        },
        {
          name: order.supplier?.name ?? "",
          purchaseOrderNumber: order.number,
          totalTtcCents: Math.round(Number(order.amountTtc) * 100),
          lines: order.lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPriceCents: Math.round(Number(line.unitPrice) * 100),
          })),
        },
      );
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          matchStatus: result.status,
          matchedPurchaseOrderId: order.id,
          reconciled: result.status === "MATCH",
        },
      });
    }

    if (plan.status === "PAID") {
      await prisma.payment.create({
        data: {
          organizationId: atlas.id,
          invoiceId: invoice.id,
          amount: amountTtc.toFixed(2),
          paidAt: new Date("2026-09-20"),
          method: "VIREMENT",
          reference: plan.number,
        },
      });
    }
  }

  const anomaly = await createDocument({
    organizationId: atlas.id,
    userId: users[1].id,
    filename: "facture-anomalie.pdf",
    status: "NEEDS_REVIEW",
    kind: "SUPPLIER_INVOICE",
    confidence: 0.62,
    lines: ["Facture avec un total incoherent"],
    warnings: ["Le montant TTC ne correspond pas au HT et a la TVA."],
    fields: [
      ["invoice_number", "FAC-ANOM-2026", 0.96],
      ["issue_date", "2026-09-12", 0.94],
      ["due_date", "2026-10-12", 0.9],
      ["supplier_name", "Aciers Durand", 0.93],
      ["customer_name", "Atlas Industrie", 0.9],
      ["supplier_siren", sirens[1] ?? sirens[0], 0.88],
      ["supplier_vat_number", vatFromSiren(sirens[1] ?? sirens[0]), 0.86],
      ["amount_ht", "1000.00", 0.9],
      ["amount_vat", "200.00", 0.9],
      ["amount_ttc", "1480.00", 0.54],
      ["currency", "EUR", 0.99],
      ["purchase_order_number", "BC-2026-0142", 0.8],
      ["payment_terms", "30 jours", 0.8],
    ],
    docLines: [{ description: "Acier", quantity: 4, unitPrice: 250, amountHt: 1000 }],
  });
  await prisma.auditLog.create({
    data: {
      organizationId: atlas.id,
      userId: users[1].id,
      action: "document.processed",
      entityType: "Document",
      entityId: anomaly.id,
      documentId: anomaly.id,
      newValue: { status: "NEEDS_REVIEW", kind: "SUPPLIER_INVOICE", confidence: 0.62 },
    },
  });

  const rejected = await createDocument({
    organizationId: atlas.id,
    userId: users[2].id,
    filename: "facture-rejetee.pdf",
    status: "REJECTED",
    kind: "OTHER",
    confidence: 0.31,
    lines: ["Piece rejetee : document illisible"],
    rejectionReason: "Document illisible",
    fields: [
      ["invoice_number", "ILLISIBLE", 0.22],
      ["supplier_name", "Inconnu", 0.28],
    ],
    docLines: [],
  });
  await prisma.auditLog.create({
    data: {
      organizationId: atlas.id,
      userId: users[2].id,
      action: "document.rejected",
      entityType: "Document",
      entityId: rejected.id,
      documentId: rejected.id,
      oldValue: { status: "NEEDS_REVIEW" },
      newValue: { status: "REJECTED", reason: "Document illisible" },
    },
  });

  for (const filename of ["scan-illisible.pdf", "piece-corrompue.pdf"]) {
    await createDocument({
      organizationId: atlas.id,
      userId: users[2].id,
      filename,
      status: "ERROR",
      kind: "UNKNOWN",
      confidence: null,
      lines: ["Document illisible"],
      fields: [],
      docLines: [],
      errorMessage: "Le fichier n'a pas pu etre lu. Aucune donnee n'a ete enregistree.",
    });
  }

  const highAmount = await prisma.workflow.create({
    data: {
      organizationId: atlas.id,
      name: "Montant superieur a 5 000 EUR",
      description: "Demande une validation humaine.",
      definition: {
        trigger: "DOCUMENT_PROCESSED",
        steps: [
          { type: "condition", field: "amountTtc", op: "gt", value: 5000 },
          { type: "action", action: { type: "require_review" } },
        ],
      },
      rules: {
        create: {
          organizationId: atlas.id,
          name: "Montant superieur a 5 000 EUR",
          trigger: "DOCUMENT_PROCESSED",
          conditions: { all: [{ field: "amountTtc", op: "gt", value: 5000 }] },
          actions: [{ type: "require_review", reason: "Montant superieur a 5 000 EUR" }],
        },
      },
    },
  });
  await prisma.workflow.create({
    data: {
      organizationId: atlas.id,
      name: "Fournisseur Aciers Durand",
      definition: {
        trigger: "DOCUMENT_PROCESSED",
        steps: [
          { type: "condition", field: "supplierName", op: "eq", value: "Aciers Durand" },
          { type: "action", action: { type: "set_category", category: "Matieres premieres" } },
        ],
      },
      rules: {
        create: {
          organizationId: atlas.id,
          name: "Categorie Aciers Durand",
          trigger: "DOCUMENT_PROCESSED",
          conditions: { all: [{ field: "supplierName", op: "eq", value: "Aciers Durand" }] },
          actions: [{ type: "set_category", category: "Matieres premieres" }],
          priority: 50,
        },
      },
    },
  });
  await prisma.workflow.create({
    data: {
      organizationId: atlas.id,
      name: "Facture echue",
      definition: {
        trigger: "INVOICE_OVERDUE",
        steps: [
          { type: "condition", field: "isOverdue", op: "eq", value: true },
          { type: "action", action: { type: "create_reminder_task" } },
        ],
      },
      rules: {
        create: {
          organizationId: atlas.id,
          name: "Preparer une relance",
          trigger: "INVOICE_OVERDUE",
          conditions: { all: [{ field: "isOverdue", op: "eq", value: true }] },
          actions: [{ type: "create_reminder_task" }],
        },
      },
    },
  });

  const rule = await prisma.automationRule.findFirst({ where: { workflowId: highAmount.id } });
  const reviewed = await prisma.document.findFirst({ where: { organizationId: atlas.id, status: "NEEDS_REVIEW" } });
  if (rule && reviewed) {
    await prisma.workflowExecution.create({
      data: {
        organizationId: atlas.id,
        workflowId: highAmount.id,
        ruleId: rule.id,
        documentId: reviewed.id,
        status: "COMPLETED",
        finishedAt: new Date(),
        durationMs: 12,
        result: { rule: rule.name, actions: [{ type: "require_review" }] },
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      organizationId: atlas.id,
      userId: users[3].id,
      action: "document.field_updated",
      entityType: "DocumentField",
      entityId: "seed",
      documentId: reviewed?.id,
      oldValue: { key: "amount_ttc", value: "1200.00" },
      newValue: { key: "amount_ttc", value: "1250.00" },
    },
  });
  await prisma.notification.create({
    data: {
      organizationId: atlas.id,
      title: "Factures a verifier",
      body: "Des documents extraits ont une confiance faible.",
      href: "/documents",
    },
  });

  const brume = await prisma.organization.create({
    data: { name: "Brume Conseil", city: "Nantes", plan: "STARTER", sector: "Conseil" },
  });
  await prisma.user.create({
    data: {
      name: "Ines Morel",
      email: emails[4],
      passwordHash,
      emailVerifiedAt: new Date(),
      activeOrganizationId: brume.id,
      memberships: { create: { organizationId: brume.id, role: "OWNER" } },
    },
  });
  await prisma.customer.create({ data: { organizationId: brume.id, name: "Client isole" } });

  const orphanSupplier = suppliers[2];
  const orphanInvoice = await prisma.invoice.create({
    data: {
      organizationId: atlas.id,
      supplierId: orphanSupplier.id,
      direction: "SUPPLIER",
      number: "FAC-SANS-BC",
      issuedAt: new Date("2026-09-18"),
      dueAt: new Date("2026-10-18"),
      amountHt: "500.00",
      amountVat: "100.00",
      amountTtc: "600.00",
      currency: "EUR",
      status: "DUE",
      matchStatus: "UNMATCHED",
    },
  });
  await prisma.anomaly.create({
    data: {
      organizationId: atlas.id,
      invoiceId: orphanInvoice.id,
      supplierId: orphanSupplier.id,
      type: "MISSING_PURCHASE_ORDER",
      severity: "WARNING",
      title: "Facture sans bon de commande",
      description: "Aucun bon de commande n'est associé à cette facture.",
      expectedValue: "Bon de commande",
      actualValue: "Introuvable",
      fingerprint: `MISSING_PURCHASE_ORDER:${orphanInvoice.id}`,
    },
  });
  const duplicatedSource = await prisma.invoice.findFirst({ where: { organizationId: atlas.id, number: "FAC-2026-1001" } });
  if (duplicatedSource?.supplierId) {
    const copy = await prisma.invoice.create({
      data: {
        organizationId: atlas.id,
        supplierId: duplicatedSource.supplierId,
        direction: "SUPPLIER",
        number: duplicatedSource.number,
        issuedAt: duplicatedSource.issuedAt,
        dueAt: duplicatedSource.dueAt,
        amountHt: duplicatedSource.amountHt,
        amountVat: duplicatedSource.amountVat,
        amountTtc: duplicatedSource.amountTtc,
        currency: duplicatedSource.currency,
        status: "DUE",
      },
    });
    await prisma.anomaly.create({
      data: {
        organizationId: atlas.id,
        invoiceId: copy.id,
        supplierId: duplicatedSource.supplierId,
        type: "DUPLICATE_INVOICE",
        severity: "CRITICAL",
        title: "Facture potentiellement dupliquée",
        description: "Même fournisseur et même numéro. Aucune facture n'a été supprimée.",
        expectedValue: duplicatedSource.number,
        actualValue: copy.number,
        fingerprint: `DUPLICATE_INVOICE:${duplicatedSource.supplierId}:${duplicatedSource.number}`,
      },
    });
  }
  const mismatched = await prisma.invoice.findFirst({ where: { organizationId: atlas.id, number: "FAC-2026-1002" } });
  if (mismatched) {
    await prisma.anomaly.create({
      data: {
        organizationId: atlas.id,
        invoiceId: mismatched.id,
        documentId: mismatched.documentId,
        supplierId: mismatched.supplierId,
        purchaseOrderId: mismatched.matchedPurchaseOrderId,
        type: "AMOUNT_MISMATCH",
        severity: "WARNING",
        title: "Écart de montant",
        description: "Le montant TTC sort de la tolérance du bon de commande.",
        fingerprint: `AMOUNT_MISMATCH:${mismatched.documentId ?? mismatched.id}`,
      },
    });
  }

  await prisma.organization.update({
    where: { id: atlas.id },
    data: {
      settings: {
        minutesPerDocument: 12,
        hourlyCostCents: 3500,
        autoValidateCents: 100000,
        managerApprovalCents: 500000,
        amountTolerancePercent: 1,
        amountToleranceCents: 100,
        manualMinutes: 12,
        automatedMinutes: 4,
        demo: true,
      },
    },
  });
  const defaultRules = [
    {
      name: "Factures inférieures à 1 000 €",
      trigger: "invoice.created",
      priority: 10,
      conditions: { all: [{ field: "invoice.total", op: "less_than", value: 1000 }, { field: "invoice.matchScore", op: "greater_or_equal", value: 95 }, { field: "invoice.anomalyCount", op: "equals", value: 0 }] },
      actions: [{ type: "auto_validate" }],
      step: "ACTION",
    },
    {
      name: "Approbation manager de 1 000 à 5 000 €",
      trigger: "invoice.created",
      priority: 20,
      conditions: { all: [{ field: "invoice.total", op: "greater_or_equal", value: 1000 }, { field: "invoice.total", op: "less_than", value: 5000 }] },
      actions: [{ type: "request_approval", role: "MANAGER" }],
      step: "APPROVAL",
    },
    {
      name: "Approbation propriétaire dès 5 000 €",
      trigger: "invoice.created",
      priority: 30,
      conditions: { all: [{ field: "invoice.total", op: "greater_or_equal", value: 5000 }] },
      actions: [{ type: "request_approval", role: "OWNER" }],
      step: "APPROVAL",
    },
    {
      name: "Alerte anomalie critique",
      trigger: "anomaly.created",
      priority: 40,
      conditions: { all: [{ field: "anomaly.severity", op: "equals", value: "CRITICAL" }] },
      actions: [{ type: "create_notification", title: "Anomalie critique" }],
      step: "NOTIFICATION",
    },
  ];
  for (const rule of defaultRules) {
    const workflow = await prisma.workflow.create({
      data: {
        organizationId: atlas.id,
        name: rule.name,
        definition: { trigger: rule.trigger },
        steps: { create: [{ type: "CONDITION", position: 1, config: rule.conditions }, { type: rule.step, position: 2, config: rule.actions[0] }] },
      },
    });
    await prisma.automationRule.create({
      data: {
        organizationId: atlas.id,
        workflowId: workflow.id,
        createdById: users[0].id,
        name: rule.name,
        trigger: rule.trigger,
        priority: rule.priority,
        conditions: rule.conditions,
        actions: rule.actions,
      },
    });
  }
  const autoInvoice = await prisma.invoice.create({
    data: {
      organizationId: atlas.id,
      supplierId: suppliers[0].id,
      direction: "SUPPLIER",
      number: "FAC-AUTO-700",
      issuedAt: new Date("2026-09-20"),
      dueAt: new Date("2026-10-20"),
      amountHt: "583.33",
      amountVat: "116.67",
      amountTtc: "700.00",
      status: "VALIDATED",
      autoValidated: true,
      matchStatus: "MATCH",
      reconciled: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: atlas.id,
      action: "invoice.auto_validated",
      entityType: "Invoice",
      entityId: autoInvoice.id,
      newValue: {
        rule: "Factures inférieures à 1 000 €",
        explanation: [
          "Confiance extraction : 97 %",
          "Rapprochement commande : 98 %",
          "Écart montant : 0.00 €",
          "Aucune anomalie ouverte",
          "Règle appliquée : « Factures inférieures à 1 000 € »",
        ],
      },
    },
  });
  const managerInvoice = await prisma.invoice.create({
    data: {
      organizationId: atlas.id,
      supplierId: suppliers[0].id,
      direction: "SUPPLIER",
      number: "FAC-MGR-2500",
      issuedAt: new Date("2026-09-21"),
      dueAt: new Date("2026-10-21"),
      amountHt: "2083.33",
      amountVat: "416.67",
      amountTtc: "2500.00",
      status: "DUE",
      matchStatus: "MATCH",
    },
  });
  await prisma.approval.create({
    data: {
      organizationId: atlas.id,
      invoiceId: managerInvoice.id,
      assignedToId: users.find((user) => user.email === "manager@atlas-industrie.test")?.id,
      requiredRole: "MANAGER",
      reason: "Approbation manager de 1 000 à 5 000 €",
      amountCents: 250000,
      explanation: ["Montant : 2500.00 €", "Niveau demandé : manager", "Règle appliquée : « Approbation manager de 1 000 à 5 000 € »"],
    },
  });
  const ownerInvoice = await prisma.invoice.create({
    data: {
      organizationId: atlas.id,
      supplierId: suppliers[0].id,
      direction: "SUPPLIER",
      number: "FAC-OWN-8000",
      issuedAt: new Date("2026-09-22"),
      dueAt: new Date("2026-10-22"),
      amountHt: "6666.67",
      amountVat: "1333.33",
      amountTtc: "8000.00",
      status: "DUE",
      matchStatus: "PARTIAL_MATCH",
    },
  });
  await prisma.anomaly.create({
    data: {
      organizationId: atlas.id,
      invoiceId: ownerInvoice.id,
      supplierId: suppliers[0].id,
      type: "AMOUNT_MISMATCH",
      severity: "CRITICAL",
      title: "Écart bloquant sur FAC-OWN-8000",
      description: "Le montant dépasse le seuil et une anomalie est ouverte.",
      fingerprint: `AMOUNT_MISMATCH:${ownerInvoice.id}`,
    },
  });
  await prisma.approval.create({
    data: {
      organizationId: atlas.id,
      invoiceId: ownerInvoice.id,
      assignedToId: users[0].id,
      requiredRole: "OWNER",
      reason: "Approbation propriétaire dès 5 000 €",
      amountCents: 800000,
      explanation: ["Montant : 8000.00 €", "Anomalie critique ouverte", "Niveau demandé : propriétaire"],
    },
  });

  console.log("Seed pret. Mot de passe demo:", password);
}

async function createDocument(input: {
  organizationId: string;
  userId: string;
  filename: string;
  status: DocumentStatus;
  kind: DocumentKind;
  confidence: number | null;
  lines: string[];
  fields: Array<[string, string, number]>;
  docLines: Array<{ description: string; quantity: number; unitPrice: number; amountHt: number }>;
  warnings?: string[];
  errorMessage?: string;
  rejectionReason?: string;
}) {
  const document = await prisma.document.create({
    data: {
      organizationId: input.organizationId,
      uploadedById: input.userId,
      filename: input.filename,
      mimeType: "application/pdf",
      sizeBytes: 0,
      storageKey: "pending",
      status: input.status,
      kind: input.kind,
      confidence: input.confidence,
      warnings: input.warnings ?? [],
      errorMessage: input.errorMessage,
      rejectionReason: input.rejectionReason,
      amountCents: (() => {
        const total = input.fields.find(([key]) => key === "amount_ttc")?.[1];
        if (!total || !/^[0-9]+(\.[0-9]+)?$/.test(total)) return null;
        return Math.round(Number(total) * 100);
      })(),
      processedAt: input.status === "RECEIVED" ? null : new Date(),
      processingMs: input.status === "ERROR" ? 40 : 180,
    },
  });
  const storageKey = `organizations/${input.organizationId}/documents/${document.id}/original`;
  const absolute = path.join(root, storageKey);
  const bytes = buildSimplePdf(input.lines);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  await prisma.document.update({
    where: { id: document.id },
    data: { storageKey, sizeBytes: bytes.byteLength },
  });
  if (input.fields.length > 0) {
    await prisma.documentField.createMany({
      data: input.fields.map(([key, value, confidence]) => ({
        organizationId: input.organizationId,
        documentId: document.id,
        key,
        label: FIELD_LABELS[key] ?? key,
        value,
        confidence,
        source: "AI" as const,
        validated: input.status === "VALIDATED",
      })),
    });
  }
  if (input.docLines.length > 0) {
    await prisma.documentLine.createMany({
      data: input.docLines.map((line, position) => ({
        organizationId: input.organizationId,
        documentId: document.id,
        position,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toFixed(2),
        vatRate: "20.00",
        amountHt: line.amountHt.toFixed(2),
        confidence: input.confidence ?? 0,
      })),
    });
  }
  return document;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
