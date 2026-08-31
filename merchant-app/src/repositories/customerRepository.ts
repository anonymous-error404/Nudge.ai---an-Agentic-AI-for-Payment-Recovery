import { prisma } from "../lib/prismaClient";

export class CustomerRepository {
  async findAll() {
    return prisma.customer.findMany();
  }

  async findById(id: string) {
    return prisma.customer.findUnique({ where: { id } });
  }
}

export const customerRepository = new CustomerRepository();
