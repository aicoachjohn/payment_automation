/**
 * Zod schemas shared between client and server (the validation boundary). Server
 * validation is the control; client validation is convenience only. FR-SEC-27+.
 */
import { z } from "zod";
import { Role } from "@prisma/client";
import { PASSWORD_POLICY } from "@/lib/constants";

const strongPassword = z
  .string()
  .min(PASSWORD_POLICY.minLength, PASSWORD_POLICY.message)
  .regex(/[A-Z]/, PASSWORD_POLICY.message)
  .regex(/[0-9]/, PASSWORD_POLICY.message)
  .regex(/[^A-Za-z0-9]/, PASSWORD_POLICY.message);

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const otpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: strongPassword,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: strongPassword,
});

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^(\+?\d{1,3}[- ]?)?\d{10}$/, "Enter a valid 10-digit mobile number.");

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the user's name."),
  email: emailSchema,
  mobile: mobileSchema,
  role: z.nativeEnum(Role),
  isBreakGlass: z.boolean().optional().default(false),
});

export const updateUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.nativeEnum(Role),
});

export const userIdSchema = z.object({ userId: z.string().min(1) });
