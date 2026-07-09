import { z } from "zod";

/**
 * Schema for the JSON envelope the Cursor Agent CLI prints to stdout when
 * invoked with --output-format json. Single source of truth for runtime and
 * contract tests (probe, agent-cli-contract).
 */
export const agentCliEnvelopeSchema = z
  .object({
    type: z.string(),
    subtype: z.string().optional(),
    is_error: z.boolean().optional().default(false),
    duration_ms: z.number().optional(),
    duration_api_ms: z.number().optional(),
    result: z.string(),
    session_id: z.string().optional(),
    request_id: z.string().optional(),
  })
  .passthrough();

export type IAgentCliEnvelope = z.infer<typeof agentCliEnvelopeSchema>;
