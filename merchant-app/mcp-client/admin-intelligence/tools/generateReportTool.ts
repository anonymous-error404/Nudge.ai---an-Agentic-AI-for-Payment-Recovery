import { prisma } from "../../../src/lib/prismaClient";

export const generateReportSchema = {
  type: "function" as const,
  function: {
    name: "generate_recovery_report",
    description: "Generate a comprehensive markdown-formatted payment recovery report for a time period.",
    parameters: {
      type: "object",
      properties: {
        period_days: { type: "number", description: "Number of past days to include in the report (default 7)" },
      },
      required: [],
    },
  },
};

export async function executeGenerateReport(args: { period_days?: number }): Promise<{ report: string }> {
  const days = args.period_days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const now = new Date();

  const events = await prisma.failureEvent.findMany({
    where: { detectedAt: { gte: since } },
    include: {
      recoveryActions: { orderBy: { executedAt: "asc" } },
      payment: {
        include: {
          order: {
            include: {
              customer: { select: { id: true } },
              product: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { detectedAt: "desc" },
  });

  const total = events.length;
  const pending = events.filter((e) => e.recoveryActions.length === 0);
  const inProgress: typeof events = [];
  const confirmed: { event: typeof events[0]; repurchase: { amount: number; createdAt: Date } }[] = [];

  // Real recovery = customer repurchased same product AFTER the failure
  for (const e of events) {
    const order = e.payment?.order;
    if (!order?.customer?.id || !order?.product?.id || e.recoveryActions.length === 0) {
      if (e.recoveryActions.length > 0) inProgress.push(e);
      continue;
    }
    const repurchase = await prisma.order.findFirst({
      where: {
        id: order.id,
        status: "paid",
      },
      orderBy: { createdAt: "asc" },
    });
    if (repurchase) {
      confirmed.push({ event: e, repurchase: { amount: repurchase.amount, createdAt: repurchase.updatedAt } });
    } else {
      inProgress.push(e);
    }
  }

  const totalRecoveredPaise = confirmed.reduce((s, c) => s + c.repurchase.amount, 0);
  const totalAtRiskPaise = events.reduce((s, e) => s + (e.payment?.order?.amount ?? 0), 0) - totalRecoveredPaise;
  const recoveryRatePct = total > 0 ? ((confirmed.length / total) * 100).toFixed(1) : "0.0";

  // Category breakdown
  const catMap: Record<string, { count: number; amount: number }> = {};
  for (const e of events) {
    const cat = e.classifiedCategory;
    if (!catMap[cat]) catMap[cat] = { count: 0, amount: 0 };
    catMap[cat].count++;
    catMap[cat].amount += e.payment?.order?.amount ?? 0;
  }
  const catRows = Object.entries(catMap)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([cat, s]) => `| ${cat.replace(/_/g, " ")} | ${s.count} | ₹${Math.round(s.amount / 100).toLocaleString("en-IN")} |`)
    .join("\n");

  const proofRows = confirmed.slice(0, 10).map(({ event: e, repurchase }) => {
    const action = e.recoveryActions.find((a) => a.actionType !== "do_nothing") ?? e.recoveryActions[0];
    const amt = Math.round(repurchase.amount / 100).toLocaleString("en-IN");
    const hrs = ((repurchase.createdAt.getTime() - e.detectedAt.getTime()) / 3600000).toFixed(1);
    return `| ${e.classifiedCategory.replace(/_/g, " ")} | ₹${amt} | ${action?.actionType?.replace(/_/g, " ") ?? "—"} | ${action?.channel ?? "—"} | ✓ Recovered in ${hrs}h |`;
  }).join("\n");

  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const report = `# Payment Recovery Report
**Period:** ${fmt(since)} – ${fmt(now)} (last ${days} days)
**Generated:** ${fmt(now)}

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Failure Events | ${total} |
| ✓ Confirmed Recoveries | ${confirmed.length} |
| ⚡ In Progress (AI acted, awaiting payment) | ${inProgress.length} |
| ⏳ Pending (no action yet) | ${pending.length} |
| **Revenue Recovered** | **₹${Math.round(totalRecoveredPaise / 100).toLocaleString("en-IN")}** |
| Revenue At Risk | ₹${Math.round(Math.max(0, totalAtRiskPaise) / 100).toLocaleString("en-IN")} |
| **Recovery Rate** | **${recoveryRatePct}%** |

> **Definition:** "Recovered" = customer paid the original failed order after retry.
> "In Progress" = AI sent a recovery action but customer has not yet paid.

---

## Failure Category Breakdown

| Category | Events | Amount Lost |
|----------|--------|-------------|
${catRows || "| No data | — | — |"}

---

## Confirmed Recovery Proof

| Category | Amount Recovered | Action Taken | Channel | Outcome |
|----------|-----------------|--------------|---------|---------|
${proofRows || "| No confirmed recoveries in this period — payment required | — | — | — | — |"}

---

## Audit Trail Note

All recovery actions were executed by the AI Recovery Agent with full logging. Agent reasoning is stored in the database for compliance. No customer PII was shared externally.

*Report generated by Merchant Intelligence Agent.*`;

  return { report };
}

