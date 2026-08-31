import { Router } from "express";
import { shopController } from "../controllers/shopController";

const router = Router();

router.get("/api/products", shopController.getProducts.bind(shopController));
router.get("/api/products/:id", shopController.getProductById.bind(shopController));
router.get("/api/orders", shopController.getOrders.bind(shopController));
router.get("/api/failure-events", shopController.getFailureEvents.bind(shopController));
router.get("/api/customers", shopController.getCustomers.bind(shopController));

export default router;
