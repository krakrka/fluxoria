import { prisma } from "@/server/db";
import { requireTenant } from "@/server/tenant";
import { can } from "@/lib/permissions";
import { duplicateRuleAction, toggleRuleAction, updateRuleAction } from "@/server/actions";
import { ConfirmDelete } from "@/components/confirm-delete";
import { RuleForm } from "@/components/rule-form";
import { PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/forms";

export const dynamic = "force-dynamic";

function summarize(conditions: unknown) {
  const all = (conditions as { all?: Array<{ field?: string; op?: string; value?: unknown }> } | null)?.all ?? [];
  const labels: Record<string, string> = {
    greater_or_equal: "≥",
    greater_than: ">",
    less_than: "<",
    less_or_equal: "≤",
    equals: "=",
    not_equals: "≠",
    contains: "contient",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    eq: "=",
  };
  return all.map((item) => `${item.field} ${labels[item.op ?? ""] ?? item.op} ${String(item.value)}`).join(" ET ") || "—";
}

function summarizeActions(actions: unknown) {
  return Array.isArray(actions) ? actions.map((action) => String((action as { type?: string }).type ?? "action")).join(", ") : "—";
}

export default async function AutomationsPage() {
  const tenant = await requireTenant();
  const rules = await prisma.automationRule.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { priority: "asc" },
    include: {
      _count: { select: { executions: true } },
      executions: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Workflows"
        title="Automatisations"
        description="Chaque règle combine un déclencheur, des conditions en ET, puis une action. Ce format pourra alimenter un builder visuel plus tard."
      />
      {can(tenant.role, "rules.manage") && (
        <Panel className="mb-6 p-5">
          <RuleForm />
        </Panel>
      )}
      <div className="space-y-3">
        {rules.map((rule) => (
          <Panel key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="font-medium">{rule.name}</p>
              <p className="text-sm text-muted">
                {rule.enabled ? "Active" : "Inactive"} · {rule.trigger} · {summarize(rule.conditions)} · {summarizeActions(rule.actions)}
              </p>
              <p className="text-xs text-muted">
                {rule._count.executions} exécution(s)
                {rule.executions[0] ? ` · dernière : ${rule.executions[0].status}` : ""}
              </p>
            </div>
            {can(tenant.role, "rules.manage") && (
              <div className="flex flex-wrap gap-2">
                <form action={updateRuleAction} className="flex gap-2">
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <input name="name" defaultValue={rule.name} aria-label={`Nom de ${rule.name}`} className="h-10 rounded-lg border border-line bg-surface px-3 text-sm" />
                  <SubmitButton variant="secondary">Modifier</SubmitButton>
                </form>
                <form action={toggleRuleAction}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <input type="hidden" name="enabled" value={String(rule.enabled)} />
                  <SubmitButton variant="secondary">{rule.enabled ? "Désactiver" : "Activer"}</SubmitButton>
                </form>
                <form action={duplicateRuleAction}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <SubmitButton variant="secondary">Dupliquer</SubmitButton>
                </form>
                <ConfirmDelete ruleId={rule.id} />
              </div>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
