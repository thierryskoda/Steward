import { z } from "zod";

const appServerErrorSchema = z
  .object({
    code: z.number(),
    message: z.string().min(1),
    data: z.unknown().optional(),
  })
  .passthrough();

const appServerRequestIdSchema = z.union([z.number().int(), z.string().min(1)]);

export const CodexAppServerErrorResponseSchema = z
  .object({ id: appServerRequestIdSchema, error: appServerErrorSchema })
  .passthrough();

const appServerResponseSchema = z.union([
  CodexAppServerErrorResponseSchema,
  z
    .object({ id: appServerRequestIdSchema, result: z.unknown() })
    .passthrough()
    .refine((message) => Object.hasOwn(message, "result"), {
      message: "A successful app-server response must contain a result.",
    }),
]);

const appServerRequestSchema = z
  .object({
    id: appServerRequestIdSchema,
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .passthrough();

const appServerNotificationSchema = z.object({
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export const CodexAppServerMessageSchema = z.union([
  appServerResponseSchema,
  appServerRequestSchema,
  appServerNotificationSchema,
]);

export const CodexAppServerInitializeResultSchema = z
  .object({
    codexHome: z.string().min(1),
  })
  .passthrough();

const codexSessionSourceSchema = z.union([
  z.enum(["cli", "vscode", "exec", "appServer", "unknown"]),
  z.object({ custom: z.string() }).strict(),
  z.object({ subAgent: z.unknown() }).strict(),
]);

export const CodexAppServerThreadStartResultSchema = z
  .object({
    activePermissionProfile: z.object({ id: z.string().min(1) }).passthrough(),
    runtimeWorkspaceRoots: z.array(z.string().min(1)),
    sandbox: z
      .object({
        type: z.literal("readOnly"),
        networkAccess: z.literal(false),
      })
      .passthrough(),
    thread: z
      .object({
        id: z.string().uuid(),
        source: codexSessionSourceSchema,
        ephemeral: z.boolean(),
        cwd: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export const CodexAppServerTurnStartResultSchema = z
  .object({
    turn: z
      .object({
        id: z.string().uuid(),
      })
      .passthrough(),
  })
  .passthrough();

export const CodexAppServerEmptyResultSchema = z.object({}).passthrough();

export const CodexAppServerTurnCompletedParamsSchema = z
  .object({
    threadId: z.string().uuid(),
    turn: z
      .object({
        id: z.string().uuid(),
        status: z.enum(["completed", "interrupted", "failed"]),
        error: z
          .object({ message: z.string().min(1) })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const CodexAppServerErrorParamsSchema = z
  .object({
    threadId: z.string().uuid(),
    turnId: z.string().uuid(),
    willRetry: z.boolean(),
    error: z.object({ message: z.string().min(1) }).passthrough(),
  })
  .passthrough();

export const CodexAppServerMcpStatusListResultSchema = z
  .object({
    data: z.array(
      z
        .object({
          name: z.string().min(1),
          tools: z.record(z.unknown()),
          resources: z.array(z.unknown()),
          resourceTemplates: z.array(z.unknown()),
        })
        .passthrough()
    ),
    nextCursor: z.string().nullable().optional(),
  })
  .passthrough();

const codexThreadSummarySchema = z
  .object({
    id: z.string().uuid(),
    source: codexSessionSourceSchema,
    ephemeral: z.boolean(),
    cwd: z.string().min(1),
    name: z.string().min(1).nullable().optional(),
  })
  .passthrough();

export const CodexAppServerThreadSearchResultSchema = z
  .object({
    data: z.array(z.object({ thread: codexThreadSummarySchema }).passthrough()),
    nextCursor: z.string().nullable().optional(),
  })
  .passthrough();

export const CodexAppServerThreadReadResultSchema = z
  .object({
    thread: codexThreadSummarySchema.extend({
      turns: z.array(
        z
          .object({
            id: z.string().uuid(),
            status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
            items: z.array(z.unknown()),
          })
          .passthrough()
      ),
    }),
  })
  .passthrough();

export const CodexAppServerUserMessageItemSchema = z
  .object({
    type: z.literal("userMessage"),
    clientId: z.string().nullable(),
  })
  .passthrough();

export const CodexAppServerFinalAgentMessageItemSchema = z
  .object({
    type: z.literal("agentMessage"),
    text: z.string(),
    phase: z.literal("final_answer"),
  })
  .passthrough();

export const CodexAppServerGetAuthStatusResultSchema = z
  .object({
    authMethod: z
      .enum([
        "apikey",
        "chatgpt",
        "chatgptAuthTokens",
        "headers",
        "agentIdentity",
        "personalAccessToken",
        "bedrockApiKey",
      ])
      .nullable(),
    authToken: z.null(),
    requiresOpenaiAuth: z.boolean().nullable(),
  })
  .passthrough();

export const CodexMcpServerInventorySchema = z.array(
  z
    .object({
      name: z.string().min(1).max(200),
      enabled: z.boolean(),
      transport: z.object({ type: z.enum(["stdio", "streamable_http"]) }).passthrough(),
    })
    .passthrough()
);

export const CodexAppServerConfigReadResultSchema = z
  .object({
    config: z
      .object({
        analytics: z
          .object({ enabled: z.boolean().optional() })
          .passthrough()
          .nullable()
          .optional(),
        chatgpt_base_url: z.string().url().nullable().optional(),
        check_for_update_on_startup: z.boolean().nullable().optional(),
        developer_instructions: z.string().nullable().optional(),
        experimental_compact_prompt_file: z.string().nullable().optional(),
        experimental_instructions_file: z.string().nullable().optional(),
        experimental_thread_config_endpoint: z.string().nullable().optional(),
        feedback: z.object({ enabled: z.boolean().optional() }).passthrough().nullable().optional(),
        features: z
          .object({
            shell_tool: z.boolean().optional(),
            unified_exec: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        forced_chatgpt_workspace_id: z
          .union([z.string(), z.array(z.string())])
          .nullable()
          .optional(),
        forced_login_method: z.enum(["chatgpt", "api"]).nullable().optional(),
        mcp_servers: z
          .record(
            z
              .object({
                enabled: z.boolean().nullable().optional(),
                command: z.string().min(1).nullable().optional(),
                url: z.string().min(1).nullable().optional(),
              })
              .passthrough()
          )
          .optional(),
        instructions: z.string().nullable().optional(),
        log_dir: z.string().min(1).nullable().optional(),
        model_catalog_json: z.string().nullable().optional(),
        model_instructions_file: z.string().nullable().optional(),
        model_provider: z.string().nullable().optional(),
        model_providers: z.record(z.unknown()).optional(),
        notify: z.array(z.string()).nullable().optional(),
        openai_base_url: z.string().url().nullable().optional(),
        otel: z
          .object({
            exporter: z.unknown().optional(),
            log_user_prompt: z.boolean().optional(),
            metrics_exporter: z.unknown().optional(),
            trace_exporter: z.unknown().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        project_doc_fallback_filenames: z.array(z.string()).optional(),
        project_doc_max_bytes: z.number().int().nonnegative().optional(),
        projects: z
          .record(
            z.object({ trust_level: z.enum(["trusted", "untrusted"]).optional() }).passthrough()
          )
          .optional(),
        user_instructions: z.string().nullable().optional(),
      })
      .passthrough(),
    origins: z.record(
      z
        .object({
          name: z.object({ type: z.string().min(1) }).passthrough(),
        })
        .passthrough()
    ),
    layers: z
      .array(
        z
          .object({
            name: z.discriminatedUnion("type", [
              z.object({ type: z.literal("project"), dotCodexFolder: z.string().min(1) }),
              z.object({ type: z.literal("sessionFlags") }),
              z.object({ type: z.literal("user") }).passthrough(),
              z.object({ type: z.literal("system") }).passthrough(),
              z.object({ type: z.literal("mdm") }).passthrough(),
              z.object({ type: z.literal("enterpriseManaged") }).passthrough(),
              z.object({ type: z.literal("legacyManagedConfigTomlFromFile") }).passthrough(),
              z.object({ type: z.literal("legacyManagedConfigTomlFromMdm") }).passthrough(),
            ]),
            disabledReason: z.string().nullable().optional(),
          })
          .passthrough()
      )
      .nullable()
      .optional(),
  })
  .passthrough();
