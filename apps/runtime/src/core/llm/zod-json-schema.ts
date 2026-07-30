import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { IJsonSchema } from "./json-schema.types.js";

/** Converts the runtime's canonical Zod contract into the schema providers can enforce. */
export function convertZodSchemaToJsonSchema(schema: z.ZodTypeAny): IJsonSchema {
  return zodToJsonSchema(schema, { $refStrategy: "none" });
}
