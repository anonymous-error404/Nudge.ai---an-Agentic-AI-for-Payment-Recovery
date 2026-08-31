import { Request, Response } from "express";
import { productRepository } from "../repositories/productRepository";
import { orderRepository } from "../repositories/orderRepository";
import { failureEventRepository } from "../repositories/failureEventRepository";
import { customerRepository } from "../repositories/customerRepository";

class ShopController {
  async getProducts(req: Request, res: Response) {
    try {
      const products = await productRepository.findAll();
      res.json({ success: true, data: products });
    } catch (err) {
      console.error("Error fetching products:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch products" });
    }
  }

  async getProductById(req: Request, res: Response) {
    try {
      const product = await productRepository.findById(req.params.id);
      if (!product) {
        return res
          .status(404)
          .json({ success: false, error: "Product not found" });
      }
      res.json({ success: true, data: product });
    } catch (err) {
      console.error("Error fetching product:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch product" });
    }
  }

  async getOrders(req: Request, res: Response) {
    try {
      const orders = await orderRepository.findAllWithDetails();
      res.json({ success: true, data: orders });
    } catch (err) {
      console.error("Error fetching orders:", err);
      res.status(500).json({ success: false, error: "Failed to fetch orders" });
    }
  }

  async getFailureEvents(req: Request, res: Response) {
    try {
      const events = await failureEventRepository.findAll();
      res.json({ success: true, data: events });
    } catch (err) {
      console.error("Error fetching failure events:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch failure events" });
    }
  }

  async getCustomers(req: Request, res: Response) {
    try {
      const customers = await customerRepository.findAll();
      res.json({ success: true, data: customers });
    } catch (err) {
      console.error("Error fetching customers:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch customers" });
    }
  }
}

export const shopController = new ShopController();
