import { z } from "zod";

export const DOCUMENTATION_REFRESH_LEASE_VERSION = 1;

export const DocumentationRefreshLeaseSchema = z
  .object({
    version: z.literal(DOCUMENTATION_REFRESH_LEASE_VERSION),
    ownerId: z.string().min(1).max(200),
    projectKey: z.string().min(1).max(100),
    runId: z.string().uuid(),
    pid: z.number().int().positive(),
    acquiredAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .refine((lease) => lease.expiresAt > lease.acquiredAt, {
    message: "Lease expiry must be after acquisition",
    path: ["expiresAt"],
  });

export type IDocumentationRefreshLease = z.infer<typeof DocumentationRefreshLeaseSchema>;
