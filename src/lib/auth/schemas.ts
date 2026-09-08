import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(200);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(80, "Names are limited to 80 characters");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
