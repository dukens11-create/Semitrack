import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { comparePassword, hashPassword } from '../utils/password.js';

let missingAccountHash: Promise<string> | undefined;
/** Preserve bcrypt compatibility and a generic denial for absent, disabled and mismatched accounts. */
export async function authenticatePassword(db: Pick<PrismaClient, 'user'>, email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  missingAccountHash ??= hashPassword(randomBytes(32).toString('hex'));
  const matches = await comparePassword(password, user?.passwordHash ?? await missingAccountHash);
  return user && !user.disabledAt && matches ? user : null;
}
