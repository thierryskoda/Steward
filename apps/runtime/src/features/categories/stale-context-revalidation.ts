/**
 * Runs the stale-context revalidation agent for one category item and returns the decision.
 * Used by reactive stale scan and pre-implement gate. Callers apply keep/patch/fail (patch item or move to FAILED).
 */
import { runStructuredAgent } from "../../core/llm/run-structured.agent.js";
import { revalidateStaleContextItemAgent } from "./revalidate-stale-context-item.agent.js";
import { getItemLocations, type ICategoryItem } from "./categories-store.js";

export type IStaleContextRevalidationDeps = {
  buildRulesContextExcerpt: (projectRoot: string) => string;
  buildProjectContextExcerpt: (projectRoot: string) => Promise<string>;
  buildLocationsExcerpt: (projectRoot: string, locations: string[]) => string;
};

export type IStaleContextRevalidationResult = {
  decision: "keep" | "patch" | "fail";
  reasonCode: string;
  patchedFields?: Record<string, unknown>;
};

/**
 * Runs the stale-context revalidation agent. Returns the decision; caller applies it (patch or transition to FAILED).
 */
export async function runStaleContextRevalidation(args: {
  projectRoot: string;
  item: ICategoryItem;
  currentFingerprint: string;
  deps: IStaleContextRevalidationDeps;
}): Promise<IStaleContextRevalidationResult> {
  const { projectRoot, item, currentFingerprint, deps } = args;
  const contextFingerprintWhenCreated = item.contextFingerprint ?? "";
  const { status: _s, ...itemJson } = item;
  const rulesContextExcerpt = deps.buildRulesContextExcerpt(projectRoot);
  const projectContextExcerpt = await deps.buildProjectContextExcerpt(projectRoot);
  const locations = getItemLocations(item);
  const locationsCodeExcerpt = deps.buildLocationsExcerpt(projectRoot, locations);
  const output = await runStructuredAgent({
    agent: revalidateStaleContextItemAgent,
    input: {
      categoryId: item.categoryId,
      itemJson: itemJson as Record<string, unknown>,
      contextFingerprintWhenCreated,
      currentContextFingerprint: currentFingerprint,
      rulesContextExcerpt,
      projectContextExcerpt,
      ...(locationsCodeExcerpt.length > 0 && { locationsCodeExcerpt }),
    },
    workspace: projectRoot,
  });
  return {
    decision: output.decision,
    reasonCode: output.reasonCode,
    patchedFields: output.patchedFields,
  };
}
