import { Router } from "express";
import { recoveryJobsController } from "../controllers/recoveryJobsController";

const router = Router();

router.post("/api/recovery-jobs", recoveryJobsController.submitJob.bind(recoveryJobsController));
router.get("/api/jobs/:jobId/status", recoveryJobsController.getJobStatus.bind(recoveryJobsController));
router.get("/api/audit", recoveryJobsController.getAudit.bind(recoveryJobsController));

export default router;
