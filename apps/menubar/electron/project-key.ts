/**
 * Stable project key (must match runtime project-key algorithm).
 */
import { createHash } from "crypto";

export function getProjectKey(projectRoot: string): string {
  const canonical = projectRoot.replace(/\\/g, "/").trim();
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}
