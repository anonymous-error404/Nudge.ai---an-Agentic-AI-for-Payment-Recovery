import { Router, Request, Response } from "express";
import { prisma } from "../lib/prismaClient";

const router = Router();

declare module "express-session" {
  interface SessionData {
    user: { id: string; role: string; name: string; email: string };
  }
}

router.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.customer.findUnique({ where: { email } });

    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    req.session.user = {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    };

    res.json({ success: true, user: req.session.user });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/api/auth/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.get("/api/auth/me", (req: Request, res: Response) => {
  if (req.session.user) {
    res.json({ success: true, user: req.session.user });
  } else {
    res.json({ success: false, user: null });
  }
});

router.get("/api/auth/my-orders", async (req: Request, res: Response) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }
  
  try {
    const orders = await prisma.order.findMany({
      where: { customerId: req.session.user.id },
      include: { product: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// ── Register ──────────────────────────────────────────────────────────────────
router.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password, notificationPreferences } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, error: "name, email, phone, and password are required" });
    }

    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ success: false, error: "An account with this email already exists" });
    }

    const user = await prisma.customer.create({
      data: {
        name,
        email,
        phone,
        password,
        role: "customer",
        notificationPreferences: notificationPreferences || "email,sms",
      },
    });

    req.session.user = { id: user.id, role: user.role, name: user.name, email: user.email };
    res.json({ success: true, user: req.session.user });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ── Token-based auto-login (for retry links in recovery emails) ───────────────
router.post("/api/auth/token-login", async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: "token is required" });
    }

    const order = await prisma.order.findUnique({
      where: { retryToken: token },
      include: { customer: true },
    });

    if (!order) {
      return res.status(404).json({ success: false, error: "Invalid retry link" });
    }
    if (order.status === "paid") {
      return res.status(400).json({ success: false, error: "This order has already been paid" });
    }

    const { customer } = order;
    req.session.user = { id: customer.id, role: customer.role, name: customer.name, email: customer.email };
    res.json({ success: true, customer: { id: customer.id, name: customer.name, email: customer.email } });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
