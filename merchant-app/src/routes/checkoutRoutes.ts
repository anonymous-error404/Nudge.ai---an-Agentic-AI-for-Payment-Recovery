import { Router } from "express";
import { checkoutController } from "../controllers/checkoutController";

const router = Router();

router.post("/api/checkout", checkoutController.checkout.bind(checkoutController));
router.post(
  "/api/checkout/simulate",
  checkoutController.simulateCheckout.bind(checkoutController),
);
router.get(
  "/api/orders/retry/:token",
  checkoutController.getOrderByRetryToken.bind(checkoutController),
);
router.get(
  "/api/payment/:razorpayPaymentId/status",
  checkoutController.getPaymentStatus.bind(checkoutController),
);
router.post(
  "/api/payment/verify",
  checkoutController.verifyPayment.bind(checkoutController),
);
router.post(
  "/api/payment/failed",
  checkoutController.handlePaymentFailed.bind(checkoutController),
);

export default router;
