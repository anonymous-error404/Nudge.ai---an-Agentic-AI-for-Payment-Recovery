import { Router } from "express";
import { failureSimulatorController } from "../controllers/failureSimulatorController";

const router = Router();

router.post(
  "/api/dev/simulate-failure",
  failureSimulatorController.simulate_failure.bind(failureSimulatorController),
);
router.get(
  "/api/dev/failure-scenarios",
  failureSimulatorController.getFailureScenarios.bind(
    failureSimulatorController,
  ),
);

export default router;
