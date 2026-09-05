import { Request, Response } from "express";
import { executeTool, TOOL_SCHEMAS } from "./tools";
import { failureEventRepository } from "../../src/repositories/failureEventRepository";
import { RecoveryOutcome, RecoveryActionType } from "../../src/enums";
import { log } from '../../../shared/logger';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3001";

class McpCallbackController {
  /**
   * POST /mcp/tool-call
   * The MCP server relays a AI-chosen tool call here.
   * We execute the tool locally and POST the result back to the MCP server.
   */
  async handleToolCall(req: Request, res: Response) {
    const { jobId, tool, args, failureEventId } = req.body as {
      jobId: string;
      tool: string;
      args: Record<string, unknown>;
      failureEventId?: string;
    };

    if (!jobId || !tool || !args) {
      return res
        .status(400)
        .json({ success: false, error: "jobId, tool, and args are required" });
    }

    try {
      const result = await executeTool(tool, args);

      // Log the recovery action in the merchant DB (except context/internal tools)
      if (
        failureEventId &&
        tool !== "query_failure_context" &&
        tool !== "draft_notification_copy"
      ) {
        await import("../../src/lib/prismaClient")
          .then(async ({ prisma }) => {
            // Verify the failure event still exists before writing (guards against stale follow-up jobs)
            const eventExists = await prisma.failureEvent.findUnique({
              where: { id: failureEventId },
              select: { id: true },
            });
            if (!eventExists) {
              log.warn(`Skipping action log — failure event ${failureEventId} not found in DB (may be a stale follow-up job)`);
              return;
            }

            // Determine outcome: check common success indicators across all tool result shapes
            const isSuccess =
              result.success !== false &&
              result.error == null &&
              result.sent !== false;

            return prisma.recoveryAction.create({
              data: {
                failureEventId,
                actionType: tool,
                channel: args.channel ? String(args.channel) : null,
                outcome: isSuccess ? "success" : "failed",
                agentReasoning: (result as any).message
                  ? String((result as any).message)
                  : null,
              },
            }).then(async (action) => {
              // When escalating, mark the failure event status so admin dashboard shows it correctly
              if (tool === "escalate_to_human") {
                await prisma.failureEvent.update({
                  where: { id: failureEventId },
                  data: { status: "escalated" },
                });
              } else if (tool === "send_notification" && isSuccess) {
                // Mark as in_progress once first action is taken
                await prisma.failureEvent.update({
                  where: { id: failureEventId },
                  data: { status: "in_progress" },
                }).catch(() => {}); // non-fatal
              }
              return action;
            });
          })
          .catch((e) =>
            log.warn(`Could not save recovery action to merchant DB: ${e}`),
          );
      }

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      log.error(`MCP Client failed to execute tool "${tool}"`, err);
      return res.status(500).json({ success: false, error: String(err) });
    }
  }

  /**
   * POST /mcp/job-complete
   * The MCP server notifies us that AI has finished deciding and
   * all tools have been executed. Update our merchant DB accordingly.
   */
  async handleJobComplete(req: Request, res: Response) {
    const { jobId, actionType, outcome, agentReasoning, notificationContent } =
      req.body as {
        jobId: string;
        actionType: string | null;
        outcome: string;
        agentReasoning: string | null;
        notificationContent?: string | null;
      };

    if (!jobId) {
      return res
        .status(400)
        .json({ success: false, error: "jobId is required" });
    }

    res
      .status(200)
      .json({ success: true, message: "Job completion acknowledged" });

    // Update the merchant-side recovery_action row with the final outcome
    try {
      const recoveryActions = await failureEventRepository
        .getRecoveryActionsByJobId(jobId)
        .catch(() => []);

      if (recoveryActions.length > 0) {
        const action = recoveryActions[0];
        await failureEventRepository.updateRecoveryActionOutcome(action.id, {
          outcome: outcome as RecoveryOutcome,
          actionType: (actionType as RecoveryActionType) ?? undefined,
          agentReasoning: agentReasoning ?? undefined,
        });
      }

      log.section(
        "🏁",
        `MCP recovery job complete`,
        `jobId=${jobId} | action=${actionType} | outcome=${outcome}`,
      );
      if (agentReasoning) {
        log.step(`Agent reasoning: ${agentReasoning}`);
      }
    } catch (err) {
      log.error("Could not update merchant DB after MCP job completion", err);
    }
  }
}

async function postToolResult(jobId: string, result: Record<string, unknown>) {
  try {
    await fetch(`${MCP_SERVER_URL}/api/tool-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, result }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    log.error(`Failed to post tool result for job ${jobId} back to MCP Server`, err);
  }
}

export const mcpCallbackController = new McpCallbackController();
