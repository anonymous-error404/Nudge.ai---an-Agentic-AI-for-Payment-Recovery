import { Router } from "express";
import { prisma } from "../lib/prismaClient";

const router = Router();

/**
 * GET /api/products
 * Returns all products for the storefront (used by the frontend JS).
 */
router.get("/api/products", async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: "asc" },
    });
    res.json({ success: true, data: products });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ success: false, error: "Failed to fetch products" });
  }
});

/**
 * GET /api/products/:id
 * Returns a single product.
 */
router.get("/api/products/:id", async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
    });
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }
    res.json({ success: true, data: product });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ success: false, error: "Failed to fetch product" });
  }
});

/**
 * GET /api/orders
 * Returns all orders with their payments and failure events (for the admin/agent view).
 */
router.get("/api/orders", async (_req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        customer: true,
        product: true,
        payments: {
          include: { failureEvents: { include: { recoveryActions: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ success: false, error: "Failed to fetch orders" });
  }
});

/**
 * GET /api/failure-events
 * Returns all failure events with recovery actions — primary data source for the recovery agent.
 */
router.get("/api/failure-events", async (_req, res) => {
  try {
    const events = await prisma.failureEvent.findMany({
      include: {
        payment: {
          include: {
            order: { include: { customer: true, product: true } },
          },
        },
        recoveryActions: { orderBy: { attemptNumber: "asc" } },
      },
      orderBy: { detectedAt: "desc" },
    });
    res.json({ success: true, data: events });
  } catch (err) {
    console.error("Error fetching failure events:", err);
    res.status(500).json({ success: false, error: "Failed to fetch failure events" });
  }
});

/**
 * GET /api/customers
 * Returns all customers.
 */
router.get("/api/customers", async (_req, res) => {
  try {
    const customers = await prisma.customer.findMany();
    res.json({ success: true, data: customers });
  } catch (err) {
    console.error("Error fetching customers:", err);
    res.status(500).json({ success: false, error: "Failed to fetch customers" });
  }
});

export default router;
