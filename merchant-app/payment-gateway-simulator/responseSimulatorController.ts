import { Request, Response } from "express";
import { responseSimulatorService } from "./responseSimulatorService";

class ResponseSimulatorController {
  getFailureScenarios(req: Request, res: Response) {
    res.json({
      success: true,
      data: responseSimulatorService.getScenarios(),
    });
  }

  async simulateGatewayResponse(req: Request, res: Response) {
    const { productId, customerId, outcome, scenarioKey } = req.body as {
      productId?: string;
      customerId?: string;
      outcome?: "success" | "fail";
      scenarioKey?: string;
    };

    if (!productId || !customerId || !outcome) {
      return res.status(400).json({
        success: false,
        error: "productId, customerId, and outcome are required",
      });
    }

    if (!["success", "fail"].includes(outcome)) {
      return res
        .status(400)
        .json({ success: false, error: "outcome must be 'success' or 'fail'" });
    }

    try {
      const result = await responseSimulatorService.simulateGatewayResponse({
        productId,
        customerId,
        outcome: outcome as "success" | "fail",
        scenarioKey,
      });
      res.json({ success: true, data: result });
    } catch (err: any) {
      console.error("Error in simulateGatewayResponse:", err);
      const status =
        err.message.includes("not found") ||
        err.message.includes("required") ||
        err.message.includes("out of stock")
          ? 400
          : 500;
      res.status(status).json({ success: false, error: err.message });
    }
  }
}

export const responseSimulatorController = new ResponseSimulatorController();
