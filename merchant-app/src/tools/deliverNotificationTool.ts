/**
 * deliver_notification
 * Internal handler — NOT exposed to Claude as a tool.
 * Called by the MCP callback route when Agent 3 has written the final content
 * and the server relays it for actual delivery.
 */
import { executeSendNotification } from "./sendNotificationTool";

export async function executeDeliverNotification(args: {
  customer_id: string;
  channel: string;
  template: string;
  content?: string;
  subject?: string;
}): Promise<{ success: boolean; channel: string; message: string }> {
  return executeSendNotification(args);
}
