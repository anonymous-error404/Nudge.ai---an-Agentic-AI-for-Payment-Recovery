import { Request, Response } from "express";
import { recoveryJobService } from "../services/recoveryJobService";
import { RecoveryJobSchema } from "../services/validationSchemas";

class RecoveryJobsController {
  async submitJob(req: Request, res: Response) {
    const parsed = RecoveryJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: parsed.error.flatten() });
    }

    try {
      const result = await recoveryJobService.submitJob(parsed.data);
      const status = result.isNew ? 202 : 200;
      return res.status(status).json({ success: true, ...result });
    } catch (err) {
      console.error("Error submitting recovery job:", err);
      return res.status(500).json({ success: false, error: String(err) });
    }
  }

  async getJobStatus(req: Request, res: Response) {
    try {
      const jobId = String(req.params.jobId);
      const status = await recoveryJobService.getJobStatus(jobId);
      if (!status) {
        return res.status(404).json({ success: false, error: "Job not found" });
      }
      return res.json({ success: true, data: status });
    } catch (err) {
      console.error("Error fetching job status:", err);
      return res.status(500).json({ success: false, error: String(err) });
    }
  }

  async getAudit(req: Request, res: Response) {
    try {
      const merchantId =
        typeof req.query.merchantId === "string"
          ? req.query.merchantId
          : undefined;
      const data = await recoveryJobService.getAuditData(merchantId);
      return res.json({ success: true, data });
    } catch (err) {
      console.error("Error fetching audit data:", err);
      return res.status(500).json({ success: false, error: String(err) });
    }
  }
}

export const recoveryJobsController = new RecoveryJobsController();

