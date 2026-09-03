import { Request, Response } from "express";
import { ToolResultSchema } from "../services/validationSchemas";
import { toolResultService } from "../services/toolResultService";

class ToolResultsController {
  async receiveResult(req: Request, res: Response) {
    const parsed = ToolResultSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.flatten() });
    }

    try {
      const { jobId, result } = parsed.data;
      await toolResultService.publish(jobId, result as Record<string, unknown>);
      return res.status(200).json({ success: true, message: "Result received" });
    } catch (err) {
      console.error("Error publishing tool result:", err);
      return res.status(500).json({ success: false, error: String(err) });
    }
  }
}

export const toolResultsController = new ToolResultsController();

