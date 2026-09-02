import { FailureCategory } from "../enums";
import { mcpClient } from "./recoveryAgentMCPClientService";

export async function handlePaymentFailure(
  failureEventId: string,
  category: FailureCategory,
  paymentId: string
) {
  // Always send to MCP Server for real-time AI decision
  const result = await mcpClient.submitRecoveryJob(failureEventId, category, paymentId);
  
  return {
    uiMessage: result.uiMessage || "Your payment failed. Please try again.",
  };
}
