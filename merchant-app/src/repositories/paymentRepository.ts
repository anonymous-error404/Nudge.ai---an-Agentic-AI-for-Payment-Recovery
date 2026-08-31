import { prisma } from "../lib/prismaClient";
import { UpsertPaymentParams } from "../types";

export class PaymentRepository {
  async upsertPayment(params: UpsertPaymentParams) {
    if (params.razorpayPaymentId) {
      return prisma.payment.upsert({
        where: { razorpayPaymentId: params.razorpayPaymentId },
        update: {
          status: params.status,
          errorCode: params.errorCode,
          errorReason: params.errorReason,
          errorSource: params.errorSource,
          errorStep: params.errorStep,
          errorDescription: params.errorDescription,
          method: params.method,
        },
        create: {
          orderId: params.orderId,
          razorpayPaymentId: params.razorpayPaymentId,
          status: params.status,
          method: params.method,
          errorCode: params.errorCode,
          errorReason: params.errorReason,
          errorSource: params.errorSource,
          errorStep: params.errorStep,
          errorDescription: params.errorDescription,
        },
      });
    }

    return prisma.payment.create({
      data: {
        orderId: params.orderId,
        razorpayPaymentId: null,
        status: params.status,
        method: params.method,
        errorCode: params.errorCode,
        errorReason: params.errorReason,
        errorSource: params.errorSource,
        errorStep: params.errorStep,
        errorDescription: params.errorDescription,
      },
    });
  }
}

export const paymentRepository = new PaymentRepository();
