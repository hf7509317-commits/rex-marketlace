import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
export const db = new PrismaClient();
export class DomainError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
// Retry serialization failures/deadlocks only. Side effects belong in the outbox.
export async function atomic<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 30));
    }
  }
}
