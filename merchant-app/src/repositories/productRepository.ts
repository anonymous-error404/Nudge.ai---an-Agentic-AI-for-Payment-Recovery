import { prisma } from "../lib/prismaClient";

export class ProductRepository {
  async findAll() {
    return prisma.product.findMany({ orderBy: { createdAt: "asc" } });
  }

  async findById(id: string) {
    return prisma.product.findUnique({ where: { id } });
  }
}

export const productRepository = new ProductRepository();
