import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import shopRouter from "./routes/shop";
import checkoutRouter from "./routes/checkout";
import webhookRouter from "./routes/webhook";
import devSimulatorRouter from "./routes/failureSimulatorRoutes";

const app = express();
const PORT = process.env.PORT ?? 3000;

// ─── Raw body capture (MUST be before any body-parsing middleware) ─────────────
// Razorpay webhook signature verification requires the raw request body.
// We capture it here and attach it to req.rawBody.
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { rawBody?: Buffer }).rawBody = req.body as Buffer;
    next();
  }
);

// ─── Standard body parsing for all other routes ──────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "..", "public")));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use(webhookRouter);        // /webhook/razorpay
app.use(shopRouter);           // /api/products, /api/orders, /api/failure-events, /api/customers
app.use(checkoutRouter);       // /api/checkout, /api/payment/*
app.use(devSimulatorRouter);   // /api/dev/simulate-failure, /api/dev/failure-scenarios

// ─── SPA fallback for HTML pages ─────────────────────────────────────────────
app.get("/product", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "product.html"));
});
app.get("/success", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "success.html"));
});
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Mock Merchant App running at http://localhost:${PORT}`);
  console.log(`   Storefront:     http://localhost:${PORT}/`);
  console.log(`   Admin panel:    http://localhost:${PORT}/admin`);
  console.log(`   Webhook URL:    http://localhost:${PORT}/webhook/razorpay`);
  console.log(`   API docs:       http://localhost:${PORT}/api/products\n`);
});

export default app;
