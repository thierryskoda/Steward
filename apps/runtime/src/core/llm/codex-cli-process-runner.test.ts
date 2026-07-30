/**
 * Tests for Codex CLI process runner: buildCodexCliArgs maps provider execution modes
 * to documented `codex exec --json` invocations.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { AppError } from "../app-error.js";
import { ERR_AGENT_CLI_CONTRACT } from "../error-codes.js";
import { selectCodexCliCommand } from "@steward/contracts/runtime-defaults";
import { DEFAULT_LLM_MODEL } from "./llm-defaults.js";
import {
  assertCodexCliCompatibility,
  buildProjectIsolatedCodexSpawnEnv,
  buildCodexCliArgs,
} from "./codex-cli-process-runner.js";

describe("buildCodexCliArgs", () => {
  it("builds a read-only non-interactive command for structured ask runs", () => {
    const { spawnArgs, logArgs } = buildCodexCliArgs({
      prompt: "hello",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "ask",
      resumeSessionId: undefined,
      outputSchemaPath: "/tmp/output.schema.json",
      securityMode: "standard",
    });

    assert.deepStrictEqual(spawnArgs, [
      "--cd",
      "/tmp/ws",
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--output-schema",
      "/tmp/output.schema.json",
      "hello",
    ]);
    assert.deepStrictEqual(logArgs, [
      "--cd",
      "/tmp/ws",
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--output-schema",
      "/tmp/output.schema.json",
      "<redacted>",
    ]);
  });

  it("builds a workspace-write non-interactive command for mutation force runs", () => {
    const { spawnArgs } = buildCodexCliArgs({
      prompt: "change files",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "force",
      resumeSessionId: undefined,
      outputSchemaPath: undefined,
      securityMode: "standard",
    });

    assert.ok(spawnArgs.includes("--sandbox"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--sandbox") + 1], "workspace-write");
    assert.ok(spawnArgs.includes("--ask-for-approval"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--ask-for-approval") + 1], "never");
  });

  it("forwards an explicit Codex model while the provider-neutral auto sentinel uses Codex config", () => {
    const automatic = buildCodexCliArgs({
      prompt: "use configured model",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "ask",
      resumeSessionId: undefined,
      outputSchemaPath: undefined,
      securityMode: "standard",
    }).spawnArgs;
    const explicit = buildCodexCliArgs({
      prompt: "use explicit model",
      model: "gpt-5.6-sol",
      workspace: "/tmp/ws",
      executionMode: "ask",
      resumeSessionId: undefined,
      outputSchemaPath: undefined,
      securityMode: "standard",
    }).spawnArgs;

    assert.strictEqual(automatic.includes("--model"), false);
    assert.strictEqual(explicit[explicit.indexOf("--model") + 1], "gpt-5.6-sol");
  });

  it("uses codex exec resume when a real session id is available", () => {
    const { spawnArgs, logArgs } = buildCodexCliArgs({
      prompt: "continue",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "force",
      resumeSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
      outputSchemaPath: undefined,
      securityMode: "standard",
    });

    assert.deepStrictEqual(spawnArgs.slice(-5), [
      "exec",
      "--json",
      "resume",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
      "continue",
    ]);
    assert.deepStrictEqual(logArgs.slice(-5), [
      "exec",
      "--json",
      "resume",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
      "<redacted>",
    ]);
  });

  it("builds an ephemeral project-only command for untrusted structured review", () => {
    const { spawnArgs, logArgs } = buildCodexCliArgs({
      prompt: "review this project",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "ask",
      resumeSessionId: undefined,
      outputSchemaPath: "/tmp/ws/.steward/tmp/runs/request/output.schema.json",
      securityMode: "project-isolated",
      readOnlyMcpServer: {
        name: "stewardEvidence",
        command: process.execPath,
        args: ["/app/evidence-broker.js", "/tmp/ws/evidence-broker.json"],
        cwd: "/tmp/ws",
        enabledTools: ["read_project_file", "read_recent_task"],
      },
    });

    assert.strictEqual(spawnArgs.includes("--sandbox"), false);
    assert.ok(spawnArgs.includes("--strict-config"));
    assert.ok(spawnArgs.includes("--ephemeral"));
    assert.ok(spawnArgs.includes("--ignore-user-config"));
    assert.ok(spawnArgs.includes("--ignore-rules"));
    assert.ok(spawnArgs.includes("--skip-git-repo-check"));
    assert.ok(spawnArgs.includes("--ask-for-approval"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--ask-for-approval") + 1], "never");
    assert.ok(spawnArgs.includes("project_doc_max_bytes=0"));
    assert.ok(spawnArgs.includes('default_permissions="steward-project-review"'));
    assert.ok(spawnArgs.includes("permissions.steward-project-review.network.enabled=false"));
    assert.ok(spawnArgs.includes('shell_environment_policy.inherit="core"'));
    assert.ok(
      spawnArgs.includes(
        'shell_environment_policy.exclude=["CODEX_HOME","OPENAI_API_KEY","CODEX_API_KEY","CODEX_ACCESS_TOKEN"]'
      )
    );
    assert.ok(spawnArgs.includes("allow_login_shell=false"));
    assert.ok(spawnArgs.includes("tools.web_search=false"));
    assert.ok(spawnArgs.includes("skills.include_instructions=false"));
    for (const feature of [
      "memories",
      "plugins",
      "apps",
      "multi_agent",
      "hooks",
      "shell_snapshot",
      "shell_tool",
      "unified_exec",
      "browser_use_full_cdp_access",
    ]) {
      assert.ok(spawnArgs.includes(feature));
    }

    const filesystemConfig = spawnArgs.find((value) =>
      value.startsWith("permissions.steward-project-review.filesystem=")
    );
    assert.ok(filesystemConfig);
    assert.match(filesystemConfig, /":root"="deny"/);
    assert.doesNotMatch(filesystemConfig, /":minimal"/);
    assert.doesNotMatch(filesystemConfig, /":workspace_roots"/);
    assert.ok(
      spawnArgs.includes('mcp_servers.stewardEvidence.default_tools_approval_mode="approve"')
    );
    assert.ok(
      spawnArgs.includes(
        'mcp_servers.stewardEvidence.enabled_tools=["read_project_file","read_recent_task"]'
      )
    );
    assert.ok(spawnArgs.includes("mcp_servers.stewardEvidence.required=true"));
    assert.strictEqual(logArgs.at(-1), "<redacted>");
  });

  it("rejects session resumption for ephemeral project-isolated review", () => {
    assert.throws(
      () =>
        buildCodexCliArgs({
          prompt: "continue",
          model: DEFAULT_LLM_MODEL,
          workspace: "/tmp/ws",
          executionMode: "ask",
          resumeSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
          outputSchemaPath: "/tmp/ws/output.schema.json",
          securityMode: "project-isolated",
        }),
      /cannot resume/i
    );
  });
});

describe("buildProjectIsolatedCodexSpawnEnv", () => {
  it("retains only core OS, Codex auth, proxy, certificate, locale, and run-temp values", () => {
    const spawnEnv = buildProjectIsolatedCodexSpawnEnv({
      sourceEnv: {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/tester",
        USER: "tester",
        LANG: "en_CA.UTF-8",
        LC_TIME: "en_CA.UTF-8",
        CODEX_HOME: "/Users/tester/.codex",
        OPENAI_API_KEY: "openai-key",
        HTTPS_PROXY: "https://proxy.example",
        SSL_CERT_FILE: "/etc/ssl/cert.pem",
        CTO_AGENT_TMP_DIR: "/stale/run-dir",
        AWS_SECRET_ACCESS_KEY: "must-not-leak",
        DATABASE_URL: "must-not-leak",
        NODE_OPTIONS: "--require /tmp/malicious.js",
      },
      agentTmpDir: "/tmp/ws/.steward/tmp/runs/request",
      isolatedCodexHome: "/tmp/ws/.steward/tmp/runs/outer/codex-home",
    });

    assert.deepStrictEqual(spawnEnv, {
      PATH: "/usr/bin:/bin",
      HOME: "/Users/tester",
      USER: "tester",
      LANG: "en_CA.UTF-8",
      LC_TIME: "en_CA.UTF-8",
      CODEX_HOME: "/tmp/ws/.steward/tmp/runs/outer/codex-home",
      OPENAI_API_KEY: "openai-key",
      HTTPS_PROXY: "https://proxy.example",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      CTO_AGENT_TMP_DIR: "/tmp/ws/.steward/tmp/runs/request",
      TMPDIR: "/tmp/ws/.steward/tmp/runs/request",
      TMP: "/tmp/ws/.steward/tmp/runs/request",
      TEMP: "/tmp/ws/.steward/tmp/runs/request",
    });
  });
});

describe("selectCodexCliCommand", () => {
  it("uses an explicitly configured executable without silently falling back", () => {
    assert.strictEqual(
      selectCodexCliCommand({
        configuredPath: "/opt/codex/bin/codex",
        platform: "darwin",
        bundledCodexExists: true,
      }),
      "/opt/codex/bin/codex"
    );
  });

  it("uses the ChatGPT-bundled executable on macOS when no path is configured", () => {
    assert.strictEqual(
      selectCodexCliCommand({
        configuredPath: undefined,
        platform: "darwin",
        bundledCodexExists: true,
      }),
      "/Applications/ChatGPT.app/Contents/Resources/codex"
    );
  });

  it("uses PATH on other installations when the macOS bundle is unavailable", () => {
    assert.strictEqual(
      selectCodexCliCommand({
        configuredPath: undefined,
        platform: "linux",
        bundledCodexExists: false,
      }),
      "codex"
    );
  });
});

describe("assertCodexCliCompatibility", () => {
  const successfulProbe = {
    status: 0,
    stdout: "codex-cli 0.145.0\n",
    stderr: "",
    errorMessage: undefined,
  };

  it("accepts a CLI exposing the standard non-interactive contract", () => {
    assert.doesNotThrow(() =>
      assertCodexCliCompatibility({
        command: "/Applications/ChatGPT.app/Contents/Resources/codex",
        securityMode: "standard",
        version: successfulProbe,
        rootHelp: {
          ...successfulProbe,
          stdout: "--sandbox <SANDBOX_MODE> --ask-for-approval <APPROVAL_POLICY>",
        },
        execHelp: {
          ...successfulProbe,
          stdout: "resume --json --output-schema <FILE>",
        },
      })
    );
  });

  it("fails with one actionable structured error when the executable cannot start", () => {
    assert.throws(
      () =>
        assertCodexCliCompatibility({
          command: "/missing/codex",
          securityMode: "standard",
          version: {
            status: null,
            stdout: "",
            stderr: "",
            errorMessage: "spawnSync /missing/codex ENOENT",
          },
          rootHelp: successfulProbe,
          execHelp: successfulProbe,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.strictEqual(error.code, ERR_AGENT_CLI_CONTRACT);
        assert.strictEqual(error.context.command, "/missing/codex");
        assert.strictEqual(error.context.reason, "version_check_failed");
        assert.match(String(error.context.nextAction), /CTO_CODEX_CLI_PATH/);
        return true;
      }
    );
  });

  it("rejects a binary that lacks the required installed command surface", () => {
    assert.throws(
      () =>
        assertCodexCliCompatibility({
          command: "/old/codex",
          securityMode: "standard",
          version: successfulProbe,
          rootHelp: { ...successfulProbe, stdout: "--sandbox <SANDBOX_MODE>" },
          execHelp: { ...successfulProbe, stdout: "--json" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.strictEqual(error.code, ERR_AGENT_CLI_CONTRACT);
        assert.strictEqual(error.context.reason, "unsupported_command_surface");
        assert.deepStrictEqual(error.context.missingCapabilities, [
          "--ask-for-approval",
          "exec resume",
          "--output-schema",
        ]);
        return true;
      }
    );
  });

  it("requires ephemeral and config-isolation flags for project-isolated review", () => {
    assert.throws(
      () =>
        assertCodexCliCompatibility({
          command: "/old/codex",
          securityMode: "project-isolated",
          version: successfulProbe,
          rootHelp: {
            ...successfulProbe,
            stdout:
              "--config <key=value> --disable <FEATURE> --strict-config --ask-for-approval <APPROVAL_POLICY>",
          },
          execHelp: {
            ...successfulProbe,
            stdout: "--json --output-schema <FILE>",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.deepStrictEqual(error.context.missingCapabilities, [
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
        ]);
        return true;
      }
    );
  });
});
