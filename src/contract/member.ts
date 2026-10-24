import * as z from 'zod';

import { idSchema, isoDateSchema, pageOf, pageQuerySchema } from './common.js';

export const MEMBER_PLANS = ['day_pass', 'flex', 'dedicated', 'team'] as const;
export const MEMBER_STATUSES = ['active', 'suspended', 'cancelled'] as const;

export const memberPlanSchema = z.enum(MEMBER_PLANS);
export const memberStatusSchema = z.enum(MEMBER_STATUSES);

export const memberSchema = z.object({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  phone: z.string(),
  company: z.string().nullable(),
  plan: memberPlanSchema,
  status: memberStatusSchema,
  joinedAt: isoDateSchema,
});

export const memberPageSchema = pageOf(memberSchema);

export const memberInputSchema = z.object({
  firstName: z.string().trim().min(1, { error: 'Required' }).max(60),
  lastName: z.string().trim().min(1, { error: 'Required' }).max(60),
  // The address is stored in lower case and compared that way, so the schema trims and lowers it:
  // what the API checks for a duplicate is what the form sent.
  email: z
    .string({ error: 'Enter a valid email' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a valid email' })),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, { error: 'Enter a valid phone number' }),
  // No company is `null`; a blank text means the same and is stored as `null`.
  company: z
    .string()
    .trim()
    .max(80)
    .nullable()
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' must become null, which `??` would keep
    .transform((value) => value || null),
  plan: memberPlanSchema,
  status: memberStatusSchema,
});

export const memberListQuerySchema = pageQuerySchema.extend({
  plan: memberPlanSchema.optional(),
  status: memberStatusSchema.optional(),
});

export type Member = z.infer<typeof memberSchema>;
export type MemberInput = z.infer<typeof memberInputSchema>;
export type MemberPlan = z.infer<typeof memberPlanSchema>;
export type MemberStatus = z.infer<typeof memberStatusSchema>;
export type MemberListQuery = z.input<typeof memberListQuerySchema>;

export const memberFullName = (m: Pick<Member, 'firstName' | 'lastName'>) =>
  `${m.firstName} ${m.lastName}`;
