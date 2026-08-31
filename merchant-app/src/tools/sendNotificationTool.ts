/**
 * send_notification tool
 * Mock implementation — logs to console and returns success.
 * Replace with real SMS/email provider (Twilio, SendGrid, etc.) when going live.
 */

export const sendNotificationSchema = {
  type: "function" as const,
  function: {
    name: "send_notification",
    description:
      "Sends a payment recovery nudge to the customer via the specified channel (SMS, email, or WhatsApp). " +
      "Use for delayed recovery: insufficient funds, abandoned cart, do-not-honor bank declines.",
    parameters: {
      type: "object" as const,
      properties: {
        customer_id: {
          type: "string",
          description: "The merchant-side customer ID to notify.",
        },
        channel: {
          type: "string",
          enum: ["sms", "email", "whatsapp"],
          description: "Delivery channel for the notification.",
        },
        template: {
          type: "string",
          description:
            "Template key or free-text message hint. The notification writer agent will produce the final copy.",
        },
      },
      required: ["customer_id", "channel", "template"],
    },
  },
};

export async function executeSendNotification(args: {
  customer_id: string;
  channel: string;
  template: string;
  content?: string;   // injected by Agent 3 before delivery
  subject?: string;   // email subject from Agent 3
}): Promise<{ success: boolean; channel: string; message: string }> {
  const body = args.content ?? args.template;

  // TODO: Replace with real provider call
  console.log(`\n📬 [MOCK] Sending ${args.channel.toUpperCase()} notification`);
  console.log(`   customer_id : ${args.customer_id}`);
  if (args.subject) console.log(`   subject     : ${args.subject}`);
  console.log(`   body        : ${body}`);

  return {
    success: true,
    channel: args.channel,
    message: `Notification sent via ${args.channel} (mock)`,
  };
}
