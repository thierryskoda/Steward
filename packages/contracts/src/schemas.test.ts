import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ACTIVITY_SLUG,
  AgentCliProviderSchema,
  AppPreferencesSchema,
  DEFAULT_AGENT_CLI_PROVIDER,
  SELECTABLE_AGENT_CLI_PROVIDERS,
  RejectBodySchema,
  OkResponseSchema,
  IdParamSchema,
  parseRejectBody,
  RuntimeStatusResponseSchema,
  ScanningStatusResponseSchema,
  DocumentationRefreshStatusResponseSchema,
  CodexTaskSubmissionSchema,
  NextCommitmentStatusResponseSchema,
  ScanningStatusSchema,
  InboxItemSchema,
  InboxFindingItemSchema,
  InboxRulesResponseSchema,
  CtoItemsResponseSchema,
  CtoItemSchema,
  FindingItemSchema,
  ImplementationResultSchema,
  UndoResultSchema,
  DOCUMENTATION_REFRESH_CATEGORY_ID,
} from "./schemas.js";
import { ROUTES, ROUTES_KEYS_SKIP_STARTUP_ASSERTION, buildRoute } from "./routes.js";

function humanProblemFields(): {
  humanSummary: string;
  humanCurrentBehavior: string;
  humanWhyItMatters: string;
  humanEvidence: string[];
  humanDecisionQuestion: string;
} {
  return {
    humanSummary: "Startup work is packed into one hard-to-review flow.",
    humanCurrentBehavior: "The app wires multiple startup phases in one place.",
    humanWhyItMatters: "Maintainers cannot quickly tell which startup decision is being approved.",
    humanEvidence: ["main.ts owns lifecycle wiring", "Startup order is reviewed as one block"],
    humanDecisionQuestion: "Should startup stay inline or move into clearer lifecycle modules?",
  };
}

function humanOptionFields(summary: string): {
  humanSummary: string;
  humanChooseThisIf: string;
  humanTradeoff: string;
} {
  return {
    humanSummary: summary,
    humanChooseThisIf:
      "Choose this when you want the approval card to explain the decision plainly.",
    humanTradeoff: "You get a clearer approval decision, but less step-by-step narration.",
  };
}

describe("schemas.test.ts", () => {
  describe("OkResponseSchema — success response contract so clients can rely on ok: true only", () => {
    it("accepts ok: true and rejects ok: false so only explicit success is valid", () => {
      assert.strictEqual(OkResponseSchema.parse({ ok: true }).ok, true);
      assert.throws(() => OkResponseSchema.parse({ ok: false }));
    });
  });

  describe("RejectBodySchema — reject request body shape used by implement/reject endpoints", () => {
    it("accepts empty or optional rejectReason string and rejects wrong type so API stays typed", () => {
      assert.strictEqual(RejectBodySchema.parse({}).rejectReason, undefined);
      assert.strictEqual(
        RejectBodySchema.parse({ rejectReason: "I prefer manual updates" }).rejectReason,
        "I prefer manual updates"
      );
      assert.throws(() => RejectBodySchema.parse({ rejectReason: 123 }));
    });
  });

  describe("parseRejectBody — normalizes reject body to string for handlers", () => {
    it("trims rejectReason and returns empty string for null body", () => {
      assert.strictEqual(parseRejectBody({ rejectReason: "  x  " }), "x");
      assert.strictEqual(parseRejectBody(null), "");
    });
    it("throws for invalid body so callers get fail-fast instead of wrong type", () => {
      assert.throws(() => parseRejectBody({ rejectReason: 999 }));
    });
  });

  describe("IdParamSchema — route :id param so URLs always have non-empty id", () => {
    it("accepts non-empty id and rejects empty", () => {
      assert.strictEqual(IdParamSchema.parse({ id: "abc-123" }).id, "abc-123");
      assert.throws(() => IdParamSchema.parse({ id: "" }));
    });
  });

  describe("ROUTES and buildRoute — route constants and :id substitution so runtime and clients stay in sync", () => {
    it("buildRoute replaces :id and paramized routes yield valid paths", () => {
      assert.strictEqual(
        buildRoute(ROUTES.RULES_APPROVE.path, { id: "r1" }),
        "/v1/rules/r1/approve"
      );
      const paramized = [
        ROUTES.RULES_APPROVE.path,
        ROUTES.RULES_REJECT.path,
        ROUTES.FINDINGS_APPROVE.path,
        ROUTES.FINDINGS_REJECT.path,
        ROUTES.FINDINGS_UNDO.path,
      ];
      for (const template of paramized) {
        assert.ok(template.includes(":id"), `Route ${template} must contain :id`);
        const path = buildRoute(template, { id: "test-id" });
        assert.ok(!path.includes(":id"), `buildRoute must replace :id in ${template}`);
        assert.ok(path.startsWith("/"), `Path must start with /: ${path}`);
      }
    });
    it("key ROUTES constants match expected paths so contract does not drift", () => {
      assert.strictEqual(ROUTES.ITEMS.path, "/v1/items");
      assert.strictEqual(ROUTES.RUNTIME_STATUS.path, "/v1/runtime/status");
      assert.strictEqual(ROUTES.CONFIG_INITIALIZE.path, "/v1/config/initialize");
      assert.strictEqual(ROUTES.CONFIG_INITIALIZE.method, "post");
      assert.strictEqual(ROUTES.SCANNING_STATUS.path, "/v1/scanning/status");
      assert.strictEqual(ROUTES.SCANNING_STATUS.method, "get");
      assert.strictEqual(ROUTES.SCANNING_RESUME.path, "/v1/scanning/resume");
      assert.strictEqual(ROUTES.SCANNING_PAUSE.path, "/v1/scanning/pause");
    });
    it("requires every canonical route to participate in startup mount validation", () => {
      assert.deepStrictEqual(ROUTES_KEYS_SKIP_STARTUP_ASSERTION, []);
    });
  });

  describe("ScanningStatusResponseSchema — passive discovery state so clients do not infer runtime stoppage", () => {
    it("accepts active and paused and rejects old discovery statuses", () => {
      assert.strictEqual(ScanningStatusSchema.parse("active"), "active");
      assert.strictEqual(ScanningStatusResponseSchema.parse({ status: "paused" }).status, "paused");
      assert.throws(() => ScanningStatusSchema.parse("running"));
      assert.throws(() => ScanningStatusResponseSchema.parse({ status: "stopped" }));
    });
  });

  describe("DocumentationRefreshStatusResponseSchema — latest bounded documentation review state", () => {
    it("parses never-checked and every durable run status", () => {
      assert.deepStrictEqual(
        DocumentationRefreshStatusResponseSchema.parse({
          status: "never-checked",
          lastCheckedAt: null,
          findingId: null,
        }),
        { status: "never-checked", lastCheckedAt: null, findingId: null }
      );
      for (const status of [
        "queued",
        "running",
        "clean",
        "needs-review",
        "blocked",
        "failed",
        "superseded",
      ] as const) {
        assert.strictEqual(
          DocumentationRefreshStatusResponseSchema.parse({
            status,
            lastCheckedAt: status === "queued" ? null : 1_000,
            findingId: status === "needs-review" || status === "blocked" ? "finding-1" : null,
          }).status,
          status
        );
      }
    });

    it("rejects a never-checked response that claims prior evidence", () => {
      assert.throws(() =>
        DocumentationRefreshStatusResponseSchema.parse({
          status: "never-checked",
          lastCheckedAt: 1_000,
          findingId: null,
        })
      );
    });
  });

  describe("CodexTaskSubmissionSchema — a real Codex task accepted for execution", () => {
    it("accepts a submitted task and rejects draft-only or malformed thread results", () => {
      assert.deepStrictEqual(
        CodexTaskSubmissionSchema.parse({
          status: "submitted",
          threadId: "019f8b86-1c1b-7151-9370-4223f0c42824",
          title: "Steward — Validate grocery matching",
        }),
        {
          status: "submitted",
          threadId: "019f8b86-1c1b-7151-9370-4223f0c42824",
          title: "Steward — Validate grocery matching",
        }
      );
      assert.throws(() =>
        CodexTaskSubmissionSchema.parse({
          status: "draft",
          threadId: "not-a-thread-id",
          title: "Steward draft",
        })
      );
    });
  });

  describe("NextCommitmentStatusResponseSchema — one evidence-backed project recommendation or an explicit no-op", () => {
    it("accepts never-run and a matching recommendation result", () => {
      assert.deepStrictEqual(NextCommitmentStatusResponseSchema.parse({ status: "never-run" }), {
        status: "never-run",
      });

      const response = NextCommitmentStatusResponseSchema.parse({
        status: "recommendation",
        runId: "8d640d73-ed21-4911-a88f-1028b561c6b7",
        createdAt: 1_000,
        startedAt: 1_010,
        completedAt: 1_020,
        stopReason: null,
        result: {
          status: "recommendation",
          summary:
            "Finish the partially completed retailer matching flow before starting discovery work.",
          inspectedProjectPaths: ["README.md", "src/retailer-matching.ts"],
          inspectedTaskIds: ["task-grocery"],
          uncertainties: [],
          evidence: [
            {
              source: "project-file",
              location: "src/retailer-matching.ts",
              finding:
                "The matching flow has a concrete unfinished branch with an existing caller.",
            },
            {
              source: "codex-task",
              location: "task-grocery",
              finding: "Recent work established the flow but stopped before completing validation.",
            },
          ],
          commitment: {
            title: "Finish retailer matching validation",
            whyNow:
              "This completes active work and unlocks reliable offer discovery without a new system.",
            expectedOutcome:
              "Retailer matches are validated end to end against the existing acceptance path.",
            definitionOfDone: ["The unfinished path works", "Focused verification passes"],
            firstAction:
              "Open the unfinished matcher and reproduce the remaining validation failure.",
          },
          whyThisWins:
            "It has stronger evidence and nearer user value than the other plausible work.",
          strongestCounterargument:
            "Fresh offer discovery could create value sooner if matching is already sufficient.",
          alternatives: [],
        },
      });

      assert.strictEqual(response.status, "recommendation");
    });

    it("rejects a run status whose nested result represents a different outcome", () => {
      assert.throws(() =>
        NextCommitmentStatusResponseSchema.parse({
          status: "recommendation",
          runId: "8d640d73-ed21-4911-a88f-1028b561c6b7",
          createdAt: 1_000,
          startedAt: 1_010,
          completedAt: 1_020,
          stopReason: null,
          result: {
            status: "none",
            summary: "No supported commitment clearly wins from the available evidence today.",
            inspectedProjectPaths: ["README.md"],
            inspectedTaskIds: [],
            uncertainties: [],
            evidence: [
              {
                source: "project-file",
                location: "README.md",
                finding: "The documented work is complete and no active constraint is identified.",
              },
            ],
            reason: "The available candidates are either complete or too speculative to recommend.",
            reconsiderWhen:
              "Re-run after a goal, blocker, or partially completed workflow changes.",
          },
        })
      );
    });
  });

  describe("RuntimeStatusResponseSchema — runtime status payload so UI can show state and phase", () => {
    it("parses stopped and starting with optional lastError and init metadata", () => {
      const stopped = RuntimeStatusResponseSchema.parse({
        pid: 1,
        state: "stopped",
        startedAt: 0,
        lastHeartbeatAt: 0,
        lastError: null,
      });
      assert.strictEqual(stopped.lastError, null);
      const init = RuntimeStatusResponseSchema.parse({
        pid: 1,
        state: "starting",
        startedAt: 1000,
        lastHeartbeatAt: 1000,
        lastError: null,
        phase: "building-repo-scope",
        phaseStartedAt: 1005,
      });
      assert.strictEqual(init.state, "starting");
      assert.strictEqual(init.phase, "building-repo-scope");
      assert.strictEqual(init.phaseStartedAt, 1005);
    });
    it("parses needs-config state so runtime can report bootstrap mode", () => {
      const needsConfig = RuntimeStatusResponseSchema.parse({
        pid: 1,
        state: "needs-config",
        startedAt: 1000,
        lastHeartbeatAt: 1000,
        lastError: null,
        phase: "loading-config",
        phaseStartedAt: 1005,
      });
      assert.strictEqual(needsConfig.state, "needs-config");
    });
  });

  describe("AgentCliProviderSchema — persisted provider choices can include hidden unsupported CLIs", () => {
    it("accepts configured CLI providers and rejects unknown providers", () => {
      assert.strictEqual(AgentCliProviderSchema.parse("cursor_cli"), DEFAULT_AGENT_CLI_PROVIDER);
      assert.strictEqual(AgentCliProviderSchema.parse("codex_cli"), "codex_cli");
      assert.strictEqual(AgentCliProviderSchema.parse("claude_code_cli"), "claude_code_cli");
      assert.strictEqual(AgentCliProviderSchema.parse("antigravity_cli"), "antigravity_cli");
      assert.throws(() => AgentCliProviderSchema.parse("unsupported_provider"));
    });

    it("exposes only automated runtime providers for Settings selection", () => {
      assert.deepStrictEqual(SELECTABLE_AGENT_CLI_PROVIDERS, [
        "cursor_cli",
        "codex_cli",
        "claude_code_cli",
      ]);
    });
  });

  describe("AppPreferencesSchema — app-data settings so older preference files get a safe CLI default", () => {
    it("defaults missing per-project CLI preferences to an empty map", () => {
      const prefs = AppPreferencesSchema.parse({
        knownProjectRoots: ["/repo"],
        selectedProjectRoot: "/repo",
      });
      assert.deepStrictEqual(prefs.cliProviderByProjectRoot, {});
    });

    it("accepts per-project CLI choices and rejects invalid values", () => {
      const prefs = AppPreferencesSchema.parse({
        knownProjectRoots: ["/cursor", "/codex", "/claude", "/antigravity"],
        selectedProjectRoot: null,
        cliProviderByProjectRoot: {
          "/cursor": "cursor_cli",
          "/codex": "codex_cli",
          "/claude": "claude_code_cli",
          "/antigravity": "antigravity_cli",
        },
      });
      assert.strictEqual(prefs.cliProviderByProjectRoot["/cursor"], "cursor_cli");
      assert.strictEqual(prefs.cliProviderByProjectRoot["/codex"], "codex_cli");
      assert.strictEqual(prefs.cliProviderByProjectRoot["/claude"], "claude_code_cli");
      assert.strictEqual(prefs.cliProviderByProjectRoot["/antigravity"], "antigravity_cli");
      assert.throws(() =>
        AppPreferencesSchema.parse({
          knownProjectRoots: ["/repo"],
          selectedProjectRoot: null,
          cliProviderByProjectRoot: { "/repo": "other_cli" },
        })
      );
    });
  });

  describe("InboxRulesResponseSchema — rules inbox response so GET /inbox/rules returns known shape", () => {
    it("parses items array with rule item", () => {
      const result = InboxRulesResponseSchema.parse({
        items: [
          {
            type: "rule",
            id: "r1",
            title: "Use StrictOmit",
            ruleText: "- Prefer StrictOmit",
            rationale: "Type safety",
            createdAt: 2000,
          },
        ],
      });
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]!.type, "rule");
    });
  });

  describe("Inbox item schemas — rule and finding shapes and refinement rules", () => {
    it("parses valid rule item", () => {
      const result = InboxItemSchema.parse({
        type: "rule",
        id: "r1",
        title: "R",
        ruleText: "Content",
        rationale: "Why",
        createdAt: 0,
      });
      assert.strictEqual(result.type, "rule");
    });

    it("parses finding with ≥2 options and required human fields so inbox only shows user-ready items", () => {
      const result = InboxFindingItemSchema.parse({
        type: "finding",
        categoryId: "bad-smell",
        id: "b1",
        problem: {
          title: "Split startup orchestration",
          locations: ["apps/runtime/src/main.ts:startEventSources"],
          technicalFinding: "Startup is monolithic.",
          ...humanProblemFields(),
        },
        decision: {
          options: [
            {
              id: "A",
              name: "Extract startup helpers",
              technicalPlan: "Extract per-feature startup helpers.",
              ruleConsideration: "Minimal abstractions rule favors extraction.",
              ...humanOptionFields("Use this option to make the approval decision clearer."),
            },
            {
              id: "B",
              name: "Extract startup helpers B",
              technicalPlan: "Extract per-feature startup helpers B.",
              ruleConsideration: "Alternative scope allowed by rule.",
              ...humanOptionFields("Use this option to make the approval decision clearer."),
            },
          ],
        },
        createdAt: 6000,
      });
      assert.strictEqual(result.type, "finding");
      assert.strictEqual(
        result.problem.humanDecisionQuestion,
        "Should startup stay inline or move into clearer lifecycle modules?"
      );
    });

    it("rejects finding with single option so user always gets choice", () => {
      assert.throws(() =>
        InboxFindingItemSchema.parse({
          type: "finding",
          categoryId: "bad-smell",
          id: "b1",
          problem: {
            title: "Split startup orchestration",
            locations: ["apps/runtime/src/main.ts"],
            technicalFinding: "Startup is monolithic.",
            ...humanProblemFields(),
          },
          decision: {
            options: [
              {
                id: "A",
                name: "Option A",
                technicalPlan: "Plan",
                ruleConsideration: "Single option.",
                ...humanOptionFields("Use this option to make the approval decision clearer."),
              },
            ],
          },
          createdAt: 6000,
        })
      );
    });

    it("accepts one complete option only for the canonical documentation report category", () => {
      const result = InboxFindingItemSchema.parse({
        type: "finding",
        categoryId: DOCUMENTATION_REFRESH_CATEGORY_ID,
        id: "documentation-report-1",
        problem: {
          title: "README command drift",
          locations: ["README.md", "package.json"],
          technicalFinding: "README references a removed package script.",
          ...humanProblemFields(),
        },
        decision: {
          options: [
            {
              id: "A",
              name: "Correct README command",
              technicalPlan: "Replace only the obsolete README command.",
              ruleConsideration: "The recommendation stays report-only and minimal.",
              ...humanOptionFields("Correct the obsolete command without expanding the docs."),
            },
          ],
        },
        createdAt: 6000,
      });

      assert.strictEqual(result.categoryId, DOCUMENTATION_REFRESH_CATEGORY_ID);
      assert.strictEqual(result.decision.options.length, 1);
    });

    it("rejects finding missing human fields so inbox never shows half-baked items", () => {
      assert.throws(() =>
        InboxFindingItemSchema.parse({
          type: "finding",
          categoryId: "bad-smell",
          id: "b1",
          problem: {
            title: "Split startup orchestration",
            locations: ["apps/runtime/src/main.ts"],
            technicalFinding: "Startup is monolithic.",
            ...humanProblemFields(),
          },
          decision: {
            options: [
              { id: "A", name: "Option A", technicalPlan: "Plan", ruleConsideration: "A." },
              { id: "B", name: "Option B", technicalPlan: "Plan", ruleConsideration: "B." },
            ],
          },
          createdAt: 6000,
        })
      );
    });

    it("rejects finding title with fewer than 3 words so labels stay readable", () => {
      assert.throws(() =>
        InboxFindingItemSchema.parse({
          type: "finding",
          categoryId: "bad-smell",
          id: "b1",
          problem: {
            title: "Startup split",
            locations: ["apps/runtime/src/main.ts:startEventSources"],
            technicalFinding: "Startup is monolithic.",
            ...humanProblemFields(),
          },
          decision: {
            options: [
              {
                id: "A",
                name: "Extract startup helpers",
                technicalPlan: "Extract.",
                ruleConsideration: "Rule favors extraction.",
                ...humanOptionFields("Use this option to make the approval decision clearer."),
              },
              {
                id: "B",
                name: "Other option name",
                technicalPlan: "Plan.",
                ruleConsideration: "Alternative.",
                ...humanOptionFields("Use this option to make the approval decision clearer."),
              },
            ],
          },
          createdAt: 6000,
        })
      );
    });

    it("parses option name with more than 5 words by truncating to 5 so labels stay scannable", () => {
      const result = InboxFindingItemSchema.parse({
        type: "finding",
        categoryId: "bad-smell",
        id: "b1",
        problem: {
          title: "Split startup orchestration",
          locations: ["apps/runtime/src/main.ts:startEventSources"],
          technicalFinding: "Startup is monolithic.",
          ...humanProblemFields(),
        },
        decision: {
          options: [
            {
              id: "A",
              name: "Extract startup helpers with wrapper modules",
              technicalPlan: "Extract.",
              ruleConsideration: "Rule.",
              ...humanOptionFields("Use this option to make the approval decision clearer."),
            },
            {
              id: "B",
              name: "Other option name",
              technicalPlan: "Plan.",
              ruleConsideration: "Rule.",
              ...humanOptionFields("Use this option to make the approval decision clearer."),
            },
          ],
        },
        createdAt: 6000,
      });
      assert.strictEqual(
        result.decision.options[0]!.name,
        "Extract startup helpers with wrapper",
        "createShortLabelSchema truncates to first 5 words"
      );
    });
  });

  describe("CtoItemsResponseSchema — full items list with status and activities so GET /items matches runtime state", () => {
    it("parses finding with status and activities", () => {
      const result = CtoItemsResponseSchema.parse({
        items: [
          {
            type: "finding",
            categoryId: "dead-code",
            id: "c1",
            status: "agent-running",
            problem: {
              title: "Delete orphan module",
              locations: ["src/foo.ts"],
              technicalFinding: "Never imported.",
              ...humanProblemFields(),
            },
            decision: {
              options: [
                {
                  id: "A",
                  name: "Delete orphan module",
                  technicalPlan: "Delete it.",
                  ruleConsideration: "Orphan removal per constraints.",
                },
              ],
            },
            createdAt: 1000,
            activities: [
              { slug: ACTIVITY_SLUG.WORKFLOW_ITEM_DETECTED, at: 1000 },
              { slug: ACTIVITY_SLUG.WORKFLOW_ITEM_APPROVED_BY_USER, at: 1100 },
              { slug: ACTIVITY_SLUG.WORKFLOW_ITEM_CLAIMED_FOR_AGENT_RUN, at: 1200 },
            ],
          },
        ],
      });
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]!.type, "finding");
      const finding = result.items[0] as { activities: Array<{ slug: string; at: number }> };
      assert.strictEqual(finding.activities.length, 3);
      assert.strictEqual(finding.activities[0]!.slug, ACTIVITY_SLUG.WORKFLOW_ITEM_DETECTED);
      assert.strictEqual(finding.activities[1]!.at, 1100);
    });
  });

  describe("CtoItemSchema — single item accepts all lifecycle statuses so API can return any state", () => {
    it("parses item for each status value", () => {
      const statuses = [
        "needs-review",
        "learning-from-rejection",
        "approved",
        "claimed",
        "agent-running",
        "implemented",
        "failed",
        "rejected",
      ] as const;
      for (const status of statuses) {
        const result = CtoItemSchema.parse({
          type: "rule",
          id: "r1",
          status,
          title: "Use StrictOmit",
          ruleText: "Prefer StrictOmit over Omit.",
          rationale: "It catches invalid omitted keys.",
          createdAt: 0,
        });
        assert.strictEqual(result.status, status);
      }
    });
  });

  describe("UndoResultSchema — undo-agent JSON output so item and API share shape", () => {
    it("parses valid summary, revertedFiles, skippedFiles, reasons", () => {
      const result = UndoResultSchema.parse({
        summary: "Reverted two files.",
        revertedFiles: ["src/a.ts", "src/b.ts"],
        skippedFiles: ["src/c.ts"],
        reasons: ["src/c.ts was modified by another change"],
      });
      assert.strictEqual(result.summary, "Reverted two files.");
      assert.strictEqual(result.revertedFiles.length, 2);
      assert.strictEqual(result.skippedFiles.length, 1);
      assert.strictEqual(result.reasons.length, 1);
    });
  });

  describe("FindingItemSchema — accepts hasBeenReverted and lastUndoResult for undo flow", () => {
    it("parses finding with hasBeenReverted and lastUndoResult", () => {
      const result = FindingItemSchema.parse({
        type: "finding",
        categoryId: "dead-code",
        id: "f1",
        status: "implemented",
        problem: {
          title: "Remove unused export",
          locations: ["src/foo.ts"],
          technicalFinding: "Export is unused.",
          ...humanProblemFields(),
        },
        decision: {
          options: [
            {
              id: "A",
              name: "Remove unused export",
              technicalPlan: "Delete export.",
              ruleConsideration: "Unused export removal.",
            },
          ],
        },
        createdAt: 1000,
        hasBeenReverted: true,
        lastUndoResult: {
          summary: "Reverted.",
          revertedFiles: ["src/foo.ts"],
          skippedFiles: [],
          reasons: [],
        },
      });
      assert.strictEqual(result.hasBeenReverted, true);
      assert.ok(result.lastUndoResult);
      assert.strictEqual(result.lastUndoResult!.summary, "Reverted.");
    });
  });

  describe("ImplementationResultSchema — implement-agent JSON output so item and API share shape", () => {
    it("parses valid summary, fileChanges, checks and trims strings", () => {
      const result = ImplementationResultSchema.parse({
        summary: "  Replaced optional flag with two named functions.  ",
        fileChanges: [
          {
            path: " repo-scope-config.ts ",
            bulletPoints: [
              " Removed loadStrictCtoConfig. ",
              " Added loadStrictCtoConfigFromFile. ",
            ],
          },
        ],
        checks: [" Typecheck passed ", " Lint passed "],
      });
      assert.strictEqual(result.summary, "Replaced optional flag with two named functions.");
      assert.strictEqual(result.fileChanges.length, 1);
      assert.strictEqual(result.fileChanges[0]!.path, "repo-scope-config.ts");
      assert.strictEqual(result.fileChanges[0]!.bulletPoints[0], "Removed loadStrictCtoConfig.");
      assert.strictEqual(result.checks[0], "Typecheck passed");
    });
    it("rejects missing summary so output is never empty", () => {
      assert.throws(() =>
        ImplementationResultSchema.parse({
          summary: "",
          fileChanges: [],
          checks: [],
        })
      );
    });
    it("rejects invalid fileChanges shape so contract stays strict", () => {
      assert.throws(() =>
        ImplementationResultSchema.parse({
          summary: "Done.",
          fileChanges: [{ path: "a.ts" }],
          checks: [],
        })
      );
    });
  });

  describe("FindingItemSchema — finding item with lastImplementationResult so API returns implement result", () => {
    it("parses finding with optional lastImplementationResult", () => {
      const result = FindingItemSchema.parse({
        type: "finding",
        categoryId: "fc",
        id: "f1",
        status: "implemented",
        problem: {
          title: "Optional regenerateOnLoad mode flag",
          locations: ["apps/runtime/src/features/context/repo-scope-config.ts"],
          technicalFinding: "loadStrictCtoConfig uses optional flag.",
          ...humanProblemFields(),
        },
        decision: {
          options: [
            {
              id: "A",
              name: "Two named config-load functions",
              technicalPlan: "Add loadStrictCtoConfigFromFile.",
              ruleConsideration: "Avoid optional mode flag per rule.",
            },
          ],
          selectedOptionId: "A",
        },
        createdAt: 1000,
        updatedAt: 2000,
        lastImplementationResult: {
          summary: "Replaced optional regenerateOnLoad with two named functions.",
          fileChanges: [
            {
              path: "repo-scope-config.ts",
              bulletPoints: ["Removed loadStrictCtoConfig.", "Added loadStrictCtoConfigFromFile."],
            },
          ],
          checks: ["Typecheck passed", "Lint passed"],
        },
      });
      assert.strictEqual(
        result.lastImplementationResult?.summary,
        "Replaced optional regenerateOnLoad with two named functions."
      );
      assert.strictEqual(result.lastImplementationResult?.fileChanges.length, 1);
      assert.strictEqual(result.lastImplementationResult?.checks.length, 2);
    });
  });
});
