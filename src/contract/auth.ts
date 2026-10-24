import * as z from 'zod';

import { idSchema } from './common.js';

export const userRoleSchema = z.enum(['admin', 'manager']);

export const userSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.email(),
  role: userRoleSchema,
});

export const loginRequestSchema = z.object({
  email: z.email({ error: 'Enter a valid email' }),
  password: z.string().min(1, { error: 'Enter your password' }),
});

export const loginResponseSchema = z.object({
  token: z.string().min(1),
  user: userSchema,
});

export type User = z.infer<typeof userSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
