import { Router } from "express";
import { responseSimulatorController } from "./responseSimulatorController";

const router = Router();

router.post(
  "/api/checkout/simulate",
  responseSimulatorController.simulateGatewayResponse.bind(responseSimulatorController),
);
router.get(
  "/api/dev/failure-scenarios",
  responseSimulatorController.getFailureScenarios.bind(responseSimulatorController),
);

export default router;
