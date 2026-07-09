#!/usr/bin/env -S npx tsx
/**
 * Runs humanize-category agent against eval fixtures and reports pass/fail vs expected output.
 * Uses an LLM judge to evaluate ~95% equivalence in meaning and terminology. Requires env/LLM configured.
 * Invoke via: pnpm eval:humanize (from apps/runtime).
 */
import "./load-env.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getRuntimeLogger, initRuntimeLogger } from "../src/core/logger.js";
import { resolveLogsDir } from "../src/core/log-paths.js";
import { loadEnv } from "../src/core/env.js";
import { setLlmProvider, createLlmProvider } from "../src/core/llm/llm-provider-factory.js";
import { runStructuredAgent } from "../src/core/llm/run-structured.agent.js";
import { humanizeCategoryAgent } from "../src/features/categories/humanize-category.agent.js";
import { humanizeEvalJudgeAgent } from "../src/features/categories/humanize-eval-judge.agent.js";
import {
  HumanizeEvalFixturesSchema,
  type IHumanizeEvalFixture,
} from "../src/features/categories/humanize-eval.schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<number> {
  const env = loadEnv();
  initRuntimeLogger(resolveLogsDir({ logsRootOverride: env.CTO_LOGS_ROOT }));
  setLlmProvider(createLlmProvider());
  const log = getRuntimeLogger();

  const fixturesPath = join(__dirname, "eval-fixtures", "humanize.fixtures.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(fixturesPath, "utf-8"));
  } catch (err) {
    log.error({
      event: "eval-humanize: failed to read fixtures",
      path: fixturesPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return 1;
  }

  const parseResult = HumanizeEvalFixturesSchema.safeParse(raw);
  if (!parseResult.success) {
    log.error({
      event: "eval-humanize: invalid fixture schema",
      path: fixturesPath,
      issues: parseResult.error.flatten(),
    });
    return 1;
  }
  const fixtures: IHumanizeEvalFixture[] = parseResult.data;
  const workspace = join(__dirname, "..");

  log.info({
    event: "eval-humanize: started",
    fixtureCount: fixtures.length,
    workspace,
  });

  let passed = 0;
  let failed = 0;
  for (const fixture of fixtures) {
    const label = fixture.id ?? fixture.input.title;
    try {
      log.info({ event: "eval-humanize: fixture started", label });
      const actual = await runStructuredAgent({
        agent: humanizeCategoryAgent,
        input: fixture.input,
        workspace,
      });

      log.info({ event: "eval-humanize: humanize completed", label });
      const judgeResult = await runStructuredAgent({
        agent: humanizeEvalJudgeAgent,
        input: {
          categoryId: fixture.input.categoryId,
          title: fixture.input.title,
          expected: fixture.expected,
          actual,
        },
        workspace,
      });

      log.info({
        event: "eval-humanize: judge completed",
        label,
        pass: judgeResult.pass,
        score: judgeResult.score,
      });
      if (judgeResult.pass) {
        console.log(`PASS ${label}`);
        passed++;
      } else {
        console.error(
          `FAIL ${label}: score=${judgeResult.score}${judgeResult.reason ? ` reason=${judgeResult.reason}` : ""}`
        );
        failed++;
      }
    } catch (err) {
      console.error(`FAIL ${label}: ${err instanceof Error ? err.message : String(err)}`);
      log.error({
        event: "eval-humanize: agent run failed",
        fixtureId: fixture.id,
        label,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
