import "server-only";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { isDemoOrganization } from "@/lib/roi";
import { installDefaultInvoiceRules } from "@/services/automation";
import { writeAudit } from "@/server/audit";
import { assertCanAddAutomation, assertCanInvite, lockOrganization, startTrial } from "@/services/billing";
import { sendMail } from "@/services/mail";
import { publicAppOrigin } from "@/lib/app-origin";
import { recordProductEvent } from "@/services/product-events";
import { resolveActiveMembership } from "@/lib/active-organization";
import { isValidSiren, isValidSiret } from "@/lib/siren";
import { evaluateRules, type RuleAction, type RuleDefinition } from "@/workflows/engine";

const CONSENT_VERSION = "2026-10-01";

export async function registerOrganization(input: {
  name: string;
  email: string;
  password: string;
  organizationName: string;
  siren?: string;
}) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("Un compte existe déjà avec cet email.");
  if (input.siren && !isValidSiren(input.siren)) throw new Error("Le SIREN est invalide.");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const organization = await prisma.organization.create({
    data: {
      name: input.organizationName,
      siren: input.siren || null,
      settings: {
        minutesPerDocument: 12,
        hourlyCostCents: 3500,
        autoValidateCents: 100000,
        managerApprovalCents: 500000,
        amountTolerancePercent: 1,
        amountToleranceCents: 100,
        manualMinutes: 12,
        automatedMinutes: 4,
      },
      members: {
        create: {
          role: "OWNER",
          user: {
            create: {
              name: input.name,
              email,
              passwordHash,
              consentAt: new Date(),
              consentVersion: CONSENT_VERSION,
            },
          },
        },
      },
    },
    include: { members: true },
  });

  const userId = organization.members[0]?.userId;
  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { activeOrganizationId: organization.id },
    });
    await startTrial(organization.id);
    await createEmailVerification(userId);
    await sendMail({
      to: email,
      template: "onboarding",
      subject: "Bienvenue sur Fluxora",
      text: "Votre organisation est créée. Déposez une première facture, puis choisissez un plan avant la fin de l'essai.",
      organizationId: organization.id,
    });
    await installDefaultInvoiceRules(organization.id, userId);
    await recordProductEvent({ organizationId: organization.id, userId, name: "signup" });
    await recordProductEvent({ organizationId: organization.id, userId, name: "onboarding_started" });
  }

  await writeAudit({
    organizationId: organization.id,
    userId,
    action: "organization.created",
    entityType: "Organization",
    entityId: organization.id,
    newValue: { name: organization.name },
  });

  return organization;
}

export async function createEmailVerification(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, activeOrganizationId: true } });
  if (user) {
    const origin = publicAppOrigin();
    await sendMail({
      to: user.email,
      template: "verification",
      subject: "Confirmez votre adresse Fluxora",
      text: `Confirmez votre adresse : ${origin}/verify-email?token=${token}`,
      organizationId: user.activeOrganizationId,
    });
  }
  return token;
}

export async function verifyEmail(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new Error("Le lien de vérification est invalide ou expiré.");
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function switchActiveOrganization(userId: string, organizationId: string) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    select: { organizationId: true, role: true },
  });
  const selected = resolveActiveMembership(memberships, organizationId);
  if (!selected || selected.organizationId !== organizationId) {
    throw new Error("Vous n'appartenez pas à cette organisation.");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { activeOrganizationId: selected.organizationId },
  });
  return selected;
}

export async function createPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    },
  });
  const origin = publicAppOrigin();
  await sendMail({
    to: user.email,
    template: "password_reset",
    subject: "Réinitialisation du mot de passe Fluxora",
    text: `Choisissez un nouveau mot de passe : ${origin}/reset-password?token=${token}`,
    organizationId: user.activeOrganizationId,
  });
  return { token, email: user.email };
}

export async function resetPassword(token: string, password: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new Error("Le lien de réinitialisation est invalide ou expiré.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
}

export async function inviteMember(input: {
  organizationId: string;
  actorId: string;
  actorRole: string;
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "MANAGER" | "ACCOUNTANT" | "MEMBER";
}) {
  if (input.role === "ADMIN" && input.actorRole !== "OWNER") {
    throw new Error("Seul le propriétaire peut inviter un admin.");
  }
  const organization = await prisma.organization.findFirst({ where: { id: input.organizationId, deletedAt: null } });
  if (!organization) throw new Error("Organisation introuvable.");
  const email = input.email.toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const invited = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    await assertCanInvite(input.organizationId, tx);
    let user = await tx.user.findUnique({ where: { email } });
    const createdUser = !user;
    if (!user) {
      user = await tx.user.create({
        data: { name: input.name, email, passwordHash, activeOrganizationId: input.organizationId },
      });
    } else if (!user.activeOrganizationId) {
      await tx.user.update({ where: { id: user.id }, data: { activeOrganizationId: input.organizationId } });
    }
    try {
      const membership = await tx.organizationMember.create({
        data: { organizationId: input.organizationId, userId: user.id, role: input.role },
      });
      return { membership, createdUser, userId: user.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new Error("Cet utilisateur appartient déjà à l'organisation.");
      }
      throw error;
    }
  }, { timeout: 20_000 });
  const membership = invited.membership;
  if (invited.createdUser) await createEmailVerification(invited.userId);
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "member.invited",
    entityType: "OrganizationMember",
    entityId: membership.id,
    newValue: { email, role: input.role },
  });
  const origin = publicAppOrigin();
  await sendMail({
    to: email,
    template: "invitation",
    subject: `Invitation à ${organization.name}`,
    text: `${input.name} vous a ouvert un accès à ${organization.name}. Connectez-vous : ${origin}/login. Le mot de passe vous est communiqué par l'administrateur, il n'est pas envoyé par email.`,
    organizationId: input.organizationId,
  });
  return membership;
}

export async function updateOrganization(input: {
  organizationId: string;
  userId: string;
  data: {
    name: string;
    siren?: string;
    siret?: string;
    vatNumber?: string;
    addressLine?: string;
    postalCode?: string;
    city?: string;
    sector?: string;
    companySize?: string;
    retentionDays: number;
  };
}) {
  if (input.data.siren && !isValidSiren(input.data.siren)) throw new Error("SIREN invalide.");
  if (input.data.siret && !isValidSiret(input.data.siret)) throw new Error("SIRET invalide.");
  const current = await prisma.organization.findFirst({ where: { id: input.organizationId } });
  if (!current) throw new Error("Organisation introuvable.");
  if (isDemoOrganization(current.settings) && (input.data.name !== current.name || (input.data.siren || null) !== (current.siren || null))) {
    throw new Error("Le mode démo conserve le nom et le SIREN de l'organisation.");
  }
  const updated = await prisma.organization.update({
    where: { id: current.id },
    data: {
      name: input.data.name,
      siren: input.data.siren || null,
      siret: input.data.siret || null,
      vatNumber: input.data.vatNumber || null,
      addressLine: input.data.addressLine || null,
      postalCode: input.data.postalCode || null,
      city: input.data.city || null,
      sector: input.data.sector || null,
      companySize: input.data.companySize || null,
      retentionDays: input.data.retentionDays,
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "organization.updated",
    entityType: "Organization",
    entityId: updated.id,
    oldValue: { name: current.name, retentionDays: current.retentionDays },
    newValue: { name: updated.name, retentionDays: updated.retentionDays },
  });
  return updated;
}

export async function exportOrganization(organizationId: string) {
  const [organization, members, documents, invoices, orders, customers, suppliers, auditLogs] = await Promise.all([
    prisma.organization.findFirst({ where: { id: organizationId } }),
    prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true, createdAt: true } } },
    }),
    prisma.document.findMany({ where: { organizationId }, include: { fields: true, lines: true } }),
    prisma.invoice.findMany({ where: { organizationId } }),
    prisma.purchaseOrder.findMany({ where: { organizationId }, include: { lines: true } }),
    prisma.customer.findMany({ where: { organizationId } }),
    prisma.supplier.findMany({ where: { organizationId } }),
    prisma.auditLog.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 1000 }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    notice: "Export des données de l'organisation. Ce fichier ne constitue pas à lui seul une conformité RGPD.",
    organization,
    members,
    documents,
    invoices,
    orders,
    customers,
    suppliers,
    auditLogs,
  };
}

export async function deleteOrganization(organizationId: string) {
  // Les journaux d'audit restent sur l'organisation fantôme pendant la rétention.
  // Les documents, factures et membres sont retirés. Le compte Stripe n'est pas effacé ici.
  await prisma.approval.deleteMany({ where: { organizationId } });
  await prisma.reminder.deleteMany({ where: { organizationId } });
  await prisma.payment.deleteMany({ where: { organizationId } });
  await prisma.anomaly.deleteMany({ where: { organizationId } });
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.purchaseOrder.deleteMany({ where: { organizationId } });
  await prisma.document.deleteMany({ where: { organizationId } });
  await prisma.supplier.deleteMany({ where: { organizationId } });
  await prisma.customer.deleteMany({ where: { organizationId } });
  await prisma.supportRequest.deleteMany({ where: { organizationId } });
  await prisma.productEvent.deleteMany({ where: { organizationId } });
  await prisma.notification.deleteMany({ where: { organizationId } });
  await prisma.job.deleteMany({ where: { organizationId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId } });
  await prisma.user.updateMany({ where: { activeOrganizationId: organizationId }, data: { activeOrganizationId: null } });
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      deletedAt: new Date(),
      name: "Organisation supprimée",
      siren: null,
      siret: null,
      vatNumber: null,
      addressLine: null,
      postalCode: null,
      city: null,
    },
  });
}

export async function removeMember(input: { organizationId: string; actorId: string; memberId: string }) {
  const member = await prisma.organizationMember.findFirst({
    where: { id: input.memberId, organizationId: input.organizationId },
  });
  if (!member) throw new Error("Membre introuvable.");
  if (member.userId === input.actorId) throw new Error("Vous ne pouvez pas retirer votre propre accès.");
  if (member.role === "OWNER") {
    const owners = await prisma.organizationMember.count({ where: { organizationId: input.organizationId, role: "OWNER" } });
    if (owners <= 1) throw new Error("Le dernier propriétaire ne peut pas être retiré.");
  }
  await prisma.organizationMember.delete({ where: { id: member.id } });
  await prisma.user.updateMany({
    where: { id: member.userId, activeOrganizationId: input.organizationId },
    data: { activeOrganizationId: null },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "member.removed",
    entityType: "OrganizationMember",
    entityId: member.id,
    newValue: { userId: member.userId, role: member.role },
  });
}

export async function deleteAccount(userId: string) {
  const owned = await prisma.organizationMember.findMany({ where: { userId, role: "OWNER" }, select: { organizationId: true } });
  if (owned.length > 0) {
    throw new Error("Supprimez ou transférez vos organisations avant de supprimer le compte.");
  }
  await prisma.organizationMember.deleteMany({ where: { userId } });
  await prisma.user.update({
    where: { id: userId },
    data: {
      email: `deleted+${userId}@invalid.fluxora`,
      name: "Compte supprimé",
      passwordHash: "deleted",
      activeOrganizationId: null,
      emailVerifiedAt: null,
      sessionVersion: { increment: 1 },
    },
  });
}

const numericOperators = new Set(["gt", "gte", "lt", "lte", "greater_than", "greater_or_equal", "less_than", "less_or_equal"]);

function conditionValue(op: string, value: string) {
  const numeric = Number(value);
  return numericOperators.has(op) && Number.isFinite(numeric) ? numeric : value;
}

export async function createRule(input: {
  organizationId: string;
  userId: string;
  name: string;
  trigger: string;
  conditions: Array<{ field: string; op: string; value: string }>;
  action: string;
  actionValue?: string;
}) {
  const organization = await prisma.organization.findFirst({ where: { id: input.organizationId, deletedAt: null } });
  if (!organization) throw new Error("Organisation introuvable.");
  const conditions = input.conditions.map((condition) => ({
    field: condition.field,
    op: condition.op,
    value: conditionValue(condition.op, condition.value),
  }));
  const action: RuleAction =
    input.action === "set_category"
      ? { type: "set_category", category: input.actionValue || "À classer" }
      : input.action === "require_review"
        ? { type: "require_review", reason: input.actionValue || input.name }
        : input.action === "mark_reconciled"
          ? { type: "mark_reconciled" }
          : input.action === "auto_validate"
            ? { type: "auto_validate" }
            : input.action === "request_approval"
              ? { type: "request_approval", role: input.actionValue === "OWNER" ? "OWNER" : "MANAGER" }
              : input.action === "create_notification"
                ? { type: "create_notification", title: input.actionValue || input.name }
                : { type: "create_reminder_task" };

  const rule = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    await assertCanAddAutomation(input.organizationId, 1, tx);
    const workflow = await tx.workflow.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      description: "Règle simple. Le même format pourra alimenter un builder visuel.",
      definition: {
        trigger: input.trigger,
        steps: [
          ...conditions.map((condition) => ({ type: "condition", ...condition })),
          { type: "action", action },
        ],
      },
      steps: {
        create: [
          ...conditions.map((condition, index) => ({ type: "CONDITION", position: index + 1, config: condition })),
          {
            type: action.type === "request_approval" ? "APPROVAL" : action.type === "create_notification" ? "NOTIFICATION" : "ACTION",
            position: conditions.length + 1,
            config: action,
          },
        ],
      },
    },
    });
    return tx.automationRule.create({
      data: {
        organizationId: input.organizationId,
        workflowId: workflow.id,
        createdById: input.userId,
        name: input.name,
        trigger: input.trigger,
        conditions: { all: conditions },
        actions: [action],
      },
    });
  }, { timeout: 20_000 });
  await recordProductEvent({ organizationId: input.organizationId, userId: input.userId, name: "automation_created" });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "rule.created",
    entityType: "AutomationRule",
    entityId: rule.id,
    newValue: { name: rule.name, trigger: rule.trigger },
  });
  return rule;
}

export async function duplicateRule(input: { organizationId: string; userId: string; ruleId: string }) {
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    await assertCanAddAutomation(input.organizationId, 1, tx);
    const rule = await tx.automationRule.findFirst({
      where: { id: input.ruleId, organizationId: input.organizationId },
    });
    if (!rule) return null;
    return tx.automationRule.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.userId,
        name: `${rule.name} (copie)`,
        trigger: rule.trigger,
        conditions: rule.conditions ?? {},
        actions: rule.actions ?? [],
        priority: rule.priority,
        enabled: false,
      },
    });
  }, { timeout: 20_000 });
}

export async function setRuleEnabled(input: {
  organizationId: string;
  userId: string;
  ruleId: string;
  enabled: boolean;
}) {
  const rule = await prisma.automationRule.findFirst({
    where: { id: input.ruleId, organizationId: input.organizationId },
  });
  if (!rule) throw new Error("Règle introuvable.");
  await prisma.automationRule.update({ where: { id: rule.id }, data: { enabled: input.enabled } });
  if (rule.workflowId) {
    await prisma.workflow.update({ where: { id: rule.workflowId }, data: { enabled: input.enabled } });
  }
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "rule.updated",
    entityType: "AutomationRule",
    entityId: rule.id,
    oldValue: { enabled: rule.enabled },
    newValue: { enabled: input.enabled },
  });
}

export async function refreshOverdue(organizationId: string) {
  const overdue = await prisma.invoice.findMany({
    where: {
      organizationId,
      direction: "CUSTOMER",
      status: { in: ["SENT", "DUE", "OVERDUE"] },
      dueAt: { lt: new Date() },
    },
  });
  const rules = await prisma.automationRule.findMany({
    where: { organizationId, enabled: true, trigger: "INVOICE_OVERDUE" },
  });
  const definitions: RuleDefinition[] = rules.flatMap((rule) => {
    const conditions = rule.conditions as RuleDefinition["conditions"];
    const actions = rule.actions as RuleAction[];
    if (!conditions?.all || !Array.isArray(actions)) return [];
    return [{ id: rule.id, name: rule.name, trigger: rule.trigger, conditions, actions }];
  });

  for (const invoice of overdue) {
    if (invoice.status !== "OVERDUE") {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "OVERDUE" } });
      await writeAudit({
        organizationId,
        action: "invoice.marked_overdue",
        entityType: "Invoice",
        entityId: invoice.id,
        documentId: invoice.documentId,
        oldValue: { status: invoice.status },
        newValue: { status: "OVERDUE" },
      });
    }
    const matched = evaluateRules(definitions, "INVOICE_OVERDUE", {
      amountTtc: Number(invoice.amountTtc),
      isOverdue: true,
      customerName: "",
      supplierName: "",
    });
    for (const rule of matched) {
      const existing = await prisma.workflowExecution.findFirst({
        where: { organizationId, ruleId: rule.id, documentId: invoice.documentId ?? undefined, status: "COMPLETED" },
      });
      if (existing) continue;
      await prisma.workflowExecution.create({
        data: {
          organizationId,
          ruleId: rule.id,
          documentId: invoice.documentId,
          status: "COMPLETED",
          finishedAt: new Date(),
          durationMs: 1,
          result: { rule: rule.name },
        },
      });
      await prisma.notification.create({
        data: {
          organizationId,
          title: "Facture échue",
          body: `${invoice.number} — ${rule.name}`,
          href: `/invoices/${invoice.id}`,
        },
      });
    }
  }
}

export async function prepareReminder(input: { organizationId: string; userId: string; invoiceId: string }) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.organizationId },
    include: { customer: true },
  });
  if (!invoice) throw new Error("Facture introuvable.");
  const late = invoice.dueAt && invoice.dueAt.getTime() < Date.now();
  const reminder = await prisma.reminder.create({
    data: {
      organizationId: input.organizationId,
      invoiceId: invoice.id,
      status: "DRAFT",
      subject: `Relance facture ${invoice.number}`,
      body: [
        `Bonjour ${invoice.customer?.name ?? ""},`,
        "",
        `La facture ${invoice.number} d'un montant de ${invoice.amountTtc.toString()} ${invoice.currency} est ${late ? "échue" : "à échéance"}.`,
        "Merci de nous indiquer la date de règlement prévue.",
        "",
        "Cet email n'a pas été envoyé. Une confirmation explicite est requise.",
      ].join("\n"),
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "reminder.drafted",
    entityType: "Reminder",
    entityId: reminder.id,
    documentId: invoice.documentId,
    newValue: { subject: reminder.subject, status: "DRAFT" },
  });
  return reminder;
}

export async function confirmReminder(input: { organizationId: string; userId: string; reminderId: string }) {
  const reminder = await prisma.reminder.findFirst({
    where: { id: input.reminderId, organizationId: input.organizationId },
  });
  if (!reminder) throw new Error("Relance introuvable.");
  const deliveryEnabled = process.env.EMAIL_DELIVERY_ENABLED === "true";
  await prisma.reminder.update({
    where: { id: reminder.id },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });
  await prisma.notification.create({
    data: {
      organizationId: input.organizationId,
      title: deliveryEnabled ? "Relance confirmée" : "Relance confirmée, envoi désactivé",
      body: deliveryEnabled
        ? "La relance est confirmée. L'envoi au client reste manuel dans cette version."
        : "Aucun email client n'a été envoyé. EMAIL_DELIVERY_ENABLED est désactivé.",
      href: `/invoices/${reminder.invoiceId}`,
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "reminder.confirmed",
    entityType: "Reminder",
    entityId: reminder.id,
    oldValue: { status: reminder.status },
    newValue: { status: "CONFIRMED", emailSent: false },
  });
}

export async function markInvoicePaid(input: { organizationId: string; userId: string; invoiceId: string }) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.organizationId },
  });
  if (!invoice) throw new Error("Facture introuvable.");
  await prisma.payment.create({
    data: {
      organizationId: input.organizationId,
      invoiceId: invoice.id,
      amount: invoice.amountTtc,
      paidAt: new Date(),
      method: "MANUAL",
    },
  });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "invoice.marked_paid",
    entityType: "Invoice",
    entityId: invoice.id,
    documentId: invoice.documentId,
    oldValue: { status: invoice.status },
    newValue: { status: "PAID" },
  });
}

export async function createParty(input: {
  organizationId: string;
  userId: string;
  kind: "supplier" | "customer";
  name: string;
  siren?: string;
  vatNumber?: string;
  email?: string;
  category?: string;
}) {
  if (input.siren && !isValidSiren(input.siren) && !isValidSiret(input.siren)) {
    throw new Error("SIREN ou SIRET invalide.");
  }
  if (input.kind === "supplier") {
    const supplier = await prisma.supplier.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        siren: input.siren || null,
        vatNumber: input.vatNumber || null,
        email: input.email || null,
        category: input.category || null,
      },
    });
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "supplier.created",
      entityType: "Supplier",
      entityId: supplier.id,
      newValue: { name: supplier.name },
    });
    return supplier;
  }
  const customer = await prisma.customer.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      siren: input.siren || null,
      vatNumber: input.vatNumber || null,
      email: input.email || null,
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "customer.created",
    entityType: "Customer",
    entityId: customer.id,
    newValue: { name: customer.name },
  });
  return customer;
}

export async function purgeExpiredDocuments(organizationId: string) {
  const organization = await prisma.organization.findFirst({ where: { id: organizationId } });
  if (!organization) return 0;
  const cutoff = new Date(Date.now() - organization.retentionDays * 86_400_000);
  const expired = await prisma.document.findMany({
    where: { organizationId, deletedAt: null, createdAt: { lt: cutoff } },
    select: { id: true, storageKey: true },
  });
  if (expired.length === 0) return 0;
  const { assertTenantStorageKey, getStorage } = await import("@/services/storage");
  const storage = getStorage();
  for (const document of expired) {
    try {
      assertTenantStorageKey(document.storageKey, organizationId);
      await storage.delete(document.storageKey);
    } catch {
      // A pending or foreign key is not deleted from storage.
    }
  }
  await prisma.document.updateMany({
    where: { id: { in: expired.map((document) => document.id) } },
    data: { deletedAt: new Date() },
  });
  return expired.length;
}
