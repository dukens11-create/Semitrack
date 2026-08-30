import { z } from "zod";

export const adminAccountUpdateSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  newPassword: z.string().min(12).max(128).optional(),
}).strict().refine(
  (value) => value.fullName !== undefined || value.email !== undefined || value.newPassword !== undefined,
  { message: "An email, name, or password change is required" },
);
