/**
 * Builds a short code excerpt from files at item locations for revalidation prompts.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const LINES_PER_FILE = 40;

/**
 * Reads each location path under projectRoot (first N lines per file) and returns
 * a concatenated excerpt. Empty string if no readable files.
 */
export function buildLocationsExcerpt(projectRoot: string, locations: string[]): string {
  const excerpts: string[] = [];
  for (const rel of locations) {
    const trimmed = rel.trim();
    if (!trimmed) continue;
    const full = join(projectRoot, trimmed);
    if (!existsSync(full)) continue;
    try {
      const content = readFileSync(full, "utf-8");
      const lines = content.split("\n").slice(0, LINES_PER_FILE);
      excerpts.push(`--- ${trimmed} ---\n${lines.join("\n")}`);
    } catch {
      // skip unreadable
    }
  }
  return excerpts.join("\n\n");
}
