import { Request, Response } from "express";
import { executeTool } from "../tools";
import { failureEventRepository } from "../repositories/failureEventRepository";
import { RecoveryOutcome, RecoveryActionType } from "../enums";

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

      // Log the recovery action in the merchant DB (except context gathering)
      if (
        failureEventId &&
        tool !== "query_failure_context" &&
        tool !== "draft_notification_copy"
      ) {
        await import("../lib/prismaClient")
          .then(({ prisma }) =>
            prisma.recoveryAction.create({
              data: {
                failureEventId,
                actionType: tool,
                channel: args.channel ? String(args.channel) : null,
                outcome: result.success === false ? "failed" : "success",
                agentReasoning: result.message ? String(result.message) : null,
              },
            }),
          )
          .catch((e) =>
            console.warn("Failed to log recovery action in merchant DB:", e),
          );
      }

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      console.error(`❌ Tool execution failed [${tool}]:`, err);
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

      console.log(
        `\n🏁 MCP job ${jobId} complete | action=${actionType} | outcome=${outcome}`,
      );
      if (agentReasoning) {
        console.log(`   AI's reasoning: ${agentReasoning}`);
      }
      if (notificationContent) {
        console.log(`   Notification content:\n${notificationContent}`);
      }
    } catch (err) {
      console.error("Error updating merchant DB after job complete:", err);
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
    console.error(`❌ Failed to post tool result for job ${jobId}:`, err);
  }
}

export const mcpCallbackController = new McpCallbackController();
