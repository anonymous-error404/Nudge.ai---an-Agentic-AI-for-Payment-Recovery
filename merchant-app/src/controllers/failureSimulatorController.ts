import { Request, Response } from "express";
import { failureSimulatorService } from "../services/failureSimulatorService";

class FailureSimulatorController {
  async simulate_failure(req: Request, res: Response) {
    const { failureType, customerId, productId } = req.body as {
      failureType?: string;
      customerId?: string;
      productId?: string;
    };

    if (!failureType) {
      return res
        .status(400)
        .json({ success: false, error: "failureType is required" });
    }

    try {
      const result = await failureSimulatorService.simulateFailure(
        failureType,
        customerId,
        productId,
      );
      res.json({ success: true, data: result });
    } catch (err: any) {
      console.error("Simulator error:", err);
      // Determine appropriate status code based on error message
      const status =
        err.message.includes("Unknown failureType") ||
        err.message.includes("not found")
          ? 400
          : 500;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  getFailureScenarios(req: Request, res: Response) {
    res.json({
      success: true,
      data: failureSimulatorService.getScenarios(),
    });
  }
}

export const failureSimulatorController = new FailureSimulatorController();
