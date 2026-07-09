import type { z } from "zod";

export type IAgentSpec<TInput = unknown, TOutput = unknown> = {
  id: string;
  description: string;
  model: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput, z.ZodTypeDef, unknown>;
  buildPrompt: (input: TInput) => string;
  extractOutput?: (raw: string) => string | null;
  /** Short description of valid output shape for JSON repair. When set, passed as expectedOutputContract instead of the full prompt. */
  outputContractDescription?: string;
};
