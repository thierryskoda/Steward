/**
 * Normalizes file paths reported by mutation agents into target-project-relative
 * paths before persistence. Agents can report absolute paths, project-relative
 * paths, or cwd-relative paths that include the temp project directory.
 */
import { basename, isAbsolute, relative, resolve } from "path";
import { AppError } from "../../core/app-error.js";
import { ERR_AGENT_FAILED } from "../../core/error-codes.js";

function isInsidePath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function normalizeAgentReportedProjectPath(args: {
  projectRoot: string;
  reportedPath: string;
  operation: string;
}): string {
  const root = resolve(args.projectRoot);
  const trimmed = args.reportedPath.trim();
  const normalizedReported = trimmed.replaceAll("\\", "/");
  const projectDirMarker = `${basename(root)}/`;
  const markerIndex = normalizedReported.indexOf(projectDirMarker);
  if (!isAbsolute(trimmed) && markerIndex >= 0) {
    const markerRelativePath = normalizedReported.slice(markerIndex + projectDirMarker.length);
    const markerCandidate = resolve(root, markerRelativePath);
    if (markerRelativePath.length > 0 && isInsidePath(root, markerCandidate)) {
      return markerRelativePath;
    }
  }

  const candidates = isAbsolute(trimmed)
    ? [resolve(trimmed)]
    : [resolve(process.cwd(), trimmed), resolve(root, trimmed)];

  for (const candidate of candidates) {
    if (!isInsidePath(root, candidate)) continue;
    const normalized = relative(root, candidate).replaceAll("\\", "/");
    if (normalized.length > 0) return normalized;
  }

  throw new AppError(
    "Mutation agent reported a file path outside the target project.",
    ERR_AGENT_FAILED,
    {
      component: "categories",
      operation: args.operation,
      projectRoot: args.projectRoot,
      reportedPath: args.reportedPath,
    }
  );
}
