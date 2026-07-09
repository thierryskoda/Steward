/**
 * Schema for per-project runtime endpoint.json. Used by endpoint-file and e2e scripts.
 */
import { z } from "zod";

export const EndpointSchema = z.object({
  host: z.string(),
  port: z.number(),
});
export type IEndpoint = z.infer<typeof EndpointSchema>;
