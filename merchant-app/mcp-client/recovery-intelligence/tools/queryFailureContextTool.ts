/**
 * query_failure_context tool
 * Returns enriched (but non-PII) context about a failure event for AI to reason over.
 * AI may call this before deciding which recovery action to take.
 */
import { prisma } from "../../../src/lib/prismaClient";
import { failureEventRepository } from "../../../src/repositories/failureEventRepository";

export const queryFailureContextSchema = {
  type: "function" as const,
  function: {
    name: "query_failure_context",
    description:
      "Fetches enriched context about a failed payment — order history, previous recovery attempts, " +
      "customer payment behaviour — to help decide the best recovery strategy. Call this first if " +
      "you need more information before choosing a recovery action.",
    parameters: {
      type: "object" as const,
      properties: {
        failure_event_id: {
          type: "string",
          description: "The merchant-side failure_event ID to query.",
        },
      },
      required: ["failure_event_id"],
    },
  },
};

export async function executeQueryFailureContext(args: {
  failure_event_id: string;
}): Promise<Record<string, unknown>> {
  const event = await prisma.failureEvent.findUnique({
    where: { id: args.failure_event_id },
    include: {
      recoveryActions: { orderBy: { attemptNumber: "asc" } },
      payment: {
        include: {
          order: {
            include: {
              customer: {
                include: {
                  orders: {
                    include: { payments: true },
                    orderBy: { createdAt: "desc" },
                    take: 5,
                  },
                },
              },
              product: true,
            },
          },
        },
      },
    },
  });

  if (!event) {
    return { error: `Failure event ${args.failure_event_id} not found` };
  }

  const customer = event.payment?.order?.customer;
  const totalOrders = customer?.orders?.length ?? 0;
  const successfulPayments =
    customer?.orders
      ?.flatMap((o: any) => o.payments)
      .filter((p: any) => p.status === "captured").length ?? 0;

  // Return non-PII enriched context
  return {
    failure_event_id: event.id,
    classified_category: event.classifiedCategory,
    root_cause: event.rootCause,
    detected_at: event.detectedAt,
    previous_recovery_attempts: (event.payment?.order
      ? await failureEventRepository.getRecoveryActionsByOrderId(
          event.payment.order.id,
        )
      : event.recoveryActions
    ).map((a: any) => ({
      attempt: a.attemptNumber,
      action_type: a.actionType,
      outcome: a.outcome,
      reasoning: a.agentReasoning,
    })),
    payment_method: event.payment?.method ?? "unknown",
    order_status: event.payment?.order?.status ?? "unknown",
    order_amount_paise: event.payment?.order?.amount,
    product_name: event.payment?.order?.product?.name ?? "unknown",
    customer_insights: {
      total_orders: totalOrders,
      successful_payments: successfulPayments,
      is_returning_customer: totalOrders > 1,
      // No email/phone crosses this boundary, but we provide ID and Name for notification tools
    },
    customer_id: customer?.id ?? "unknown",
    customer_name: customer?.name ?? "Customer",
  };
}



