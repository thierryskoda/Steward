import type { JsonSchema7Type } from "zod-to-json-schema";

/** Provider-neutral JSON Schema generated from a canonical Zod contract. */
export type IJsonSchema = JsonSchema7Type & {
  $schema?: string;
};
