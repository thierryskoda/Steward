import { z } from "zod";

const INDEX_VERSION = 1;

export const continualLearningTranscriptEntrySchema = z.object({
  lastProcessedSize: z.number().int().min(0),
  lastProcessedAt: z.string().min(1),
});

export const continualLearningIndexSchema = z.object({
  version: z.literal(INDEX_VERSION),
  transcripts: z.record(z.string(), continualLearningTranscriptEntrySchema),
});

export type IContinualLearningTranscriptEntry = z.infer<
  typeof continualLearningTranscriptEntrySchema
>;
export type IContinualLearningIndex = z.infer<typeof continualLearningIndexSchema>;
