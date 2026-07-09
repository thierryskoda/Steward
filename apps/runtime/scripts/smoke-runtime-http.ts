import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, type ChildProcess } from "child_process";
import { mkdtemp } from "fs/promises";
import { setTimeout as delay } from "timers/promises";
import { openRuntimeDb, closeRuntimeDb } from "../src/core/db/sqlite-connection.js";
import { runSqliteMigrations } from "../src/core/db/sqlite-migrations.js";
import { clearRuntimeDb, setRuntimeDb } from "../src/core/db/runtime-db.js";
import { writeGeneratedExclude } from "../src/features/context/repo-scope-config.js";
import { createFinding, saveFinding } from "../src/features/categories/categories-store.js";
import {
  computeSourcesHash,
  readSourceDocs,
  writeSnapshot,
} from "../src/features/categories/rules-snapshot.js";
import { stewardDir } from "../src/core/paths.js";
import { getProjectDir } from "../src/core/project-key.js";
import { readEndpointFile } from "../src/core/endpoint-file.js";
import {
  CtoItemsResponseSchema,
  HealthResponseSchema,
  InboxFindingsResponseSchema,
  OkResponseSchema,
  RuntimeStatusResponseSchema,
  ScanningStatusResponseSchema,
  STATUS,
} from "@steward/contracts/schemas";
import { buildRoute, ROUTES } from "@steward/contracts/routes";

const runtimeMain = join(process.cwd(), "dist", "src", "main.js");
const pollTimeoutMs = 10_000;
const smokeCategoryId = "smoke-category";
const smokeRulePath = "AGENTS.md";

type IEndpoint = {
  host: string;
  port: number;
};

function ensureRuntimeBuilt(): void {
  if (!existsSync(runtimeMain)) {
    throw new Error("Runtime build missing. Run `pnpm --filter @steward/runtime build`.");
  }
}

function seedRuntimeState(projectRoot: string): string {
  const db = openRuntimeDb(projectRoot);
  setRuntimeDb(db);
  try {
    runSqliteMigrations(db);
    writeGeneratedExclude(projectRoot, ["node_modules", ".git", ".steward"]);
    const sourceEntries = readSourceDocs(projectRoot, [smokeRulePath]);
    const sourcesHash = computeSourcesHash(sourceEntries);
    writeSnapshot(projectRoot, {
      sourcesHash,
      extractorVersion: "1",
      generatedAt: Date.now(),
      categories: [
        {
          categoryId: smokeCategoryId,
          rulePath: smokeRulePath,
          ruleContent: sourceEntries[0]?.content ?? "",
        },
      ],
    });
    const finding = createFinding({
      categoryId: smokeCategoryId,
      workflowChatId: "smoke-chat",
      problem: {
        title: "Slow API Response",
        locations: ["src/api.ts"],
        technicalFinding: "The API path performs repeated work before returning data.",
        humanSummary: "The API repeats work before returning data, so pages feel slower.",
        humanCurrentBehavior: "Each request repeats the same expensive lookup.",
        humanWhyItMatters: "Users wait longer before they can continue.",
        humanEvidence: ["Repeated work happens before response", "Slow path affects page load"],
        humanDecisionQuestion: "Should repeated data be cached or should the query be optimized?",
      },
      decision: {
        options: [
          {
            id: "A",
            name: "Use Cache Layer",
            technicalPlan: "Add a cache for repeated reads.",
            ruleConsideration: "Keeps repeated work out of the hot path.",
            humanSummary: "Reuse recent results when the same data is requested.",
            humanChooseThisIf: "Choose this if the data can be reused safely.",
            humanTradeoff: "Cached data needs clear invalidation.",
          },
          {
            id: "B",
            name: "Optimize Database Query",
            technicalPlan: "Reduce the query work done per request.",
            ruleConsideration: "Improves the source of the slow response.",
            humanSummary: "Make the data lookup itself faster.",
            humanChooseThisIf: "Choose this if fresh data matters most.",
            humanTradeoff: "The query change may take longer to implement.",
          },
        ],
      },
      dedupeKey: "smoke-finding",
      status: STATUS.NEEDS_REVIEW,
    });
    saveFinding(projectRoot, finding);
    return finding.id;
  } finally {
    clearRuntimeDb();
    closeRuntimeDb(db);
  }
}

function readAuthToken(projectRoot: string): string {
  const tokenPath = join(getProjectDir(projectRoot), "http-token");
  if (!existsSync(tokenPath)) {
    throw new Error(`Runtime auth token was not created: ${tokenPath}`);
  }
  return readFileSync(tokenPath, "utf-8").trim();
}

async function waitForEndpoint(projectRoot: string): Promise<IEndpoint> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < pollTimeoutMs) {
    const endpoint = readEndpointFile(projectRoot);
    if (endpoint) return endpoint;
    await delay(100);
  }
  throw new Error("Timed out waiting for runtime endpoint file.");
}

async function waitForExit(child: ChildProcess): Promise<number | null> {
  return await new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
}

async function requestJson(args: {
  endpoint: IEndpoint;
  path: string;
  method?: "GET" | "POST";
  token?: string;
  body?: unknown;
}): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (args.token) headers.Authorization = `Bearer ${args.token}`;
  if (args.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`http://${args.endpoint.host}:${args.endpoint.port}${args.path}`, {
    method: args.method ?? "GET",
    headers,
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(`${args.method ?? "GET"} ${args.path} failed: ${response.status} ${text}`);
  }
  return payload;
}

async function requestStatus(args: {
  endpoint: IEndpoint;
  path: string;
  method?: "GET" | "POST";
  token?: string;
  body?: unknown;
}): Promise<number> {
  const headers: Record<string, string> = {};
  if (args.token) headers.Authorization = `Bearer ${args.token}`;
  if (args.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`http://${args.endpoint.host}:${args.endpoint.port}${args.path}`, {
    method: args.method ?? "GET",
    headers,
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });
  await response.arrayBuffer();
  return response.status;
}

function assertStewardLayout(projectRoot: string): void {
  const stewardRoot = stewardDir(projectRoot);
  const entries = existsSync(stewardRoot) ? new Set(readdirSync(stewardRoot)) : new Set();
  const allowed = new Set(["state.db", "state.db-shm", "state.db-wal", "tmp"]);
  for (const entry of entries) {
    if (!allowed.has(String(entry))) {
      throw new Error(`Unexpected persistent .steward entry: ${String(entry)}`);
    }
  }
}

async function shutdownRuntime(args: { endpoint: IEndpoint; token: string }): Promise<void> {
  await requestJson({
    endpoint: args.endpoint,
    path: ROUTES.RUNTIME_SHUTDOWN.path,
    method: "POST",
    token: args.token,
  });
}

async function main(): Promise<void> {
  ensureRuntimeBuilt();
  const projectRoot = await mkdtemp(join(tmpdir(), "cto-runtime-http-smoke-project-"));
  const logsRoot = await mkdtemp(join(tmpdir(), "cto-runtime-http-smoke-logs-"));
  writeFileSync(join(projectRoot, "README.md"), "# Runtime smoke project\n", "utf-8");
  writeFileSync(
    join(projectRoot, smokeRulePath),
    [
      "# Smoke Rules",
      "",
      "- Keep API responses fast by avoiding repeated work in request handlers.",
      "",
    ].join("\n"),
    "utf-8"
  );
  const findingId = seedRuntimeState(projectRoot);

  const child = spawn("node", [runtimeMain, "--runtime", "--project-root", projectRoot], {
    env: {
      ...process.env,
      CTO_HTTP_PORT: "0",
      CTO_LOGS_ROOT: logsRoot,
      CTO_AGENT_IO_LOG_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    const endpoint = await waitForEndpoint(projectRoot);
    const token = readAuthToken(projectRoot);

    const health = HealthResponseSchema.parse(
      await requestJson({ endpoint, path: ROUTES.HEALTH.path })
    );
    if (health.ok !== true) throw new Error("Health check did not return ok=true.");

    const initialStatus = RuntimeStatusResponseSchema.parse(
      await requestJson({ endpoint, path: ROUTES.RUNTIME_STATUS.path, token })
    );
    if (initialStatus.state !== "needs-config") {
      throw new Error(`Expected initial state needs-config, got ${initialStatus.state}.`);
    }
    const blockedFeatureStatus = await requestStatus({
      endpoint,
      path: ROUTES.ITEMS.path,
      token,
    });
    if (blockedFeatureStatus !== 503) {
      throw new Error(
        `Expected feature routes blocked before config, got ${blockedFeatureStatus}.`
      );
    }

    await requestJson({
      endpoint,
      path: ROUTES.CONFIG_INITIALIZE.path,
      method: "POST",
      token,
      body: {
        ruleSources: [smokeRulePath],
        approvalMode: "trust_ai",
        projectContext: [],
        features: {
          genericFindingEnabled: false,
          rulesWorkflowEnabled: false,
          continualLearningEnabled: false,
          optionHintsEnabled: false,
        },
      },
    });

    const runningStatus = RuntimeStatusResponseSchema.parse(
      await requestJson({ endpoint, path: ROUTES.RUNTIME_STATUS.path, token })
    );
    if (runningStatus.state !== "running") {
      throw new Error(
        `Expected state running after config initialize, got ${runningStatus.state}.`
      );
    }

    const activeScanning = ScanningStatusResponseSchema.parse(
      await requestJson({ endpoint, path: ROUTES.SCANNING_STATUS.path, token })
    );
    if (activeScanning.status !== "active") {
      throw new Error(`Expected scanning active after startup, got ${activeScanning.status}.`);
    }

    const pausedScanning = ScanningStatusResponseSchema.parse(
      await requestJson({
        endpoint,
        path: ROUTES.SCANNING_PAUSE.path,
        method: "POST",
        token,
      })
    );
    if (pausedScanning.status !== "paused") {
      throw new Error(
        `Expected scanning paused after pause request, got ${pausedScanning.status}.`
      );
    }

    const inbox = InboxFindingsResponseSchema.parse(
      await requestJson({ endpoint, path: ROUTES.INBOX_FINDINGS.path, token })
    );
    if (inbox.items.length !== 1 || inbox.items[0]?.id !== findingId) {
      throw new Error(
        `Expected seeded finding in inbox while scanning is paused, got ${JSON.stringify(inbox.items)}.`
      );
    }

    const approveResponse = OkResponseSchema.parse(
      await requestJson({
        endpoint,
        path: buildRoute(ROUTES.FINDINGS_APPROVE.path, { id: findingId }),
        method: "POST",
        token,
        body: { selectedOptionId: "A" },
      })
    );
    if (approveResponse.ok !== true) throw new Error("Finding approve did not return ok=true.");

    const items = CtoItemsResponseSchema.parse(
      await requestJson({ endpoint, path: ROUTES.ITEMS.path, token })
    );
    const approvedFinding = items.items.find(
      (item) => item.type === "finding" && item.id === findingId
    );
    if (!approvedFinding || approvedFinding.status !== STATUS.APPROVED) {
      throw new Error(`Expected approved finding in items, got ${JSON.stringify(items.items)}.`);
    }
    if (approvedFinding.type === "finding" && approvedFinding.decision.selectedOptionId !== "A") {
      throw new Error("Expected approved finding to preserve selected option A.");
    }

    const resumedScanning = ScanningStatusResponseSchema.parse(
      await requestJson({
        endpoint,
        path: ROUTES.SCANNING_RESUME.path,
        method: "POST",
        token,
      })
    );
    if (resumedScanning.status !== "active") {
      throw new Error(
        `Expected scanning active after resume request, got ${resumedScanning.status}.`
      );
    }

    assertStewardLayout(projectRoot);
    await shutdownRuntime({ endpoint, token });
    await waitForExit(child);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      { cause: error }
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(logsRoot, { recursive: true, force: true });
  }
}

await main();
