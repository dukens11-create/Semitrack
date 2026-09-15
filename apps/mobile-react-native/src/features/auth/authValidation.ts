import { z } from 'zod';

export type AuthFieldErrors = {
  name?: string;
  email?: string;
  password?: string;
};

// Match the existing API contract; never trim or silently truncate passwords.
export function emailError(value: string): string | undefined {
  return z.string().email().safeParse(value.trim()).success
    ? undefined
    : 'Enter a valid email';
}
export function validateAuth(
  register: boolean,
  name: string,
  email: string,
  password: string,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  if (register && name.trim().length < 2) errors.name = 'Enter your full name';
  else if (register && name.trim().length > 120)
    errors.name = 'Use no more than 120 characters';
  const invalidEmail = emailError(email);
  if (invalidEmail) errors.email = invalidEmail;
  if (!password.length)
    errors.password = register
      ? 'Use at least 10 characters'
      : 'Enter your password';
  else if (register && password.length < 10)
    errors.password = 'Use at least 10 characters';
  else if (register && password.length > 128)
    errors.password = 'Use no more than 128 characters';
  return errors;
}
