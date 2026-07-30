import { z } from "zod";
import {
  NextCommitmentResultSchema,
  NextCommitmentRunStatusSchema,
  type INextCommitmentResult,
} from "@steward/contracts/schemas";
import { NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT } from "./next-commitment-limits.js";

export { NextCommitmentResultSchema as NextCommitmentAgentOutputSchema };
export type INextCommitmentAgentOutput = INextCommitmentResult;

export const NextCommitmentAgentInputSchema = z
  .object({
    projectRoot: z.string().min(1),
    capturedAt: z.number().int().nonnegative(),
    projectSnapshot: z
      .object({
        headSha: z.string().min(1).nullable(),
        worktreeHash: z.string().min(1),
      })
      .strict(),
    reviewSnapshot: z
      .object({
        workspacePath: z.string().min(1),
        gitStatePath: z.string().min(1),
        includedFileCount: z.number().int().nonnegative(),
        excludedFileCount: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    configuredContextPatterns: z.array(z.string().min(1)).max(50),
    recentTasks: z
      .object({
        manifestPath: z.string().min(1),
        lookbackDays: z.number().int().min(1).max(365),
        manifestTaskCount: z.number().int().min(0).max(NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT),
        eligibleTaskCount: z.number().int().nonnegative(),
        truncated: z.boolean(),
        scanTruncated: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type INextCommitmentAgentInput = z.infer<typeof NextCommitmentAgentInputSchema>;

export const NextCommitmentRunSchema = z
  .object({
    id: z.string().uuid(),
    projectSnapshotHash: z.string().min(1).max(128),
    headSha: z
      .string()
      .regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/)
      .nullable(),
    status: NextCommitmentRunStatusSchema,
    result: NextCommitmentResultSchema.nullable(),
    stopReason: z.string().min(1).max(1_000).nullable(),
    startedAt: z.number().int().nonnegative().nullable(),
    completedAt: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((run, context) => {
    const isResultStatus = ["recommendation", "none", "blocked"].includes(run.status);
    if (isResultStatus && run.result?.status !== run.status) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminal result status must match the run status",
        path: ["result"],
      });
    }
    if (!isResultStatus && run.result !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Non-result run statuses cannot persist an agent result",
        path: ["result"],
      });
    }
  });

export type INextCommitmentRun = z.infer<typeof NextCommitmentRunSchema>;
