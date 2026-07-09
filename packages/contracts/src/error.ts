import { z } from "zod";

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }),
});

export type IApiError = z.infer<typeof ApiErrorSchema>;

export function parseErrorResponse(body: string): IApiError | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const result = ApiErrorSchema.safeParse(raw);
  return result.success ? result.data : null;
}
