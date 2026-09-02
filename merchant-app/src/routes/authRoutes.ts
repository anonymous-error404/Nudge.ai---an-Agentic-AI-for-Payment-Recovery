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

export default router;
