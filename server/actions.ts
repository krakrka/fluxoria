"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValidSiren } from "@/lib/siren";
import { rateLimit } from "@/lib/rate-limit";
import {
  forgotSchema,
  inviteSchema,
  loginSchema,
  organizationSchema,
  partySchema,
  registerSchema,
  rejectSchema,
  resetSchema,
  ruleSchema,
} from "@/lib/schemas";
import { getEnv } from "@/lib/env";
import {
  confirmReminder,
  createEmailVerification,
  createParty,
  createPasswordReset,
  createRule,
  duplicateRule,
  deleteAccount,
  deleteOrganization,
  exportOrganization,
  inviteMember,
  markInvoicePaid,
  prepareReminder,
  registerOrganization,
  removeMember,
  resetPassword,
  setRuleEnabled,
  switchActiveOrganization,
  verifyEmail,
  updateOrganization,
} from "@/services/organization";
import { createCheckoutUrl, createPortalUrl, requestCancellation } from "@/services/stripe-billing";
import { createSupportRequest } from "@/services/support";
import { canEditStatus, publishIncident, resolveIncident } from "@/services/status";
import { prisma } from "@/server/db";
import { decideApproval } from "@/services/automation";
import { setAnomalyStatus } from "@/services/anomalies";
import { validateSupplierInvoice } from "@/services/invoices";
import {
  deleteDocument,
  linkInvoiceSupplier,
  linkInvoiceToOrder,
  rejectDocument,
  updateDocumentField,
  validateDocument,
} from "@/services/documents";
import { enqueueDocumentProcessing } from "@/services/queue";
import { REJECT_REASON_LABEL } from "@/lib/labels";
import { assertCan } from "@/lib/permissions";
import { signIn, signOut } from "@/server/auth";
import { requirePermission, requireTenant } from "@/server/tenant";

export type ActionState = { error?: string; message?: string; resetUrl?: string } | null;

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formText(formData, "email"),
    password: formText(formData, "password"),
  });
  if (!parsed.success) return { error: "Email ou mot de passe invalide." };
  const limit = rateLimit(`login:${parsed.data.email.toLowerCase()}`, 8, 15 * 60 * 1000);
  if (!limit.ok) return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Identifiants incorrects." };
    throw error;
  }
  return null;
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: formText(formData, "name"),
    email: formText(formData, "email"),
    password: formText(formData, "password"),
    organizationName: formText(formData, "organizationName"),
    siren: formText(formData, "siren"),
    consent: formData.get("consent"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }
  if (parsed.data.siren && !isValidSiren(parsed.data.siren)) {
    return { error: "Le SIREN indiqué est invalide." };
  }
  const limit = rateLimit(`register:${parsed.data.email.toLowerCase()}`, 5, 60 * 60 * 1000);
  if (!limit.ok) return { error: "Trop de tentatives. Réessayez plus tard." };
  try {
    await registerOrganization({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      organizationName: parsed.data.organizationName,
      siren: parsed.data.siren || undefined,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Inscription impossible." };
  }
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Compte créé, mais la connexion a échoué." };
    throw error;
  }
  return null;
}

export async function forgotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = forgotSchema.safeParse({ email: formText(formData, "email") });
  if (!parsed.success) return { error: "Email invalide." };
  const limit = rateLimit(`forgot:${parsed.data.email.toLowerCase()}`, 5, 60 * 60 * 1000);
  if (!limit.ok) return { error: "Trop de demandes. Réessayez plus tard." };
  const reset = await createPasswordReset(parsed.data.email);
  const expose = getEnv().EXPOSE_RESET_LINK === "true" && process.env.NODE_ENV !== "production";
  return {
    message: "Si un compte existe, un email de réinitialisation est préparé. Le lien s'affiche ici tant que la livraison email n'est pas activée.",
    resetUrl: expose && reset ? `/reset-password?token=${reset.token}` : undefined,
  };
}

export async function resetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetSchema.safeParse({
    token: formText(formData, "token"),
    password: formText(formData, "password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Lien ou mot de passe invalide." };
  try {
    await resetPassword(parsed.data.token, parsed.data.password);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Réinitialisation impossible." };
  }
  redirect("/login?reset=1");
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}

export async function switchOrganizationAction(formData: FormData) {
  const tenant = await requireTenant();
  await switchActiveOrganization(tenant.userId, formText(formData, "organizationId"));
  redirect("/dashboard");
}

export async function resendVerificationAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  void prev;
  void formData;
  const tenant = await requireTenant();
  const token = await createEmailVerification(tenant.userId);
  const expose = getEnv().EXPOSE_RESET_LINK === "true" && process.env.NODE_ENV !== "production";
  return {
    message: "Email de vérification préparé. Le lien s'affiche ici tant que la livraison email n'est pas activée.",
    resetUrl: expose ? `/verify-email?token=${token}` : undefined,
  };
}

export async function verifyEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetSchema.pick({ token: true }).safeParse({ token: formText(formData, "token") });
  if (!parsed.success) return { error: "Lien de vérification invalide." };
  try {
    await verifyEmail(parsed.data.token);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Vérification impossible." };
  }
  redirect("/dashboard");
}

export async function updateFieldAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("documents.update");
  const documentId = formText(formData, "documentId");
  const key = formText(formData, "key");
  const value = formText(formData, "value");
  if (!documentId || !key) return { error: "Champ incomplet." };
  try {
    await updateDocumentField({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      documentId,
      key,
      value,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Mise à jour impossible." };
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/invoices");
  return { message: "Champ corrigé. La valeur reste marquée comme saisie manuellement." };
}

export async function validateDocumentAction(formData: FormData) {
  const tenant = await requirePermission("documents.validate");
  const documentId = formText(formData, "documentId");
  try {
    await validateDocument({ organizationId: tenant.organizationId, userId: tenant.userId, documentId });
  } catch (error) {
    redirect(`/documents/${documentId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Validation impossible.")}`);
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/dashboard");
  revalidatePath("/invoices");
}

export async function rejectDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("documents.validate");
  const parsed = rejectSchema.safeParse({
    code: formText(formData, "code"),
    detail: formText(formData, "detail"),
  });
  const documentId = formText(formData, "documentId");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Indiquez un motif de rejet." };
  const label = REJECT_REASON_LABEL[parsed.data.code];
  const reason = parsed.data.detail ? `${label} — ${parsed.data.detail}` : label;
  try {
    await rejectDocument({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      documentId,
      reason,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Rejet impossible." };
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
  return { message: "Document rejeté." };
}

export async function deleteDocumentAction(formData: FormData) {
  const tenant = await requirePermission("documents.delete");
  const { assertDemoAllowsDeletion } = await import("@/services/demo");
  await assertDemoAllowsDeletion(tenant.organizationId);
  const documentId = formText(formData, "documentId");
  await deleteDocument({ organizationId: tenant.organizationId, userId: tenant.userId, documentId });
  revalidatePath("/documents");
  redirect("/documents");
}

export async function bulkDocumentsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const action = formText(formData, "bulkAction");
  const ids = formData.getAll("documentId").filter((value): value is string => typeof value === "string" && value.length > 0);
  if (ids.length === 0) return { error: "Sélectionnez au moins un document." };
  const tenant =
    action === "delete" ? await requirePermission("documents.delete") : await requirePermission("documents.validate");
  let done = 0;
  let skipped = 0;
  for (const documentId of ids) {
    try {
      if (action === "validate") {
        await validateDocument({ organizationId: tenant.organizationId, userId: tenant.userId, documentId });
      } else if (action === "reject") {
        const parsed = rejectSchema.safeParse({ code: formText(formData, "code"), detail: formText(formData, "detail") });
        if (!parsed.success) return { error: "Indiquez un motif de rejet." };
        const label = REJECT_REASON_LABEL[parsed.data.code];
        await rejectDocument({
          organizationId: tenant.organizationId,
          userId: tenant.userId,
          documentId,
          reason: parsed.data.detail ? `${label} — ${parsed.data.detail}` : label,
        });
      } else if (action === "delete") {
        const { assertDemoAllowsDeletion } = await import("@/services/demo");
        await assertDemoAllowsDeletion(tenant.organizationId);
        await deleteDocument({ organizationId: tenant.organizationId, userId: tenant.userId, documentId });
      } else {
        return { error: "Action inconnue." };
      }
      done += 1;
    } catch {
      skipped += 1;
    }
  }
  revalidatePath("/documents");
  return {
    message:
      skipped === 0
        ? `${done} document${done > 1 ? "s" : ""} traité${done > 1 ? "s" : ""}.`
        : `${ids.length} documents sélectionnés. ${done} traité${done > 1 ? "s" : ""}. ${skipped} nécessitent encore une vérification ou une autre action.`,
  };
}

export async function reprocessDocumentAction(formData: FormData) {
  const tenant = await requirePermission("documents.update");
  const documentId = formText(formData, "documentId");
  await enqueueDocumentProcessing(tenant.organizationId, documentId);
  revalidatePath(`/documents/${documentId}`);
}

export async function linkSupplierAction(formData: FormData) {
  const tenant = await requirePermission("invoices.update");
  await linkInvoiceSupplier({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    invoiceId: formText(formData, "invoiceId"),
    supplierId: formText(formData, "supplierId"),
  });
  revalidatePath(`/invoices/${formText(formData, "invoiceId")}`);
}

export async function linkOrderAction(formData: FormData) {
  const tenant = await requirePermission("invoices.update");
  const invoiceId = formText(formData, "invoiceId");
  await linkInvoiceToOrder({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    invoiceId,
    purchaseOrderId: formText(formData, "purchaseOrderId"),
  });
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function paidAction(formData: FormData) {
  const tenant = await requirePermission("invoices.update");
  const invoiceId = formText(formData, "invoiceId");
  await markInvoicePaid({ organizationId: tenant.organizationId, userId: tenant.userId, invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
}

export async function reminderDraftAction(formData: FormData) {
  const tenant = await requirePermission("reminders.manage");
  const invoiceId = formText(formData, "invoiceId");
  await prepareReminder({ organizationId: tenant.organizationId, userId: tenant.userId, invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function reminderConfirmAction(formData: FormData) {
  const tenant = await requirePermission("reminders.manage");
  await confirmReminder({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    reminderId: formText(formData, "reminderId"),
  });
  revalidatePath(`/invoices/${formText(formData, "invoiceId")}`);
}

export async function organizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("org.update");
  const parsed = organizationSchema.safeParse({
    name: formText(formData, "name"),
    siren: formText(formData, "siren"),
    siret: formText(formData, "siret"),
    vatNumber: formText(formData, "vatNumber"),
    addressLine: formText(formData, "addressLine"),
    postalCode: formText(formData, "postalCode"),
    city: formText(formData, "city"),
    sector: formText(formData, "sector"),
    companySize: formText(formData, "companySize"),
    retentionDays: formText(formData, "retentionDays"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Paramètres invalides." };
  try {
    await updateOrganization({ organizationId: tenant.organizationId, userId: tenant.userId, data: parsed.data });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Enregistrement impossible." };
  }
  revalidatePath("/settings");
  return { message: "Organisation mise à jour." };
}

export async function inviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("members.manage");
  const limit = rateLimit(`invite:${tenant.organizationId}`, 20, 60 * 60 * 1000);
  if (!limit.ok) return { error: "Trop d'invitations. Réessayez plus tard." };
  const parsed = inviteSchema.safeParse({
    name: formText(formData, "name"),
    email: formText(formData, "email"),
    password: formText(formData, "password"),
    role: formText(formData, "role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invitation invalide." };
  try {
    assertCan(tenant.role, parsed.data.role === "ADMIN" ? "members.assignOwner" : "members.manage");
    if (parsed.data.role === "ADMIN") assertCan(tenant.role, "members.assignOwner");
    await inviteMember({
      organizationId: tenant.organizationId,
      actorId: tenant.userId,
      actorRole: tenant.role,
      ...parsed.data,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invitation impossible." };
  }
  revalidatePath("/settings");
  return { message: "Utilisateur ajouté à l'organisation." };
}

export async function ruleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("rules.manage");
  const fields = formData.getAll("field").map((value) => String(value));
  const ops = formData.getAll("op").map((value) => String(value));
  const values = formData.getAll("value").map((value) => String(value));
  const parsed = ruleSchema.safeParse({
    name: formText(formData, "name"),
    trigger: formText(formData, "trigger"),
    conditions: fields.map((field, index) => ({ field, op: ops[index] ?? "", value: values[index] ?? "" })),
    action: formText(formData, "action"),
    actionValue: formText(formData, "actionValue"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Règle invalide." };
  try {
    await createRule({ organizationId: tenant.organizationId, userId: tenant.userId, ...parsed.data });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Création impossible." };
  }
  revalidatePath("/automations");
  return { message: "Règle créée." };
}

export async function toggleRuleAction(formData: FormData) {
  const tenant = await requirePermission("rules.manage");
  await setRuleEnabled({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    ruleId: formText(formData, "ruleId"),
    enabled: formText(formData, "enabled") !== "true",
  });
  revalidatePath("/automations");
}

export async function partyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("parties.manage");
  const kind = formText(formData, "kind") === "customer" ? "customer" : "supplier";
  const parsed = partySchema.safeParse({
    name: formText(formData, "name"),
    siren: formText(formData, "siren"),
    vatNumber: formText(formData, "vatNumber"),
    email: formText(formData, "email"),
    category: formText(formData, "category"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Fiche invalide." };
  try {
    await createParty({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      kind,
      name: parsed.data.name,
      siren: parsed.data.siren || undefined,
      vatNumber: parsed.data.vatNumber || undefined,
      email: parsed.data.email || undefined,
      category: parsed.data.category || undefined,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Création impossible." };
  }
  revalidatePath(kind === "customer" ? "/customers" : "/suppliers");
  return { message: "Fiche enregistrée." };
}

export async function exportDataAction() {
  const tenant = await requirePermission("gdpr.export");
  const limit = rateLimit(`export:${tenant.organizationId}`, 10, 60 * 60 * 1000);
  if (!limit.ok) return { error: "Trop d'exports. Réessayez plus tard." };
  const data = await exportOrganization(tenant.organizationId);
  return data;
}

export async function supportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requireTenant();
  const organization = await prisma.organization.findFirst({ where: { id: tenant.organizationId }, select: { plan: true } });
  try {
    await createSupportRequest({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      role: tenant.role,
      plan: organization?.plan ?? "STARTER",
      kind: formText(formData, "kind"),
      page: formText(formData, "page"),
      message: formText(formData, "message"),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Envoi impossible." };
  }
  revalidatePath("/support");
  return { message: "Demande enregistrée. Elle reste dans cette organisation." };
}

export async function publishStatusAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  void prev;
  const tenant = await requirePermission("system.read");
  if (!canEditStatus(tenant.email)) return { error: "Votre compte ne publie pas le statut du service." };
  try {
    await publishIncident({
      level: formText(formData, "level"),
      title: formText(formData, "title"),
      message: formText(formData, "message"),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Publication impossible." };
  }
  revalidatePath("/status");
  revalidatePath("/admin/system");
  return { message: "Incident publié sur la page de statut." };
}

export async function resolveStatusAction(formData: FormData) {
  const tenant = await requirePermission("system.read");
  if (!canEditStatus(tenant.email)) return;
  await resolveIncident(formText(formData, "incidentId"));
  revalidatePath("/status");
  revalidatePath("/admin/system");
}

export async function checkoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("billing.manage");
  const plan = formText(formData, "plan");
  if (plan !== "STARTER" && plan !== "PRO" && plan !== "BUSINESS") return { error: "Plan inconnu." };
  let url = "";
  try {
    url = await createCheckoutUrl({ organizationId: tenant.organizationId, email: tenant.email, plan });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Paiement impossible." };
  }
  redirect(url);
}

export async function portalAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  void prev;
  void formData;
  const tenant = await requirePermission("billing.manage");
  let url = "";
  try {
    url = await createPortalUrl(tenant.organizationId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Portail indisponible." };
  }
  redirect(url);
}

export async function cancelSubscriptionAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  void prev;
  void formData;
  const tenant = await requirePermission("billing.manage");
  try {
    await requestCancellation(tenant.organizationId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Annulation impossible." };
  }
  revalidatePath("/billing");
  return { message: "La demande d'annulation est envoyée. Elle apparaît ici lorsque Stripe la confirme." };
}

export async function removeMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("members.manage");
  try {
    await removeMember({ organizationId: tenant.organizationId, actorId: tenant.userId, memberId: formText(formData, "memberId") });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Retrait impossible." };
  }
  revalidatePath("/settings");
  return { message: "Accès retiré." };
}

export async function deleteAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requireTenant();
  if (formText(formData, "confirm") !== tenant.email) return { error: "Saisissez votre email pour confirmer." };
  try {
    await deleteAccount(tenant.userId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Suppression impossible." };
  }
  await signOut({ redirectTo: "/" });
  return null;
}

export async function deleteOrgAction(formData: FormData) {
  const tenant = await requirePermission("org.delete");
  const { assertDemoAllowsDeletion } = await import("@/services/demo");
  await assertDemoAllowsDeletion(tenant.organizationId);
  if (formText(formData, "confirm") !== tenant.email) {
    return;
  }
  await deleteOrganization(tenant.organizationId);
  await signOut({ redirectTo: "/" });
}

export async function anomalyStatusAction(formData: FormData) {
  const tenant = await requirePermission("invoices.update");
  const status = formText(formData, "status");
  if (status !== "ACKNOWLEDGED" && status !== "RESOLVED" && status !== "IGNORED") return;
  const anomalyId = formText(formData, "anomalyId");
  await setAnomalyStatus({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    anomalyId,
    status,
    comment: formText(formData, "comment"),
  });
  revalidatePath("/anomalies");
  revalidatePath(`/anomalies/${anomalyId}`);
  revalidatePath("/dashboard");
}

export async function validateInvoiceAction(formData: FormData) {
  const tenant = await requirePermission("invoices.update");
  const invoiceId = formText(formData, "invoiceId");
  await validateSupplierInvoice({ organizationId: tenant.organizationId, userId: tenant.userId, invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function approvalDecisionAction(formData: FormData) {
  const tenant = await requirePermission("approvals.manage");
  const decision = formText(formData, "decision");
  if (decision !== "APPROVED" && decision !== "REJECTED") return;
  await decideApproval({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    role: tenant.role,
    approvalId: formText(formData, "approvalId"),
    decision,
    comment: formText(formData, "comment"),
  });
  revalidatePath("/approvals");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
}

export async function automationSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("org.update");
  const autoEuros = Number(formText(formData, "autoValidateEuros"));
  const managerEuros = Number(formText(formData, "managerApprovalEuros"));
  if (!Number.isFinite(autoEuros) || !Number.isFinite(managerEuros) || autoEuros <= 0 || managerEuros <= autoEuros) {
    return { error: "Le seuil propriétaire doit être supérieur au seuil d'auto-validation." };
  }
  const confidence = confidenceSettings(formData);
  if ("error" in confidence) return confidence;
  const organization = await prisma.organization.findFirst({ where: { id: tenant.organizationId } });
  const current = (organization?.settings ?? {}) as Record<string, unknown>;
  await prisma.organization.update({
    where: { id: tenant.organizationId },
    data: {
      settings: {
        ...current,
        autoValidateCents: Math.round(autoEuros * 100),
        managerApprovalCents: Math.round(managerEuros * 100),
        amountTolerancePercent: Number(formText(formData, "amountTolerancePercent")) || 1,
        amountToleranceCents: Math.round(Number(formText(formData, "amountToleranceCents")) || 100),
        ...confidence.settings,
      },
    },
  });
  revalidatePath("/settings");
  return { message: "Seuils d'automatisation enregistrés." };
}

function confidenceSettings(formData: FormData) {
  const highText = formText(formData, "confidenceHigh");
  const mediumText = formText(formData, "confidenceMedium");
  if (!highText && !mediumText) return { settings: {} };
  const high = Number(highText);
  const medium = Number(mediumText);
  if (!Number.isFinite(high) || !Number.isFinite(medium) || high <= medium || high > 100 || medium < 0) {
    return { error: "Le seuil de confiance haute doit être supérieur au seuil moyen, entre 0 et 100." };
  }
  return { settings: { confidenceHigh: high, confidenceMedium: medium } };
}

export async function updateRuleAction(formData: FormData) {
  const tenant = await requirePermission("rules.manage");
  const name = formText(formData, "name").trim();
  if (!name) return;
  await prisma.automationRule.updateMany({
    where: { id: formText(formData, "ruleId"), organizationId: tenant.organizationId },
    data: { name },
  });
  revalidatePath("/automations");
}

export async function deleteRuleAction(formData: FormData) {
  const tenant = await requirePermission("rules.manage");
  const rule = await prisma.automationRule.findFirst({
    where: { id: formText(formData, "ruleId"), organizationId: tenant.organizationId },
  });
  if (!rule) return;
  await prisma.automationRule.delete({ where: { id: rule.id } });
  if (rule.workflowId) await prisma.workflow.deleteMany({ where: { id: rule.workflowId, organizationId: tenant.organizationId } });
  revalidatePath("/automations");
}

export async function duplicateRuleAction(formData: FormData) {
  const tenant = await requirePermission("rules.manage");
  const rule = await prisma.automationRule.findFirst({
    where: { id: formText(formData, "ruleId"), organizationId: tenant.organizationId },
  });
  if (!rule) return;
  await duplicateRule({ organizationId: tenant.organizationId, userId: tenant.userId, ruleId: rule.id });
  revalidatePath("/automations");
}

export async function markNotificationReadAction(formData: FormData) {
  const tenant = await requireTenant();
  await prisma.notification.updateMany({
    where: { id: formText(formData, "notificationId"), organizationId: tenant.organizationId },
    data: { read: true },
  });
  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction() {
  const tenant = await requireTenant();
  await prisma.notification.updateMany({ where: { organizationId: tenant.organizationId, read: false }, data: { read: true } });
  revalidatePath("/notifications");
}

export async function roiSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("org.update");
  const hourly = Number(formText(formData, "hourlyEuros"));
  const manual = Number(formText(formData, "manualMinutes"));
  const automated = Number(formText(formData, "automatedMinutes"));
  if (!Number.isFinite(hourly) || hourly <= 0 || !Number.isFinite(manual) || manual <= 0 || !Number.isFinite(automated) || automated < 0 || automated > manual) {
    return { error: "Les minutes automatisées doivent rester inférieures ou égales aux minutes manuelles." };
  }
  const organization = await prisma.organization.findFirst({ where: { id: tenant.organizationId } });
  const current = (organization?.settings ?? {}) as Record<string, unknown>;
  await prisma.organization.update({
    where: { id: tenant.organizationId },
    data: {
      settings: {
        ...current,
        hourlyCostCents: Math.round(hourly * 100),
        manualMinutes: Math.round(manual),
        minutesPerDocument: Math.round(manual),
        automatedMinutes: Math.round(automated),
      },
    },
  });
  revalidatePath("/roi");
  revalidatePath("/dashboard");
  return { message: "Hypothèses enregistrées. Le calcul reste une estimation opérationnelle." };
}

export async function onboardingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("org.update");
  const sector = formText(formData, "sector").trim();
  const volume = Number(formText(formData, "invoiceVolume"));
  const manual = Number(formText(formData, "manualMinutes"));
  const automated = Number(formText(formData, "automatedMinutes"));
  if (!sector || !Number.isFinite(manual) || manual <= 0 || !Number.isFinite(automated) || automated > manual) {
    return { error: "Indiquez un secteur et des durées cohérentes." };
  }
  const organization = await prisma.organization.findFirst({ where: { id: tenant.organizationId } });
  const current = (organization?.settings ?? {}) as Record<string, unknown>;
  await prisma.organization.update({
    where: { id: tenant.organizationId },
    data: {
      sector,
      settings: {
        ...current,
        invoiceVolume: Number.isFinite(volume) ? volume : 0,
        manualMinutes: Math.round(manual),
        minutesPerDocument: Math.round(manual),
        automatedMinutes: Math.round(automated),
      },
    },
  });
  const { installDefaultInvoiceRules } = await import("@/services/automation");
  await installDefaultInvoiceRules(tenant.organizationId, tenant.userId);
  revalidatePath("/onboarding");
  revalidatePath("/dashboard");
  const invite = formText(formData, "inviteEmail").trim();
  return { message: invite ? `Organisation prête. Terminez l'invitation de ${invite} dans Membres, avec un mot de passe temporaire.` : "Organisation prête. La règle de base est en place." };
}

export async function resetDemoAction() {
  const tenant = await requirePermission("org.update");
  const { resetDemoOrganization } = await import("@/services/demo");
  await resetDemoOrganization({ organizationId: tenant.organizationId, userId: tenant.userId });
  revalidatePath("/");
  redirect("/dashboard");
}

export async function receiveInboxEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("documents.upload");
  const from = formText(formData, "from");
  const subject = formText(formData, "subject");
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (!from.includes("@")) return { error: "Indiquez l'email source." };
  if (files.length === 0) return { error: "Ajoutez au moins une pièce jointe." };
  const { normalizeForwardedEmail } = await import("@/connectors/email/inbox");
  const { acceptInboundEmail, ensureInbox } = await import("@/services/email-ingestion");
  const inbox = await ensureInbox(tenant.organizationId);
  const result = await acceptInboundEmail({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    provider: "FLUXORA_INBOX",
    message: normalizeForwardedEmail({
      externalId: `ui-${Date.now()}`,
      from,
      recipient: inbox.externalAccountId ?? "",
      subject,
      attachments: await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      ),
    }),
  });
  revalidatePath("/inbox");
  revalidatePath("/documents");
  return { message: `${result.created} document(s) mis en traitement. ${result.duplicates} doublon(s). ${result.rejected} rejeté(s).` };
}

export async function commitCsvAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("imports.manage");
  const kind = formText(formData, "kind");
  if (kind !== "suppliers" && kind !== "customers" && kind !== "orders") return { error: "Type d'import inconnu." };
  const text = formText(formData, "csv");
  try {
    const { commitCsv } = await import("@/services/csv-import");
    const result = await commitCsv({ organizationId: tenant.organizationId, userId: tenant.userId, kind, text });
    revalidatePath("/imports");
    revalidatePath("/suppliers");
    revalidatePath("/customers");
    revalidatePath("/orders");
    return { message: `${result.imported} ligne(s) importée(s). ${result.skipped} ignorée(s).` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Import impossible." };
  }
}

export async function savePennylaneTokenAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requirePermission("connectors.manage");
  const token = formText(formData, "token");
  if (token.length < 8) return { error: "Le jeton est trop court." };
  const { saveConnectorToken } = await import("@/services/accounting-sync");
  await saveConnectorToken({ organizationId: tenant.organizationId, userId: tenant.userId, provider: "PENNYLANE", token, scopes: "pennylane:suppliers pennylane:invoices" });
  revalidatePath("/sources");
  return { message: "Jeton Pennylane chiffré et enregistré." };
}

export async function syncPennylaneAction(prev: ActionState, formData: FormData): Promise<ActionState> {
  void prev;
  void formData;
  const tenant = await requirePermission("connectors.manage");
  const { prisma } = await import("@/server/db");
  const { createPennylaneConnector, pennylaneFixtureFetch } = await import("@/connectors/accounting/pennylane");
  const { syncAccounting } = await import("@/services/accounting-sync");
  const account = await prisma.connectorAccount.findFirst({ where: { organizationId: tenant.organizationId, provider: "PENNYLANE" } });
  const transport = (account?.settings as { transport?: string } | null)?.transport === "fixture" ? pennylaneFixtureFetch() : fetch;
  try {
    const result = await syncAccounting({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      connector: createPennylaneConnector(transport),
    });
    revalidatePath("/sources");
    revalidatePath("/suppliers");
    revalidatePath("/invoices");
    return { message: `${result.supplierCount} fournisseur(s) et ${result.invoiceCount} facture(s) importés via InvoiceService.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Synchronisation impossible." };
  }
}

export async function enablePennylaneFixtureAction() {
  const tenant = await requirePermission("connectors.manage");
  const { enablePennylaneFixture } = await import("@/services/accounting-sync");
  await enablePennylaneFixture(tenant.organizationId, tenant.userId);
  revalidatePath("/sources");
}

export async function retrySystemJobAction(formData: FormData) {
  const tenant = await requirePermission("system.read");
  const { retryJobManually } = await import("@/services/queue");
  const { writeAudit } = await import("@/server/audit");
  const jobId = formText(formData, "jobId");
  await retryJobManually(tenant.organizationId, jobId);
  await writeAudit({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    action: "job.retried",
    entityType: "Job",
    entityId: jobId,
  });
  revalidatePath("/admin/system");
}

export async function ensureSession() {
  return requireTenant();
}
