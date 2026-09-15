import bcrypt from "bcryptjs";

export async function hashPassword(password: string) {
  if (Buffer.byteLength(password, 'utf8') > 72) throw Object.assign(new Error('Use a password of at most 72 UTF-8 bytes.'), {safeCode:'PASSWORD_TOO_LONG',safeStatus:400});
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
