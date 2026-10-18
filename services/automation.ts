import "server-only";
import { randomUUID } from "crypto";
import { Prisma, type MemberRole } from "@prisma/client";
import { contextHash, executionDedupeKey } from "@/lib/automation-idempotency";
import { approvalLevelForAmount, autoValidationReasons, canAutoValidate, readAutomationSettings } from "@/lib/automation-policy";
import { prisma } from "@/server/db";
import { assertCanAddAutomation, lockOrganization } from "@/services/billing";
import { sendMail } from "@/services/mail";
import { recordProductEvent } from "@/services/product-events";
import { evaluateRules, type RuleAction, type RuleDefinition } from "@/workflows/engine";

const STALE_RUNNING_MS = 10 * 60 * 1000;

type Db = Prisma.TransactionClient | typeof prisma;

function euros(value: { toString(): string } | number) {
  const parsed = Number(value.toString().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRules(rows: Array<{ id: string; name: string; trigger: string; conditions: Prisma.JsonValue; actions: Prisma.JsonValue }>): RuleDefinition[] {
  return rows.flatMap((row) => {
    const conditions = row.conditions as RuleDefinition["conditions"];
    const actions = row.actions as RuleAction[];
    if (!conditions?.all || !Array.isArray(actions)) return [];
    return [{ id: row.id, name: row.name, trigger: row.trigger, conditions, actions }];
  });
}

type ActionResult = { skipped?: boolean; explanation?: string[] };

async function runIdempotentAction(
  db: Db,
  input: {
    organizationId: string;
    ruleId: string;
    ruleName: string;
    documentId: string | null;
    trigger: string;
    entityId: string;
    actionType: string;
    context: Record<string, string | number | boolean | null>;
    run: () => Promise<ActionResult>;
    onFailure: (message: string) => Promise<void>;
  },
) {
  const hash = contextHash(input.context);
  const dedupeKey = executionDedupeKey({
    ruleId: input.ruleId,
    trigger: input.trigger,
    entityId: input.entityId,
    actionType: input.actionType,
    contextHash: hash,
  });
  const claim = await claimExecution(db, {
    organizationId: input.organizationId,
    ruleId: input.ruleId,
    documentId: input.documentId,
    dedupeKey,
    trigger: input.trigger,
    context: input.context,
    contextHash: hash,
  });
  if (claim !== "owned") return;
  const started = Date.now();
  try {
    const result = await input.run();
    await db.workflowExecution.updateMany({
      where: { organizationId: input.organizationId, dedupeKey, status: "RUNNING" },
      data: {
        status: result.skipped ? "SKIPPED" : "COMPLETED",
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        result: { action: input.actionType, explanation: result.explanation ?? [], skipped: result.skipped ?? false, contextHash: hash },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automatisation impossible.";
    await db.workflowExecution.updateMany({
      where: { organizationId: input.organizationId, dedupeKey, status: "RUNNING" },
      data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - started, error: message },
    });
    await input.onFailure(message);
  }
}

async function claimExecution(
  db: Db,
  input: {
    organizationId: string;
    ruleId: string;
    documentId: string | null;
    dedupeKey: string;
    trigger: string;
    context: Record<string, string | number | boolean | null>;
    contextHash: string;
  },
): Promise<"owned" | "duplicate" | "concurrent"> {
  const id = randomUUID();
  const inserted = await db.$executeRaw`
    INSERT INTO "WorkflowExecution" (
      "id", "organizationId", "ruleId", "documentId", "status", "startedAt", "dedupeKey", "trigger", "context", "result"
    ) VALUES (
      ${id},
      ${input.organizationId},
      ${input.ruleId},
      ${input.documentId},
      'RUNNING'::"ExecutionStatus",
      NOW(),
      ${input.dedupeKey},
      ${input.trigger},
      CAST(${JSON.stringify(input.context)} AS JSONB),
      CAST(${JSON.stringify({ contextHash: input.contextHash })} AS JSONB)
    )
    ON CONFLICT ("organizationId", "dedupeKey") DO NOTHING
  `;
  if (Number(inserted) === 1) return "owned";
  const existing = await db.workflowExecution.findFirst({
    where: { organizationId: input.organizationId, dedupeKey: input.dedupeKey },
  });
  if (!existing) return "concurrent";
  if (existing.status === "FAILED" || (existing.status === "RUNNING" && Date.now() - existing.startedAt.getTime() > STALE_RUNNING_MS)) {
    const claimed = await db.workflowExecution.updateMany({
      where: {
        id: existing.id,
        status: existing.status,
        ...(existing.status === "RUNNING" ? { startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) } } : {}),
      },
      data: { status: "RUNNING", error: null, startedAt: new Date(), finishedAt: null, context: input.context },
    });
    return claimed.count === 1 ? "owned" : "concurrent";
  }
  if (existing.status === "RUNNING") return "concurrent";
  return "duplicate";
}

export async function runInvoiceAutomation(db: Db, organizationId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      supplier: true,
      document: true,
      matchedPurchaseOrder: true,
      anomalies: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { id: true, severity: true } },
    },
  });
  if (!invoice || invoice.direction !== "SUPPLIER") return;
  const organization = await db.organization.findFirst({ where: { id: organizationId } });
  if (!organization) return;
  const settings = readAutomationSettings(organization.settings);
  const total = euros(invoice.amountTtc);
  const confidencePercent = Math.round((invoice.document?.confidence ?? 0) * 100);
  const orderTotal = invoice.matchedPurchaseOrder ? euros(invoice.matchedPurchaseOrder.amountTtc) : total;
  const matchScore = invoice.matchStatus === "MATCH" ? 100 : invoice.matchStatus === "PARTIAL_MATCH" ? 80 : invoice.matchedPurchaseOrderId ? 40 : 0;
  const context = {
    "invoice.total": total,
    "invoice.currency": invoice.currency,
    "invoice.supplier": invoice.supplier?.name ?? "",
    "invoice.matchScore": matchScore,
    "invoice.hasPurchaseOrder": Boolean(invoice.matchedPurchaseOrderId),
    "invoice.anomalyCount": invoice.anomalies.length,
    "invoice.confidence": confidencePercent,
    "invoice.status": invoice.status,
    amountTtc: total,
  };
  const rules = asRules(
    await db.automationRule.findMany({
      where: { organizationId, enabled: true, trigger: "invoice.created" },
      orderBy: { priority: "asc" },
    }),
  );
  const matched = evaluateRules(rules, "invoice.created", context);
  for (const rule of matched) {
    for (const action of rule.actions) {
      await runIdempotentAction(db, {
        organizationId,
        ruleId: rule.id,
        ruleName: rule.name,
        documentId: invoice.documentId,
        trigger: "invoice.created",
        entityId: invoice.id,
        actionType: action.type,
        context,
        run: () => executeInvoiceAction(db, {
          organizationId,
          invoice,
          action,
          settings,
          totalCents: Math.round(total * 100),
          matchScore,
          confidencePercent,
          anomalyCount: invoice.anomalies.length,
          amountDeltaCents: Math.round((total - orderTotal) * 100),
          ruleName: rule.name,
        }),
        onFailure: async () => {
          await db.notification.create({
            data: {
              organizationId,
              title: "Échec d'automatisation",
              body: `La règle « ${rule.name} » n'a pas pu s'exécuter pour ${invoice.number}.`,
              href: `/invoices/${invoice.id}`,
            },
          });
        },
      });
    }
  }
}

async function executeInvoiceAction(
  db: Db,
  input: {
    organizationId: string;
    invoice: { id: string; number: string; documentId: string | null; status: string; autoValidated: boolean };
    action: RuleAction;
    settings: ReturnType<typeof readAutomationSettings>;
    totalCents: number;
    matchScore: number;
    confidencePercent: number;
    anomalyCount: number;
    amountDeltaCents: number;
    ruleName: string;
  },
) {
  if (input.action.type === "auto_validate") {
    const allowed = canAutoValidate({
      totalCents: input.totalCents,
      matchScore: input.matchScore,
      anomalyCount: input.anomalyCount,
      confidencePercent: input.confidencePercent,
      settings: input.settings,
    });
    if (!allowed || input.invoice.status === "VALIDATED" || input.invoice.status === "PAID" || input.invoice.autoValidated) {
      return { skipped: true, explanation: ["Les conditions de sécurité de l'auto-validation ne sont pas réunies."] };
    }
    const explanation = autoValidationReasons(input);
    await db.invoice.update({
      where: { id: input.invoice.id },
      data: { status: "VALIDATED", autoValidated: true, reconciled: true },
    });
    await recordProductEvent({ organizationId: input.organizationId, name: "invoice_validated" });
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: "invoice.auto_validated",
        entityType: "Invoice",
        entityId: input.invoice.id,
        documentId: input.invoice.documentId,
        newValue: { explanation, rule: input.ruleName },
      },
    });
    await db.notification.create({
      data: {
        organizationId: input.organizationId,
        title: "Facture validée automatiquement",
        body: `${input.invoice.number} a été validée par la règle « ${input.ruleName} ».`,
        href: `/invoices/${input.invoice.id}`,
      },
    });
    return { explanation };
  }

  if (input.action.type === "request_approval") {
    const existing = await db.approval.findFirst({
      where: { organizationId: input.organizationId, invoiceId: input.invoice.id, status: "PENDING" },
    });
    if (existing) return { skipped: true, explanation: ["Une approbation est déjà en attente."] };
    const level = input.action.role ?? (approvalLevelForAmount(input.totalCents, input.settings) === "OWNER" ? "OWNER" : "MANAGER");
    const requiredRole: MemberRole = level === "OWNER" ? "OWNER" : "MANAGER";
    const members = await db.organizationMember.findMany({ where: { organizationId: input.organizationId } });
    const assignee = members.find((member) => member.role === requiredRole) ?? members.find((member) => member.role === "OWNER");
    const explanation = [
      `Montant : ${(input.totalCents / 100).toFixed(2)} €`,
      `Niveau demandé : ${requiredRole === "OWNER" ? "propriétaire" : "manager"}`,
      `Règle appliquée : « ${input.ruleName} »`,
    ];
    await db.approval.create({
      data: {
        organizationId: input.organizationId,
        invoiceId: input.invoice.id,
        documentId: input.invoice.documentId,
        assignedToId: assignee?.userId,
        requiredRole,
        reason: input.ruleName,
        amountCents: input.totalCents,
        explanation: explanation as unknown as Prisma.InputJsonValue,
      },
    });
    await recordProductEvent({ organizationId: input.organizationId, userId: assignee?.userId, name: "approval_created" });
    if (assignee?.userId) {
      const assigneeUser = await prisma.user.findUnique({ where: { id: assignee.userId }, select: { email: true } });
      if (assigneeUser) {
        await sendMail({
          to: assigneeUser.email,
          template: "approval",
          subject: "Approbation en attente",
          text: `La facture ${input.invoice.number} attend une décision.`,
          organizationId: input.organizationId,
        });
      }
    }
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: "approval.requested",
        entityType: "Invoice",
        entityId: input.invoice.id,
        documentId: input.invoice.documentId,
        newValue: { role: requiredRole, rule: input.ruleName },
      },
    });
    await db.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: assignee?.userId,
        title: "Approbation demandée",
        body: `${input.invoice.number} attend une décision (${requiredRole === "OWNER" ? "propriétaire" : "manager"}).`,
        href: "/approvals",
      },
    });
    return { explanation };
  }

  if (input.action.type === "create_notification") {
    await db.notification.create({
      data: {
        organizationId: input.organizationId,
        title: input.action.title ?? "Notification Fluxora",
        body: input.action.body ?? input.ruleName,
        href: `/invoices/${input.invoice.id}`,
      },
    });
    return { explanation: [input.action.title ?? "Notification créée"] };
  }

  if (input.action.type === "create_anomaly") {
    await db.anomaly.create({
      data: {
        organizationId: input.organizationId,
        invoiceId: input.invoice.id,
        documentId: input.invoice.documentId,
        type: "MISSING_REQUIRED_FIELD",
        severity: "WARNING",
        title: input.action.title ?? "Anomalie créée par une règle",
        description: input.ruleName,
        fingerprint: `RULE:${input.ruleName}:${input.invoice.id}`,
      },
    });
    return { explanation: [input.action.title ?? "Anomalie créée"] };
  }

  if (input.action.type === "send_email" || input.action.type === "export") {
    return { skipped: true, explanation: ["Ce canal n'est pas encore actif."] };
  }

  return { skipped: true, explanation: ["Action non exécutée par le moteur de facture."] };
}

export async function decideApproval(input: {
  organizationId: string;
  userId: string;
  role: string;
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  comment?: string;
}) {
  const approval = await prisma.approval.findFirst({
    where: { id: input.approvalId, organizationId: input.organizationId },
    include: { invoice: true },
  });
  if (!approval || approval.status !== "PENDING") throw new Error("Approbation introuvable.");
  const allowed =
    input.role === "OWNER" ||
    input.role === "ADMIN" ||
    (approval.requiredRole === "MANAGER" && input.role === "MANAGER");
  if (!allowed) throw new Error("Action non autorisée pour ce rôle.");
  if (input.decision === "REJECTED" && !input.comment?.trim()) throw new Error("Un commentaire est obligatoire pour rejeter.");
  await prisma.approval.update({
    where: { id: approval.id },
    data: {
      status: input.decision,
      decidedAt: new Date(),
      decidedById: input.userId,
      comment: input.comment?.trim() || null,
    },
  });
  if (approval.invoiceId) {
    await prisma.invoice.updateMany({
      where: { id: approval.invoiceId, organizationId: input.organizationId },
      data: input.decision === "APPROVED" ? { status: "VALIDATED", reconciled: true } : { status: "REJECTED" },
    });
  }
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.decision === "APPROVED" ? "approval.approved" : "approval.rejected",
      entityType: "Approval",
      entityId: approval.id,
      documentId: approval.documentId,
      newValue: { decision: input.decision, comment: input.comment ?? null, invoiceId: approval.invoiceId },
    },
  });
  if (input.decision === "APPROVED" && approval.invoiceId) {
    await recordProductEvent({ organizationId: input.organizationId, userId: input.userId, name: "invoice_validated" });
  }
  await recordProductEvent({ organizationId: input.organizationId, userId: input.userId, name: "approval_completed" });
  await prisma.notification.create({
    data: {
      organizationId: input.organizationId,
      title: input.decision === "APPROVED" ? "Approbation accordée" : "Approbation refusée",
      body: approval.invoice ? approval.invoice.number : "Demande traitée",
      href: `/approvals/${approval.id}`,
    },
  });
}

export async function runAnomalyAutomation(
  db: Db,
  organizationId: string,
  anomaly: { id: string; severity: string; type: string; invoiceId: string | null },
) {
  const rules = asRules(
    await db.automationRule.findMany({
      where: { organizationId, enabled: true, trigger: "anomaly.created" },
      orderBy: { priority: "asc" },
    }),
  );
  const context = { "anomaly.severity": anomaly.severity, "anomaly.type": anomaly.type };
  const matched = evaluateRules(rules, "anomaly.created", context);
  let notified = false;
  for (const rule of matched) {
    for (const action of rule.actions) {
      await runIdempotentAction(db, {
        organizationId,
        ruleId: rule.id,
        ruleName: rule.name,
        documentId: null,
        trigger: "anomaly.created",
        entityId: anomaly.id,
        actionType: action.type,
        context,
        run: async () => {
          if (action.type !== "create_notification") return { skipped: true, explanation: ["Action d'anomalie non exécutée."] };
          await db.notification.create({
            data: {
              organizationId,
              title: action.title ?? "Anomalie critique",
              body: action.body ?? "Une anomalie critique demande une décision.",
              href: anomaly.invoiceId ? `/invoices/${anomaly.invoiceId}` : "/anomalies",
            },
          });
          notified = true;
          return { explanation: [action.title ?? "Notification créée"] };
        },
        onFailure: async () => {
          await db.notification.create({
            data: {
              organizationId,
              title: "Échec d'automatisation",
              body: `La règle « ${rule.name} » n'a pas pu s'exécuter.`,
              href: anomaly.invoiceId ? `/invoices/${anomaly.invoiceId}` : "/anomalies",
            },
          });
        },
      });
    }
  }
  return notified;
}

export async function installDefaultInvoiceRules(organizationId: string, userId?: string) {
  const installed = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const existing = await tx.automationRule.count({ where: { organizationId, trigger: "invoice.created" } });
    if (existing > 0) return false;
    await assertCanAddAutomation(organizationId, DEFAULT_INVOICE_RULES.length, tx);
    for (const rule of DEFAULT_INVOICE_RULES) {
      const workflow = await tx.workflow.create({
        data: {
          organizationId,
          name: rule.name,
          definition: { trigger: rule.trigger },
          steps: {
            create: [
              { type: "CONDITION", position: 1, config: rule.conditions },
              { type: rule.actions[0].type === "request_approval" ? "APPROVAL" : "ACTION", position: 2, config: rule.actions[0] },
            ],
          },
        },
      });
      await tx.automationRule.create({
        data: {
          organizationId,
          workflowId: workflow.id,
          createdById: userId,
          name: rule.name,
          trigger: rule.trigger,
          priority: rule.priority,
          conditions: rule.conditions,
          actions: [...rule.actions],
        },
      });
    }
    return true;
  }, { timeout: 20_000 });
  if (installed) await recordProductEvent({ organizationId, userId, name: "automation_created" });
}

export const DEFAULT_INVOICE_RULES = [
  {
    name: "Factures inférieures à 1 000 €",
    trigger: "invoice.created",
    priority: 10,
    conditions: {
      all: [
        { field: "invoice.total", op: "less_than", value: 1000 },
        { field: "invoice.matchScore", op: "greater_or_equal", value: 95 },
        { field: "invoice.anomalyCount", op: "equals", value: 0 },
      ],
    },
    actions: [{ type: "auto_validate" }],
  },
  {
    name: "Approbation manager de 1 000 à 5 000 €",
    trigger: "invoice.created",
    priority: 20,
    conditions: {
      all: [
        { field: "invoice.total", op: "greater_or_equal", value: 1000 },
        { field: "invoice.total", op: "less_than", value: 5000 },
      ],
    },
    actions: [{ type: "request_approval", role: "MANAGER" }],
  },
  {
    name: "Approbation propriétaire dès 5 000 €",
    trigger: "invoice.created",
    priority: 30,
    conditions: { all: [{ field: "invoice.total", op: "greater_or_equal", value: 5000 }] },
    actions: [{ type: "request_approval", role: "OWNER" }],
  },
  {
    name: "Alerte anomalie critique",
    trigger: "anomaly.created",
    priority: 40,
    conditions: { all: [{ field: "anomaly.severity", op: "equals", value: "CRITICAL" }] },
    actions: [{ type: "create_notification", title: "Anomalie critique" }],
  },
] as const;
