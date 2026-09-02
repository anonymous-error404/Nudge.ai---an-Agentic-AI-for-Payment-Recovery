import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import shopRouter from "./routes/shopRoutes";
import checkoutRouter from "./routes/checkoutRoutes";
import webhookRouter from "./routes/webhookRoutes";
import mcpCallbackRouter from "./routes/mcpCallbackRoutes";
import authRouter from "./routes/authRoutes";
import session from "express-session";

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

// ─── Session middleware ───────────────────────────────────────────────────────
app.use(
  session({
    secret: "super-secret-key-for-demo",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 1 day
  })
);

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "..", "public")));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use(authRouter);
app.use(webhookRouter);        // /webhook/razorpay
app.use(shopRouter);           // /api/products, /api/orders, /api/failure-events, /api/customers
app.use(checkoutRouter);       // /api/checkout, /api/payment/*
app.use(mcpCallbackRouter);    // /mcp/tool-call, /mcp/job-complete

// ─── SPA fallback for HTML pages ─────────────────────────────────────────────
app.get("/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "login.html"));
});
app.get("/product", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "product.html"));
});
app.get("/orders", (req, res) => {
  if (!req.session.user || req.session.user.role === "admin") {
    return res.redirect("/login");
  }
  res.sendFile(path.join(__dirname, "..", "public", "orders.html"));
});
app.get("/success", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "success.html"));
});
app.get("/admin", (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/login");
  }
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});
app.get("/retry", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "retry.html"));
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
