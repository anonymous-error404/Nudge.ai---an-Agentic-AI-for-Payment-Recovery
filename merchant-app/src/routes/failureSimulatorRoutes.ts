import { Router } from "express";
import failureSimulatorController from "../controllers/failureSimulatorController";

const router = Router();

router.post(
  "/api/dev/simulate-failure",
  failureSimulatorController.simulate_failure,
);

/**
 * GET /api/dev/failure-scenarios
 * Returns the list of available scenarios (for populating the admin UI).
 */
router.get(
  "/api/dev/failure-scenarios",
  failureSimulatorController.getFailureScenarios,
);

export default router;
