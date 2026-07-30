import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  DocumentationRefreshStatusSchema,
  FindingShortLabelSchema,
  type IDocumentationRefreshStatus,
} from "@steward/contracts/schemas";

export { DocumentationRefreshStatusSchema };
export type { IDocumentationRefreshStatus };

export const DocumentationRefreshRunKindSchema = z.enum(["baseline", "incremental"]);
export type IDocumentationRefreshRunKind = z.infer<typeof DocumentationRefreshRunKindSchema>;

export const DocumentationRefreshRelativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((path) => !isAbsolute(path), "Path must be relative to the project root")
  .refine(
    (path) => !path.replaceAll("\\", "/").split("/").includes(".."),
    "Path must remain inside the project root"
  );

export const DocumentationRefreshScopedContentHashSchema = z
  .object({
    path: DocumentationRefreshRelativePathSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const DocumentationRefreshEvidenceSchema = z
  .object({
    checkedPaths: z.array(DocumentationRefreshRelativePathSchema).max(100),
    summary: z.string().min(1).max(4_000),
    verificationCommands: z.array(z.string().min(1).max(500)).max(10),
    uncertainties: z.array(z.string().min(1).max(1_000)).max(20),
  })
  .strict();

export type IDocumentationRefreshEvidence = z.infer<typeof DocumentationRefreshEvidenceSchema>;

const documentationRefreshTextSchema = z.string().min(1).max(1_500);
const documentationRefreshUncertaintySchema = z.string().min(1).max(1_000);

export const DocumentationRefreshAgentInputSchema = z
  .object({
    kind: DocumentationRefreshRunKindSchema,
    inputFingerprint: z.string().regex(/^[a-f0-9]{32,64}$/),
    headSha: z
      .string()
      .regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/)
      .nullable(),
    baselineCursor: DocumentationRefreshRelativePathSchema.nullable(),
    changedPaths: z.array(DocumentationRefreshRelativePathSchema).max(100),
    documentationPaths: z.array(DocumentationRefreshRelativePathSchema).max(25),
    scopedContentHashes: z.array(DocumentationRefreshScopedContentHashSchema).max(500),
  })
  .strict();

export type IDocumentationRefreshAgentInput = z.infer<typeof DocumentationRefreshAgentInputSchema>;

const DocumentationRefreshVerifiedClaimSchema = z
  .object({
    documentPath: DocumentationRefreshRelativePathSchema,
    claim: documentationRefreshTextSchema,
    authorityPath: DocumentationRefreshRelativePathSchema,
    evidence: documentationRefreshTextSchema,
  })
  .strict();

const DocumentationRefreshCommandEvidenceSchema = z
  .object({
    command: z.string().min(1).max(500),
    outcome: documentationRefreshTextSchema,
  })
  .strict();

export const DocumentationRefreshReportSchema = z
  .object({
    title: FindingShortLabelSchema,
    humanSummary: z.string().min(1).max(800),
    humanCurrentBehavior: z.string().min(1).max(1_500),
    humanWhyItMatters: z.string().min(1).max(1_500),
    humanEvidence: z.array(z.string().min(1).max(240)).min(1).max(3),
    humanDecisionQuestion: z.string().min(1).max(500),
    locations: z.array(DocumentationRefreshRelativePathSchema).min(1).max(25),
    recommendation: z
      .object({
        title: FindingShortLabelSchema,
        humanSummary: z.string().min(1).max(800),
        technicalPlan: z.string().min(1).max(2_000),
      })
      .strict(),
  })
  .strict();

export type IDocumentationRefreshReport = z.infer<typeof DocumentationRefreshReportSchema>;

const documentationRefreshAgentEvidenceShape = {
  summary: z.string().min(1).max(2_000),
  documentCount: z.number().int().min(0).max(25),
  checkedDocumentPaths: z.array(DocumentationRefreshRelativePathSchema).max(25),
  checkedAuthorityPaths: z.array(DocumentationRefreshRelativePathSchema).max(50),
  verifiedClaims: z.array(DocumentationRefreshVerifiedClaimSchema).max(50),
  commandsRun: z.array(DocumentationRefreshCommandEvidenceSchema).max(10),
} as const;

const DocumentationRefreshCleanOutputSchema = z
  .object({
    status: z.literal("clean"),
    ...documentationRefreshAgentEvidenceShape,
    uncertainties: z.array(documentationRefreshUncertaintySchema).max(0),
  })
  .strict();

const DocumentationRefreshDriftOutputSchema = z
  .object({
    status: z.literal("drift"),
    ...documentationRefreshAgentEvidenceShape,
    uncertainties: z.array(documentationRefreshUncertaintySchema).max(20),
    report: DocumentationRefreshReportSchema,
  })
  .strict();

const DocumentationRefreshBlockedOutputSchema = z
  .object({
    status: z.literal("blocked"),
    ...documentationRefreshAgentEvidenceShape,
    uncertainties: z.array(documentationRefreshUncertaintySchema).min(1).max(20),
    blocker: z.string().min(1).max(2_000),
    nextAction: z.string().min(1).max(1_000),
    report: DocumentationRefreshReportSchema,
  })
  .strict();

export const DocumentationRefreshAgentOutputSchema = z
  .discriminatedUnion("status", [
    DocumentationRefreshCleanOutputSchema,
    DocumentationRefreshDriftOutputSchema,
    DocumentationRefreshBlockedOutputSchema,
  ])
  .superRefine((output, context) => {
    if (output.documentCount !== output.checkedDocumentPaths.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "documentCount must equal checkedDocumentPaths length",
        path: ["documentCount"],
      });
    }
    if (new Set(output.checkedDocumentPaths).size !== output.checkedDocumentPaths.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "checkedDocumentPaths must not contain duplicates",
        path: ["checkedDocumentPaths"],
      });
    }
  });

export type IDocumentationRefreshAgentOutput = z.infer<
  typeof DocumentationRefreshAgentOutputSchema
>;

export const DocumentationRefreshRunSchema = z
  .object({
    id: z.string().uuid(),
    kind: DocumentationRefreshRunKindSchema,
    inputFingerprint: z.string().regex(/^[a-f0-9]{32,64}$/),
    headSha: z
      .string()
      .regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/)
      .nullable(),
    scopedContentHashes: z.array(DocumentationRefreshScopedContentHashSchema).max(500),
    status: DocumentationRefreshStatusSchema,
    baselineCursor: DocumentationRefreshRelativePathSchema.nullable(),
    attemptCount: z.number().int().min(0).max(2),
    evidence: DocumentationRefreshEvidenceSchema.nullable(),
    findingId: z.string().min(1).nullable(),
    leaseObservedAt: z.number().int().nonnegative().nullable(),
    stopReason: z.string().min(1).max(1_000).nullable(),
    blocker: z.string().min(1).max(4_000).nullable(),
    nextAction: z.string().min(1).max(1_000).nullable(),
    startedAt: z.number().int().nonnegative().nullable(),
    completedAt: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type IDocumentationRefreshRun = z.infer<typeof DocumentationRefreshRunSchema>;
