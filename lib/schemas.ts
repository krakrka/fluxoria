import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "10 caractères minimum")
  .regex(/[A-Za-z]/, "Au moins une lettre")
  .regex(/[0-9]/, "Au moins un chiffre");

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: passwordSchema,
  organizationName: z.string().trim().min(2).max(120),
  siren: z
    .string()
    .trim()
    .max(9)
    .optional()
    .or(z.literal("")),
  consent: z.literal("on", {
    errorMap: () => ({ message: "Le consentement est requis pour créer un compte." }),
  }),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const forgotSchema = z.object({
  email: z.string().trim().email(),
});

export const resetSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

export const fieldUpdateSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().max(500),
});

export const rejectSchema = z
  .object({
    code: z.enum(["wrong_document", "duplicate", "unreadable", "supplier_error", "other"]),
    detail: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((value, context) => {
    if (value.code === "other" && !value.detail) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Précisez le motif.", path: ["detail"] });
    }
  });

export const partySchema = z.object({
  name: z.string().trim().min(2).max(160),
  siren: z.string().trim().max(14).optional().or(z.literal("")),
  vatNumber: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  category: z.string().trim().max(80).optional().or(z.literal("")),
});

export const inviteSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  password: passwordSchema,
  role: z.enum(["ADMIN", "MANAGER", "ACCOUNTANT", "MEMBER"]),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  siren: z.string().trim().max(9).optional().or(z.literal("")),
  siret: z.string().trim().max(14).optional().or(z.literal("")),
  vatNumber: z.string().trim().max(20).optional().or(z.literal("")),
  addressLine: z.string().trim().max(200).optional().or(z.literal("")),
  postalCode: z.string().trim().max(12).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  sector: z.string().trim().max(80).optional().or(z.literal("")),
  companySize: z.string().trim().max(40).optional().or(z.literal("")),
  retentionDays: z.coerce.number().int().min(30).max(3650),
});

const conditionOpSchema = z.enum(["gt", "gte", "lt", "lte", "eq", "contains", "equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "is_empty", "is_not_empty"]);

export const ruleConditionSchema = z.object({
  field: z.string().trim().min(1).max(60),
  op: conditionOpSchema,
  value: z.string().trim().min(1).max(120),
});

export const ruleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  trigger: z.enum(["DOCUMENT_PROCESSED", "INVOICE_OVERDUE", "invoice.created", "anomaly.created", "document.validated"]),
  conditions: z.array(ruleConditionSchema).min(1, "Ajoutez au moins une condition.").max(8, "Huit conditions maximum."),
  action: z.enum([
    "require_review",
    "set_category",
    "mark_reconciled",
    "create_reminder_task",
    "auto_validate",
    "request_approval",
    "create_notification",
  ]),
  actionValue: z.string().trim().max(160).optional().or(z.literal("")),
});

export const linkPurchaseOrderSchema = z.object({
  purchaseOrderId: z.string().min(1),
});

export const supplierLinkSchema = z.object({
  supplierId: z.string().min(1),
});
