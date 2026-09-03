import { Router } from "express";
import { toolResultsController } from "../controllers/toolResultsController";

const router = Router();

router.post("/api/tool-results", toolResultsController.receiveResult.bind(toolResultsController));

export default router;

