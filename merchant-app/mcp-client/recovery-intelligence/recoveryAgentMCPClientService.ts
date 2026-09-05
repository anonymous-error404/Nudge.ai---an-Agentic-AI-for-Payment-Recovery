/**
 * Recovery Agent MCP Client Service
 *
 * Responsible for:
 *  1. Building the redacted failure context (no PII crosses the boundary)
 *  2. Submitting a recovery job to the central MCP server
 *  3. Polling for job completion (used by escalated immediate failures)
 *
 * The MCP server runs the AI tool-use loop and relays tool calls back
 * to our /mcp/tool-call callback endpoint, which executes them locally.
 */

import { FailureCategory } from "../../src/enums";
import { failureEventRepository } from "../../src/repositories/failureEventRepository";
import { orderRepository } from "../../src/repositories/orderRepository";
import { TOOL_SCHEMAS } from "./tools";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3001";
const MERCHANT_ID = process.env.MERCHANT_ID ?? "merchant_demo_001";
const MERCHANT_CALLBACK_URL =
  process.env.MERCHANT_CALLBACK_URL ?? "http://localhost:3000/mcp";

// Maximum ms to poll for a job result (for escalated immediate failures)
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

// ─── Amount bucket helper (keeps exact amounts out of MCP server) ─────────────

function toAmountBucket(amountPaise: number): string {
  const rupees = amountPaise / 100;
  if (rupees < 500) return "0-500";
  if (rupees < 1000) return "500-1000";
  if (rupees < 5000) return "1000-5000";
  return "5000+";
}

// ─── Context builder — NO PII crosses this boundary ──────────────────────────

async function buildFailureContext(
  failureEventId: string,
  category: FailureCategory,
  paymentId: string,
) {
  const event = await failureEventRepository.getById(failureEventId);
  if (!event) throw new Error(`Failure event not found: ${failureEventId}`);

  const order = event.payment?.order;

  const previousActions = order
    ? await failureEventRepository.getRecoveryActionsByOrderId(order.id)
    : [];
  const amountBucket = order ? toAmountBucket(order.amount) : "unknown";

  const daysSinceFailure = Math.floor(
    (Date.now() - new Date(event.detectedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  return {
    failure_event_id: failureEventId,
    customer_id: order?.customerId ?? "unknown",
    customer_name: order?.customer?.name ?? "Customer",
    order_status: order?.status ?? "unknown",
    failure_category: category,
    amount_bucket: amountBucket,
    attempt_count: previousActions.length,
    days_since_failure: daysSinceFailure,
    payment_method: event.payment?.method ?? "unknown",
    previous_actions: previousActions.map(
      (a: any) => `${a.actionType}:${a.outcome}`,
    ),
    order_details: order
      ? {
          order_id: order.id,
          product_name: order.product?.name ?? "your item",
          product_description: order.product?.description ?? undefined,
          product_offer: order.product?.offers ?? null,
          amount_rupees: Math.round(order.amount / 100), // Razorpay stores in paise
          currency: "INR",
        }
      : null,
  };
}

// ─── MCPClient class ──────────────────────────────────────────────────────────

class MCPClient {
  async submitRecoveryJob(
    failureEventId: string,
    category: FailureCategory,
    paymentId: string,
  ): Promise<{
    uiMessage?: string;
    smsMessage?: string;
    followUpScheduleId?: string;
  }> {
    const context = await buildFailureContext(
      failureEventId,
      category,
      paymentId,
    );

    const body = {
      merchantId: MERCHANT_ID,
      merchantCallbackUrl: MERCHANT_CALLBACK_URL,
      externalRef: failureEventId,
      context,
      toolSchemas: TOOL_SCHEMAS,
    };

    try {
      console.log(
        `\n📡  MCP Client → MCP Server: Sending anonymised failure context`
      );
      console.log(
        `   Event: ${failureEventId} | Category: ${context.failure_category} | Amount bucket: ${context.amount_bucket}`
      );
      const response = await fetch(`${MCP_SERVER_URL}/api/recovery-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(
          `MCP Server error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      return data as any;
    } catch (error) {
      console.error("\n❌  MCP Client failed to reach MCP Server:", error);
      return {};
    }
  }

  /**
   * Poll for a job result — used when an immediate failure has been escalated
   * to the MCP server and the caller needs to wait for the decision.
   */
  async waitForJobResult(jobId: string): Promise<{
    status: string;
    actionType: string | null;
    agentReasoning: string | null;
  }> {
    const start = Date.now();

    while (Date.now() - start < POLL_TIMEOUT_MS) {
      const res = await fetch(`${MCP_SERVER_URL}/api/jobs/${jobId}/status`);
      if (res.ok) {
        const json = (await res.json()) as { success: boolean; data: any };
        const { status, actionType, agentReasoning } = json.data;
        if (
          status === "success" ||
          status === "failed" ||
          status === "skipped"
        ) {
          return { status, actionType, agentReasoning };
        }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(
      `Timed out waiting for MCP job ${jobId} after ${POLL_TIMEOUT_MS}ms`,
    );
  }
}

export const mcpClient = new MCPClient();
