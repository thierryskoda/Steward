/**
 * Produces immutable, bounded task evidence for one project. Only user/assistant messages from
 * turns whose cwd exactly matches the project are retained; tool output and instructions are not.
 */
import { createHash } from "node:crypto";
import { createReadStream, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { IRecentProjectTask } from "./recent-project-tasks.js";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_MESSAGE_TEXT_BYTES = 128 * 1024;

const TurnContextLineSchema = z
  .object({
    type: z.literal("turn_context"),
    payload: z.object({ cwd: z.string(), turn_id: z.string().optional() }).passthrough(),
  })
  .passthrough();

const MessageContentSchema = z
  .object({
    type: z.enum(["input_text", "output_text"]),
    text: z.string(),
  })
  .passthrough();

const MessageLineSchema = z
  .object({
    type: z.literal("response_item"),
    payload: z
      .object({
        type: z.literal("message"),
        role: z.enum(["user", "assistant"]),
        phase: z.string().nullable().optional(),
        content: z.array(z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();

export type IRecentProjectTaskSnapshot = Pick<
  IRecentProjectTask,
  "id" | "title" | "updatedAt" | "transcriptBytes"
> & {
  snapshotPath: string;
  snapshotBytes: number;
  sourceTruncated: boolean;
};

function isExactProjectRoot(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return { value, truncated: false };
  const buffer = Buffer.from(value, "utf8");
  return {
    value: `${buffer.subarray(0, maxBytes).toString("utf8")}\n[message truncated]`,
    truncated: true,
  };
}

function appendBoundedLine(args: { lines: string[]; line: string; currentBytes: number }): {
  currentBytes: number;
  dropped: boolean;
} {
  const lineBytes = Buffer.byteLength(args.line, "utf8");
  let currentBytes = args.currentBytes;
  let dropped = false;
  while (args.lines.length > 0 && currentBytes + lineBytes > MAX_SNAPSHOT_BYTES) {
    const removed = args.lines.shift();
    if (removed !== undefined) currentBytes -= Buffer.byteLength(removed, "utf8");
    dropped = true;
  }
  if (lineBytes > MAX_SNAPSHOT_BYTES) return { currentBytes, dropped: true };
  args.lines.push(args.line);
  return { currentBytes: currentBytes + lineBytes, dropped };
}

async function snapshotTask(args: {
  task: IRecentProjectTask;
  taskIndex: number;
  projectRoot: string;
  outputDir: string;
}): Promise<IRecentProjectTaskSnapshot> {
  const sourceBytes = statSync(args.task.transcriptPath).size;
  const sourceStart = Math.max(0, sourceBytes - MAX_SOURCE_BYTES);
  const snapshotName = `task-${args.taskIndex + 1}-${createHash("sha256")
    .update(args.task.id)
    .digest("hex")
    .slice(0, 12)}.jsonl`;
  const snapshotPath = resolve(args.outputDir, snapshotName);
  const lines: string[] = [];
  let currentBytes = 0;
  let sourceTruncated = sourceStart > 0;
  let matchesProject = sourceStart === 0;
  let skipPartialFirstLine = sourceStart > 0;

  const input = createReadStream(args.task.transcriptPath, {
    encoding: "utf8",
    start: sourceStart,
    end: sourceBytes - 1,
  });
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    if (skipPartialFirstLine) {
      skipPartialFirstLine = false;
      continue;
    }
    const parsed = parseJsonLine(line);
    if (parsed === null) continue;
    const turnContext = TurnContextLineSchema.safeParse(parsed);
    if (turnContext.success) {
      matchesProject = isExactProjectRoot(turnContext.data.payload.cwd, args.projectRoot);
      continue;
    }
    if (!matchesProject) continue;
    const message = MessageLineSchema.safeParse(parsed);
    if (!message.success) continue;
    const text = message.data.payload.content
      .map((item) => MessageContentSchema.safeParse(item))
      .filter((item) => item.success)
      .map((item) => item.data.text)
      .join("\n")
      .trim();
    if (text.length === 0) continue;
    const boundedText = truncateUtf8(text, MAX_MESSAGE_TEXT_BYTES);
    sourceTruncated ||= boundedText.truncated;
    const normalizedLine = `${JSON.stringify({
      type: "message",
      role: message.data.payload.role,
      phase: message.data.payload.phase ?? null,
      text: boundedText.value,
    })}\n`;
    const appended = appendBoundedLine({ lines, line: normalizedLine, currentBytes });
    currentBytes = appended.currentBytes;
    sourceTruncated ||= appended.dropped;
  }

  const header = `${JSON.stringify({
    type: "task_snapshot",
    taskId: args.task.id,
    title: args.task.title,
    updatedAt: args.task.updatedAt,
    scope: "user and assistant messages from exact-project turns only",
    sourceTruncated,
  })}\n`;
  const content = `${header}${lines.join("")}`;
  writeFileSync(snapshotPath, content, { encoding: "utf8", mode: 0o600 });
  return {
    id: args.task.id,
    title: args.task.title,
    updatedAt: args.task.updatedAt,
    transcriptBytes: args.task.transcriptBytes,
    snapshotPath,
    snapshotBytes: Buffer.byteLength(content, "utf8"),
    sourceTruncated,
  };
}

export async function snapshotRecentProjectTasks(args: {
  tasks: IRecentProjectTask[];
  projectRoot: string;
  outputDir: string;
}): Promise<IRecentProjectTaskSnapshot[]> {
  const snapshots: IRecentProjectTaskSnapshot[] = [];
  for (const [taskIndex, task] of args.tasks.entries()) {
    snapshots.push(
      await snapshotTask({
        task,
        taskIndex,
        projectRoot: args.projectRoot,
        outputDir: args.outputDir,
      })
    );
  }
  return snapshots;
}
