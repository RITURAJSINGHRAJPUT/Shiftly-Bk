import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client.
 *
 * Each route module used to construct its own, which opened one connection
 * pool per file. Import this instead.
 */
export const prisma = new PrismaClient();

export default prisma;
