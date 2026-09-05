/**
 * Shared pretty logger for demo-friendly terminal output.
 * Used by both the MCP Server and the Merchant App (TechZone).
 *
 * - All timestamps shown in IST (Asia/Kolkata)
 * - Each log is clearly separated and human-readable
 * - No log bleeds into another — every block is distinct
 */

function nowIST(): string {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function toIST(date: Date | string): string {
  return new Date(date).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

const divider = "─".repeat(56);

export const log = {
  /** A major flow event — printed with a divider and timestamp */
  section: (icon: string, title: string, detail?: string) => {
    console.log(`\n${divider}`);
    console.log(`${icon}  ${title}${detail ? `\n   ${detail}` : ""}`);
    console.log(`   ${nowIST()}`);
    console.log(divider);
  },

  /** Normal informational log */
  info: (icon: string, msg: string) => {
    console.log(`\n${icon}  ${msg}`);
  },

  /** A sub-step within a flow — indented */
  step: (msg: string) => {
    console.log(`   ↳ ${msg}`);
  },

  /** Success */
  success: (msg: string) => {
    console.log(`\n✅  ${msg}`);
  },

  /** Warning */
  warn: (msg: string) => {
    console.warn(`\n⚠️   ${msg}`);
  },

  /** Error */
  error: (msg: string, err?: any) => {
    console.error(`\n❌  ${msg}`);
    if (err) console.error(`   Detail: ${err}`);
  },

  /** MCP Server ordered the MCP Client to run a tool */
  toolOrdered: (toolName: string, args?: any) => {
    console.log(`\n🔧  MCP Server ordered MCP Client to execute: "${toolName}"`);
    if (args && Object.keys(args).length > 0) {
      const preview = JSON.stringify(args).slice(0, 140);
      console.log(`   Args: ${preview}${preview.length >= 140 ? "…" : ""}`);
    }
  },

  /** MCP Client finished executing a tool and result is back */
  toolResult: (toolName: string, result?: any) => {
    console.log(`\n📬  MCP Client executed "${toolName}" — result sent back to MCP Server`);
    if (result) {
      const preview = JSON.stringify(result).slice(0, 140);
      console.log(`   Result: ${preview}${preview.length >= 140 ? "…" : ""}`);
    }
  },

  /** Schedule log with IST datetime — always shows a human-readable date */
  scheduled: (label: string, at: Date) => {
    console.log(`\n📅  ${label}`);
    console.log(`   Next run scheduled at: ${toIST(at)} (IST)`);
  },

  /** Email / SMS dispatched */
  notificationSent: (channel: string, to: string, preview?: string) => {
    console.log(`\n${divider}`);
    console.log(`📨  NOTIFICATION DISPATCHED`);
    console.log(`    Channel:   ${channel.toUpperCase()}`);
    console.log(`    Recipient: ${to}`);
    if (preview) console.log(`    Message:   "${preview}"`);
    console.log(divider);
  },
};
