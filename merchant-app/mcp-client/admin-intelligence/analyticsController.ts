import { Request, Response } from "express";
import { prisma } from "../../src/lib/prismaClient";

// ─────────────────────────────────────────────────────────────────────
// Analytics REST endpoints (all read-only, admin-gated)
// ─────────────────────────────────────────────────────────────────────

class AnalyticsController {
  private requireAdmin(req: Request, res: Response): boolean {
    if (!req.session?.user || req.session.user.role !== "admin") {
      res.status(403).json({ success: false, error: "Admin access required" });
      return false;
    }
    return true;
  }

  async getSummary(req: Request, res: Response) {
    if (!this.requireAdmin(req, res)) return;
    try {
      const events = await prisma.failureEvent.findMany({
        include: {
          recoveryActions: { orderBy: { executedAt: "asc" } },
          payment: {
            include: {
              order: {
                include: {
                  customer: { select: { id: true } },
                  product: { select: { id: true } },
                },
              },
            },
          },
        },
      });

      const total = events.length;
      const pending = events.filter((e) => e.recoveryActions.length === 0);

      // Real recovery = same customer repurchased same product after failure
      let recoveredCount = 0;
      let totalRecoveredPaise = 0;
      const hoursArr: number[] = [];

      for (const e of events) {
        const order = e.payment?.order;
        if (!order?.customer?.id || !order?.product?.id) continue;
        if (e.recoveryActions.length === 0) continue; // no action taken

        const repurchase = await prisma.order.findFirst({
          where: {
            customerId: order.customer.id,
            productId: order.product.id,
            status: "paid",
            createdAt: { gt: e.detectedAt },
          },
          orderBy: { createdAt: "asc" },
        });

        if (repurchase) {
          recoveredCount++;
          totalRecoveredPaise += repurchase.amount;
          hoursArr.push(
            (repurchase.createdAt.getTime() - e.detectedAt.getTime()) / 3600000
          );
        }
      }

      // At-risk = events with no confirmed repurchase and amount still outstanding
      const atRiskEvents = events.filter((e) => {
        const order = e.payment?.order;
        if (!order) return false;
        return true; // simplified — all non-recovered events contribute to at-risk
      });
      const totalAtRiskPaise = atRiskEvents.reduce(
        (s, e) => s + (e.payment?.order?.amount ?? 0),
        0
      ) - totalRecoveredPaise;

      const avgHoursToRecover =
        hoursArr.length > 0
          ? hoursArr.reduce((a, b) => a + b, 0) / hoursArr.length
          : 0;

      res.json({
        success: true,
        data: {
          totalFailureEvents: total,
          totalRecoveredPaise,
          totalAtRiskPaise: Math.max(0, totalAtRiskPaise),
          pendingRecovery: pending.length,
          recoveryRatePct:
            total > 0
              ? parseFloat(((recoveredCount / total) * 100).toFixed(1))
              : 0,
          avgHoursToRecover: parseFloat(avgHoursToRecover.toFixed(1)),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getFailureBreakdown(req: Request, res: Response) {
    if (!this.requireAdmin(req, res)) return;
    try {
      const events = await prisma.failureEvent.findMany({
        include: { payment: { include: { order: true } } },
      });
      const grouped: Record<string, { count: number; totalAmountPaise: number }> = {};
      for (const e of events) {
        if (!grouped[e.classifiedCategory]) grouped[e.classifiedCategory] = { count: 0, totalAmountPaise: 0 };
        grouped[e.classifiedCategory].count++;
        grouped[e.classifiedCategory].totalAmountPaise += e.payment?.order?.amount ?? 0;
      }
      const data = Object.entries(grouped)
        .map(([category, s]) => ({ category, count: s.count, totalAmountPaise: s.totalAmountPaise }))
        .sort((a, b) => b.count - a.count);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getRecoveryProof(req: Request, res: Response) {
    if (!this.requireAdmin(req, res)) return;
    try {
      // Real proof of recovery = closed loop:
      //   FailureEvent (customer X, product Y, amount Z failed)
      //   → AI sent a recovery action (any type)
      //   → SAME customer later placed a NEW order for the SAME product with status="paid"
      //     where that paid order was created AFTER the failure was detected
      //
      // This proves money was genuinely recovered, not just that an email was sent.

      const events = await prisma.failureEvent.findMany({
        where: { recoveryActions: { some: {} } }, // must have at least one action taken
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

      const confirmedRecoveries = [];

      for (const e of events) {
        const failedOrder = e.payment?.order;
        if (!failedOrder) continue;

        const customerId = failedOrder.customer?.id;
        const productId = failedOrder.product?.id;
        if (!customerId || !productId) continue;

        // Look for a PAID order from the same customer for the same product
        // that was created AFTER the failure was detected
        const repurchase = await prisma.order.findFirst({
          where: {
            customerId,
            productId,
            status: "paid",
            createdAt: { gt: e.detectedAt },
          },
          orderBy: { createdAt: "asc" },
        });

        if (!repurchase) continue; // no repurchase = not a confirmed recovery

        // Find the first meaningful recovery action taken
        const action = e.recoveryActions.find(
          (a) => a.actionType !== "do_nothing"
        ) ?? e.recoveryActions[0];

        confirmedRecoveries.push({
          failureEventId: e.id,
          detectedAt: e.detectedAt.toISOString(),
          category: e.classifiedCategory,
          // Amount from the REPURCHASE (actual money recovered)
          amountPaise: repurchase.amount,
          repurchasedAt: repurchase.createdAt.toISOString(),
          hoursToRecover: parseFloat(
            ((repurchase.createdAt.getTime() - e.detectedAt.getTime()) / 3600000).toFixed(1)
          ),
          recoveryAction: action
            ? {
                actionType: action.actionType,
                channel: action.channel,
                executedAt: action.executedAt.toISOString(),
              }
            : null,
          agentReasoning: action?.agentReasoning ?? null,
        });
      }

      res.json({ success: true, data: confirmedRecoveries });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getCustomerRisk(req: Request, res: Response) {
    if (!this.requireAdmin(req, res)) return;
    try {
      const events = await prisma.failureEvent.findMany({
        include: {
          recoveryActions: true,
          payment: { include: { order: { include: { customer: { select: { id: true } } } } } },
        },
      });
      const byCustomer: Record<string, { failureCount: number; atRiskPaise: number; lastFailureAt: Date }> = {};
      for (const e of events) {
        const cid = e.payment?.order?.customer?.id;
        if (!cid) continue;
        const isRecovered = e.recoveryActions.some((a) => a.outcome === "success");
        if (!byCustomer[cid]) byCustomer[cid] = { failureCount: 0, atRiskPaise: 0, lastFailureAt: e.detectedAt };
        byCustomer[cid].failureCount++;
        if (!isRecovered) byCustomer[cid].atRiskPaise += e.payment?.order?.amount ?? 0;
        if (e.detectedAt > byCustomer[cid].lastFailureAt) byCustomer[cid].lastFailureAt = e.detectedAt;
      }
      const data = Object.values(byCustomer)
        .sort((a, b) => b.failureCount - a.failureCount)
        .slice(0, 20)
        .map((c, i) => ({
          rank: i + 1,
          anonymizedLabel: `Customer #${i + 1}`,
          failureCount: c.failureCount,
          totalAtRiskPaise: c.atRiskPaise,
          lastFailureAt: c.lastFailureAt.toISOString(),
        }));
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const analyticsController = new AnalyticsController();
