import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { loadProjectContextSnapshot } from "./project-context-snapshot.js";

const DEFAULT_CURSOR_PROJECTS = join(homedir(), ".cursor", "projects");

/** Parse transcript path: .../projects/<projectDir>/agent-transcripts/<chatId>.jsonl OR <chatId>/<chatId>.jsonl */
export function parseTranscriptPath(path: string): {
  chatId?: string;
  projectDir?: string;
} {
  const projectMatch = path.match(/\/projects\/([^/]+)\//);
  if (!projectMatch) return {};
  const marker = "/agent-transcripts/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex === -1) return {};
  const rel = path.slice(markerIndex + marker.length);
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1 && parts[0]!.endsWith(".jsonl")) {
    return {
      projectDir: projectMatch[1],
      chatId: parts[0]!.replace(/\.jsonl$/, ""),
    };
  }
  return { projectDir: projectMatch[1], chatId: parts[0] };
}

/** Cursor encodes project paths as dir names: separators → `-`, leading slash trimmed. */
export function cursorProjectDirFromRoot(projectRoot: string): string {
  const abs = resolve(projectRoot);
  return abs.replace(/^\/+/, "").replace(/\//g, "-");
}

export function findTranscriptPaths(args: {
  projectRoot: string;
  cursorProjectsRoot?: string;
}): string[] {
  const out = new Set<string>();
  const cursorProjects = args.cursorProjectsRoot ?? DEFAULT_CURSOR_PROJECTS;
  if (!existsSync(cursorProjects)) return [];
  const projDir = cursorProjectDirFromRoot(args.projectRoot);
  const transcriptsDir = join(cursorProjects, projDir, "agent-transcripts");
  if (!existsSync(transcriptsDir)) return [];
  for (const entry of readdirSync(transcriptsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.add(join(transcriptsDir, entry.name));
      continue;
    }
    if (!entry.isDirectory()) continue;
    const nested = join(transcriptsDir, entry.name, `${entry.name}.jsonl`);
    if (existsSync(nested)) out.add(nested);
  }
  return Array.from(out);
}

/** Returns project context text from the DB-backed project-context snapshot (populated at startup). */
export async function buildProjectContextForAgent(projectRoot: string): Promise<string> {
  const snapshot = loadProjectContextSnapshot(projectRoot);
  return snapshot?.projectContextText ?? "";
}
