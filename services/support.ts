import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db";
import { sendMail } from "@/services/mail";

const requestSchema = z.object({
  kind: z.enum(["contact", "bug", "help"], { message: "Type de demande inconnu." }),
  page: z.string().trim().regex(/^\/[a-z0-9/_-]{0,80}$/i, "Indiquez une page de l'application."),
  message: z.string().trim().min(10, "Décrivez la demande en une ou deux phrases.").max(2000, "Le message est trop long."),
});

export async function createSupportRequest(input: {
  organizationId: string;
  userId: string;
  role: string;
  plan: string;
  kind: string;
  page: string;
  message: string;
}) {
  const parsed = requestSchema.safeParse({
    kind: input.kind,
    page: input.page.trim() || "/support",
    message: input.message,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Message invalide.");
  const context = `role=${input.role}; plan=${input.plan}`;
  const saved = await prisma.supportRequest.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      kind: parsed.data.kind,
      page: parsed.data.page,
      context,
      message: parsed.data.message,
    },
  });
  const inbox = process.env.SUPPORT_INBOX?.trim();
  if (inbox) {
    await sendMail({
      to: inbox,
      template: "support",
      subject: "Demande de support Fluxora",
      text: `Organisation ${input.organizationId}\nPage ${saved.page}\n${saved.context}`,
      organizationId: input.organizationId,
    });
  }
  return saved;
}

export async function listSupportRequests(organizationId: string) {
  return prisma.supportRequest.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      kind: true,
      page: true,
      context: true,
      message: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
}
