/**
 * Generates 1–2 implementation options (id, name, technicalPlan) from a finding and constraints. Used in the plan step after a finding is chosen; invoked by generate-category when the user needs to pick an option.
 */
import { z } from "zod";
import {
  ApprovalModeSchema,
  APPROVAL_MODE_ALWAYS_APPROVE,
  DEFAULT_APPROVAL_MODE,
  type IApprovalMode,
} from "@steward/contracts/schemas";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

/** Accept any non-empty name so parse never fails; callers log when not 3-5 words. */
const OptionNameSchema = z.string().trim().min(1);
/** Accept any non-empty plan so parse never fails; callers log when length < 50. */
const TechnicalPlanSchema = z.string().min(1);

/** One-sentence explanation of why this option was oriented this way (constraints + rule intent). */
const RuleConsiderationSchema = z.string().trim().min(1);

const OptionSchema = z.object({
  id: z.enum(["A", "B"]),
  name: OptionNameSchema,
  technicalPlan: TechnicalPlanSchema,
  ruleConsideration: RuleConsiderationSchema,
});

const INPUT_SCHEMA = z.object({
  title: z.string(),
  finding: z.string(),
  locations: z.array(z.string()).min(1),
  implementationConstraints: z.array(z.string().min(1)).min(1),
  approvalMode: ApprovalModeSchema,
  /** Category rule description (from rules-snapshot) so options can cite rule intent in ruleConsideration. */
  ruleContent: z.string(),
  /** Scoped option hints learned from prior outcomes for this category. */
  optionHints: z
    .array(
      z.object({
        antiPattern: z.string(),
        instruction: z.string(),
        confidence: z.number().min(0).max(1),
      })
    )
    .max(3)
    .optional(),
});

const OUTPUT_SCHEMA = z.object({
  options: z.array(OptionSchema).min(1).max(2),
});

type IGenerateOptionsInput = z.infer<typeof INPUT_SCHEMA>;
type IGenerateOptionsOutput = z.infer<typeof OUTPUT_SCHEMA>;
type IFewShotExample = {
  heading: string;
  input: IGenerateOptionsInput;
  output: IGenerateOptionsOutput;
};

const DEFAULT_EXAMPLE_CONSTRAINTS = [
  "Keep minimal abstractions.",
  "No new barrel files.",
  "Preserve existing behavior.",
];

const DEFAULT_EXAMPLE_RULE_CONTENT =
  "Keep minimal abstractions. No new barrel files. Preserve existing behavior.";

function parseExampleInput(
  mode: IApprovalMode,
  overrides: Pick<IGenerateOptionsInput, "title" | "finding" | "locations"> &
    Partial<Pick<IGenerateOptionsInput, "implementationConstraints" | "ruleContent">>
): IGenerateOptionsInput {
  return INPUT_SCHEMA.parse({
    approvalMode: mode,
    ...overrides,
    implementationConstraints: overrides.implementationConstraints ?? DEFAULT_EXAMPLE_CONSTRAINTS,
    ruleContent: overrides.ruleContent ?? DEFAULT_EXAMPLE_RULE_CONTENT,
  });
}

const FEW_SHOT_EXAMPLES_TRUST_AI: IFewShotExample[] = [
  {
    heading: "Example 1 (NO material strategy difference -> exactly 1 option)",
    input: parseExampleInput(DEFAULT_APPROVAL_MODE, {
      title: "runStructuredAgent parse-then-recover flow has no guiding intent comment",
      finding:
        "Flow is non-obvious; candidate options are inline intent comments vs extracting a single-use helper.",
      locations: ["apps/runtime/src/core/llm/run-structured.agent.ts"],
    }),
    output: OUTPUT_SCHEMA.parse({
      options: [
        {
          id: "A",
          name: "Add in-place intent comments",
          technicalPlan:
            "1. Edit apps/runtime/src/core/llm/run-structured.agent.ts and add short intent comments above the parse-then-recover block and above the recovery catch path. 2. Keep behavior unchanged: no new function extraction, no new helpers, no signature changes. 3. Ensure comments explain why recovery happens (extract null or invalid JSON) without restating obvious lines. 4. Keep file structure stable and formatting consistent.",
          ruleConsideration:
            "Minimal-change constraint and rule to preserve existing behavior favor in-place comments over extracting a new helper.",
        },
      ],
    }),
  },
  {
    heading:
      "Example 2 (minor scope variant is NOT a real strategy difference -> exactly 1 option)",
    input: parseExampleInput(DEFAULT_APPROVAL_MODE, {
      title: "One agent file breaks naming convention",
      finding:
        "Rename outlier file from -agent.ts to .agent.ts; candidate options are rename-only vs rename plus extra guard script.",
      locations: ["apps/runtime/src/core/llm/run-workspace-mutation.agent.ts"],
    }),
    output: OUTPUT_SCHEMA.parse({
      options: [
        {
          id: "A",
          name: "Rename outlier file imports",
          technicalPlan:
            "1. Rename the outlier file to the standard .agent.ts naming form in the same directory. 2. Update all direct imports referencing the old filename to the new filename. 3. Do not add enforcement scripts or broader workflow changes in this fix because the finding scope is naming consistency, not policy enforcement. 4. Keep the change minimal and verify no unresolved import paths remain.",
          ruleConsideration:
            "Constraints to keep minimal abstractions and avoid new barrel/guard scripts led to rename-only.",
        },
      ],
    }),
  },
  {
    heading: "Example 3 (material unresolved strategy choice -> 2 options allowed)",
    input: parseExampleInput(DEFAULT_APPROVAL_MODE, {
      title: "Large migration may impact production latency",
      finding:
        "Need to migrate a hot-path data shape; two viable paths are immediate cutover vs phased dual-write rollout.",
      locations: ["apps/runtime/src/core/*"],
    }),
    output: OUTPUT_SCHEMA.parse({
      options: [
        {
          id: "A",
          name: "Immediate cutover migration",
          technicalPlan:
            "1. Implement the new schema read/write path directly and remove the legacy path in one release unit. 2. Add strict validation and fail-fast errors at boundaries. 3. Backfill existing persisted records before deploy and verify all readers are upgraded. 4. Keep rollback as full release rollback only.",
          ruleConsideration:
            "Option for teams that can accept a single cutover and full rollback; constraints allow strict validation.",
        },
        {
          id: "B",
          name: "Phased dual-write migration",
          technicalPlan:
            "1. Add dual-write to old and new schema while reads remain on old format initially. 2. Add a verification pass that compares old/new outputs and logs mismatches. 3. Switch reads to new schema after mismatch rate is zero for a stable window, then remove old path in a follow-up change. 4. Keep a temporary rollback path during phase transition.",
          ruleConsideration:
            "Option for teams that need gradual rollout and lower-risk rollback; rule intent allows phased delivery.",
        },
      ],
    }),
  },
];

const FEW_SHOT_EXAMPLES_ALWAYS_APPROVE: IFewShotExample[] = [
  {
    heading: "Example 1 (always 2 options: one obvious fix + meaningful alternative)",
    input: parseExampleInput(APPROVAL_MODE_ALWAYS_APPROVE, {
      title: "runStructuredAgent parse-then-recover flow has no guiding intent comment",
      finding:
        "Flow is non-obvious; candidate options are inline intent comments vs extracting a single-use helper.",
      locations: ["apps/runtime/src/core/llm/run-structured.agent.ts"],
    }),
    output: OUTPUT_SCHEMA.parse({
      options: [
        {
          id: "A",
          name: "Add in-place intent comments",
          technicalPlan:
            "1. Edit apps/runtime/src/core/llm/run-structured.agent.ts and add short intent comments above the parse-then-recover block and above the recovery catch path. 2. Keep behavior unchanged: no new function extraction, no new helpers, no signature changes. 3. Ensure comments explain why recovery happens (extract null or invalid JSON) without restating obvious lines. 4. Keep file structure stable and formatting consistent.",
          ruleConsideration:
            "Minimal-change constraint and rule to preserve existing behavior favor in-place comments.",
        },
        {
          id: "B",
          name: "Extract single-use recovery helper",
          technicalPlan:
            "1. In run-structured.agent.ts extract the parse-then-recover block into a small helper (e.g. parseOrRecover) that returns parsed result or throws. 2. Add intent comment at the call site. 3. Keep behavior unchanged; no new exports or signature changes. 4. Run typecheck and tests.",
          ruleConsideration:
            "Rule allows one small extraction when it improves clarity; alternative for teams that prefer explicit helpers.",
        },
      ],
    }),
  },
  {
    heading: "Example 2 (always 2 options: two strategy choices)",
    input: parseExampleInput(APPROVAL_MODE_ALWAYS_APPROVE, {
      title: "Large migration may impact production latency",
      finding:
        "Need to migrate a hot-path data shape; two viable paths are immediate cutover vs phased dual-write rollout.",
      locations: ["apps/runtime/src/core/*"],
    }),
    output: OUTPUT_SCHEMA.parse({
      options: [
        {
          id: "A",
          name: "Immediate cutover migration",
          technicalPlan:
            "1. Implement the new schema read/write path directly and remove the legacy path in one release unit. 2. Add strict validation and fail-fast errors at boundaries. 3. Backfill existing persisted records before deploy and verify all readers are upgraded. 4. Keep rollback as full release rollback only.",
          ruleConsideration:
            "Option for teams that can accept a single cutover and full rollback; constraints allow strict validation.",
        },
        {
          id: "B",
          name: "Phased dual-write migration",
          technicalPlan:
            "1. Add dual-write to old and new schema while reads remain on old format initially. 2. Add a verification pass that compares old/new outputs and logs mismatches. 3. Switch reads to new schema after mismatch rate is zero for a stable window, then remove old path in a follow-up change. 4. Keep a temporary rollback path during phase transition.",
          ruleConsideration:
            "Option for teams that need gradual rollout and lower-risk rollback; rule intent allows phased delivery.",
        },
      ],
    }),
  },
];

const DECISION_PROCESS_TRUST_AI = `1) Decide optionCount first (1 or 2) before drafting any option content. Default to exactly 1 option.
2) Use 1 option unless there is a real unresolved strategy choice with materially different operational risk or product/business direction.
3) Compare candidate options: if same files, same end state, and only scope/polish differs, collapse to A only.
4) If Option B is only Option A plus extra polish/guard/docs, Option B is forbidden. Options must differ in strategy, not minor scope variants.
5) If rules favor minimal change and no strong counter-rule exists, force exactly 1 option.
6) Only generate a second option when the choice cannot be confidently resolved from context (e.g. "Option A if you plan to have 100 prompts, Option B if you plan to have 4-5 prompts").`;

const DECISION_PROCESS_ALWAYS_APPROVE = `1) Always output exactly 2 options. The user will approve every finding and must see two choices.
2) If there is only one obvious fix, produce Option A = that fix and Option B = a meaningful alternative (e.g. different scope, ordering, or trade-off: minimal change vs slightly broader refactor, inline vs extracted helper, etc.).
3) Options must differ in strategy or approach, not only in polish. Option B cannot be Option A plus extra docs/guards.
4) Both options must be valid and implementable; prefer two defensible strategies over one strong and one weak.`;

const INSTRUCTIONS_OPEN = `Now that you have the finding, locations and constraints from this chat, generate 1–2 distinct implementation options. Do not select a new finding.

### 1. Implementation constraints (must follow when drafting options)

`;

const INSTRUCTIONS_RULE_CONTEXT = `

### 2a. Category rule (for orientation and ruleConsideration)

`;

const INSTRUCTIONS_OPTION_HINTS = `

### 2b. Scoped option hints from prior outcomes

Use these hints when drafting options. They are lower priority than explicit rules/constraints above.

`;

const INSTRUCTIONS_OUTPUT_RULES = `

### 3. Output Quality Rules

Option Array Schema:
- id: "A" | "B" (use A, B in order; use only A if one option suffices)
- name: short label, exactly 3-5 words (e.g. "Delete orphan module")
- technicalPlan: Technical plan for the option.
- ruleConsideration: Exactly one sentence explaining why this option was oriented this way; cite the implementation constraints and/or the category rule above (e.g. which constraint or rule intent led to this choice).

### 4. Few-Shot Examples (Follow decision pattern, not literal wording)

`;

const INSTRUCTIONS_CLOSE = `

### 5. Final Output Execution`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const mode = input.approvalMode;
  const decisionProcess =
    mode === APPROVAL_MODE_ALWAYS_APPROVE
      ? DECISION_PROCESS_ALWAYS_APPROVE
      : DECISION_PROCESS_TRUST_AI;
  const examples =
    mode === APPROVAL_MODE_ALWAYS_APPROVE
      ? FEW_SHOT_EXAMPLES_ALWAYS_APPROVE
      : FEW_SHOT_EXAMPLES_TRUST_AI;
  const fewShotExamplesText = examples
    .map(
      (example: IFewShotExample): string =>
        `${example.heading}
Input:
- title: "${example.input.title}"
- finding: "${example.input.finding}"
- locations: ${JSON.stringify(example.input.locations)}
- implementationConstraints: [${example.input.implementationConstraints.length} items]
Output:
${JSON.stringify(example.output)}`
    )
    .join("\n\n");
  const ruleContextBlock =
    input.ruleContent.trim().length > 0
      ? `${INSTRUCTIONS_RULE_CONTEXT}\`\`\`
${input.ruleContent.trim()}
\`\`\`

`
      : "";
  const optionHintsBlock =
    input.optionHints !== undefined && input.optionHints.length > 0
      ? `${INSTRUCTIONS_OPTION_HINTS}${input.optionHints
          .map(
            (hint) =>
              `- antiPattern: ${hint.antiPattern}\n  instruction: ${hint.instruction}\n  confidence: ${hint.confidence}`
          )
          .join("\n")}

`
      : "";
  return `${INSTRUCTIONS_OPEN}${input.implementationConstraints.map((c) => `- ${c}`).join("\n")}
${ruleContextBlock}${optionHintsBlock}### 2. Decision Process (Must follow in order)

${decisionProcess}${INSTRUCTIONS_OUTPUT_RULES}${fewShotExamplesText}${INSTRUCTIONS_CLOSE}`;
}

export const generateOptionsAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "generate-options",
  description: "Generates 1–2 technical implementation options for a finding",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `{"options":[{"id":"A"|"B","name":"string","technicalPlan":"string","ruleConsideration":"string"},...]}. 1-2 options; name 3-5 words; technicalPlan min 50 chars; ruleConsideration one sentence.`,
};
