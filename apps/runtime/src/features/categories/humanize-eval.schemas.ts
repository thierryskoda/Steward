/**
 * Zod schemas for humanize-category eval fixtures. Used by the eval script to validate
 * fixture JSON and type the input/expected shapes.
 */
import { z } from "zod";

const OptionInputSchema = z.object({
  id: z.enum(["A", "B"]),
  name: z.string(),
  technicalPlan: z.string(),
});

const OptionExpectedSchema = z.object({
  id: z.enum(["A", "B"]),
  humanSummary: z.string().min(1),
  humanChooseThisIf: z.string().min(1),
  humanTradeoff: z.string().min(1),
});

export const HumanizeEvalFixtureInputSchema = z.object({
  categoryId: z.string(),
  title: z.string(),
  finding: z.string(),
  locations: z.array(z.string()).min(1),
  options: z.array(OptionInputSchema).min(2),
});

export const HumanizeEvalFixtureExpectedSchema = z.object({
  humanSummary: z.string().min(1),
  humanCurrentBehavior: z.string().min(1),
  humanWhyItMatters: z.string().min(1),
  humanEvidence: z.array(z.string().min(1)).min(1).max(3),
  humanDecisionQuestion: z.string().min(1),
  options: z.array(OptionExpectedSchema).min(1),
});

export const HumanizeEvalFixtureSchema = z.object({
  id: z.string().optional(),
  input: HumanizeEvalFixtureInputSchema,
  expected: HumanizeEvalFixtureExpectedSchema,
});

export const HumanizeEvalFixturesSchema = z.array(HumanizeEvalFixtureSchema);

export type IHumanizeEvalFixture = z.infer<typeof HumanizeEvalFixtureSchema>;
export type IHumanizeEvalFixtureInput = z.infer<typeof HumanizeEvalFixtureInputSchema>;
export type IHumanizeEvalFixtureExpected = z.infer<typeof HumanizeEvalFixtureExpectedSchema>;
