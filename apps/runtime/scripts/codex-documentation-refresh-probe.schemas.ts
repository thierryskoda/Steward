import { z } from "zod";

export const codexPromptInputSchema = z.array(
  z
    .object({
      type: z.string(),
      role: z.string().optional(),
      content: z
        .array(
          z
            .object({
              type: z.string(),
              text: z.string().optional(),
            })
            .passthrough()
        )
        .optional(),
    })
    .passthrough()
);

export const documentationRefreshProbeResultSchema = z
  .object({
    skill: z.literal("skod-skills:documentation-refresh-sweeper"),
    status: z.literal("drift"),
    checkedFiles: z.array(z.string()).min(2).max(10),
    drift: z
      .object({
        file: z.literal("README.md"),
        claim: z.string().min(1).max(500),
        authority: z.literal("package.json"),
        correction: z.string().min(1).max(500),
      })
      .strict(),
    changedFiles: z.array(z.string()).max(0),
  })
  .strict();

export const DOCUMENTATION_REFRESH_PROBE_JSON_SCHEMA = {
  type: "object",
  properties: {
    skill: { type: "string", const: "skod-skills:documentation-refresh-sweeper" },
    status: { type: "string", const: "drift" },
    checkedFiles: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 10,
    },
    drift: {
      type: "object",
      properties: {
        file: { type: "string", const: "README.md" },
        claim: { type: "string", minLength: 1, maxLength: 500 },
        authority: { type: "string", const: "package.json" },
        correction: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["file", "claim", "authority", "correction"],
      additionalProperties: false,
    },
    changedFiles: {
      type: "array",
      items: { type: "string" },
      maxItems: 0,
    },
  },
  required: ["skill", "status", "checkedFiles", "drift", "changedFiles"],
  additionalProperties: false,
} as const;
