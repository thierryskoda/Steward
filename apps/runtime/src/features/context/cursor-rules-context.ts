import { getRuleSources, readRepoScopeConfigFromDisk } from "./repo-scope-config.js";

const LEADING_FRONTMATTER_RE = /^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/;

export type IBuildCursorRulesContextDeps = {
  getSourceDocs: (
    projectRoot: string,
    sources: string[]
  ) => Array<{ path: string; content: string }>;
};

function stripLeadingFrontmatter(content: string): string {
  return content.replace(LEADING_FRONTMATTER_RE, "").trim();
}

/**
 * Builds rules context string from config-driven ruleSources (full content after frontmatter strip, no truncation).
 */
export function buildCursorRulesContext(
  projectRoot: string,
  deps: IBuildCursorRulesContextDeps
): string {
  const config = readRepoScopeConfigFromDisk(projectRoot);
  const sources = config ? getRuleSources(config) : [];
  if (sources.length === 0) {
    return "(no rule sources configured in config ruleSources)";
  }
  const entries = deps.getSourceDocs(projectRoot, sources);
  if (entries.length === 0) {
    return "(no readable rule files from ruleSources)";
  }
  const sections = entries.map((e) => {
    const body = stripLeadingFrontmatter(e.content) || e.content;
    return `### ${e.path}\n\`\`\`\n${body}\n\`\`\``;
  });
  return `## Coding rules from configured ruleSources\n${sections.join("\n\n")}`;
}
