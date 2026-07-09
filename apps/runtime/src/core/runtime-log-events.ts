/**
 * Canonical runtime log messages for core/system only.
 * Feature-owned events live in features/<feature>/ *-log-events.ts.
 */

// Runtime lifecycle
export const RUNTIME_LIFECYCLE_STARTED =
  "Runtime lifecycle started and environment configuration has been loaded.";
export const RUNTIME_ENV_DEFAULTS_APPLIED =
  "Runtime environment used default values for missing env keys.";
export const RUNTIME_LIFECYCLE_PROJECT_ROOT_SET =
  "Runtime lifecycle initialized the target project root and runtime paths.";
export const RUNTIME_LIFECYCLE_EXIT_PID_LOCK_HELD =
  "Runtime lifecycle is exiting because another runtime process already holds the PID lock.";
export const RUNTIME_LIFECYCLE_READY =
  "Runtime lifecycle startup is complete and the runtime is ready to process events.";
export const RUNTIME_INIT_STARTED =
  "Runtime initialization started; HTTP server is reachable for status polling.";
export const RUNTIME_INIT_PHASE_STARTED = "Runtime initialization phase started.";
export const RUNTIME_INIT_PHASE_COMPLETED = "Runtime initialization phase completed.";
export const RUNTIME_INIT_FAILED = "Runtime initialization failed with an error.";
export const RUNTIME_LIFECYCLE_CLEANUP_STARTED =
  "Runtime lifecycle cleanup has started and shutdown handlers are stopping active workers.";
export const RUNTIME_LIFECYCLE_STOPPED =
  "Runtime lifecycle has fully stopped and all known resources were released.";
export const RUNTIME_LIFECYCLE_CLEANUP_ERROR =
  "Runtime lifecycle cleanup failed while shutting down; check logs for details.";
export const RUNTIME_LIFECYCLE_HEARTBEAT =
  "Runtime lifecycle heartbeat check confirms the runtime is still alive.";
export const RUNTIME_LIFECYCLE_FATAL =
  "Runtime lifecycle encountered a fatal startup error and is terminating.";
export const RUNTIME_CONFIG_INVALID =
  "Runtime config exists but is invalid (parse or schema error); cannot continue.";
export const SCRIPT_CATEGORY_GENERATION_CRASHED =
  "Manual category generation script crashed before or outside main().";

// HTTP server
export const HTTP_SERVER_LISTENING =
  "The HTTP server is now up and listening for local API requests from the UI.";
export const HTTP_AUTH_TOKEN_READY =
  "The authentication token for the HTTP server has been generated and is ready for use.";
export const HTTP_HANDLER_UNCAUGHT_ERROR =
  "A request to the HTTP server failed because of an unexpected error in the code.";
export const HTTP_HANDLER_INVALID_BODY =
  "Request body was not valid JSON; the server responded with 400 INVALID_BODY.";
export const HTTP_HANDLER_VALIDATION_ERROR =
  "Request body failed schema validation; the server responded with 400 VALIDATION_ERROR.";
export const HTTP_REQUEST_COMPLETED = "The HTTP request has finished agent-running.";
export const CTO_ITEMS_RESPONSE_OK =
  "The list of items was successfully prepared and sent to the UI.";
export const HTTP_RESPONSE_ITEM_DROPPED =
  "A collection item was dropped due to schema validation failure.";
export const HTTP_RESPONSE_COLLECTION_SANITIZED =
  "Collection response had one or more items dropped; returning valid subset.";

// Transcript (bootstrap logging from main)
export const TRANSCRIPT_INGESTION_SKIPPED_NO_FEATURES =
  "Transcript ingestion not started: neither rules workflow nor continual learning is enabled.";

// Repo scope / config
export const REPO_SCOPE_CONFIG_LOADED =
  "The repository configuration was successfully loaded from SQLite.";
export const REPO_SCOPE_CONFIG_GENERATION_STARTED =
  "The system is starting to create a new repository configuration because one was missing.";
export const REPO_SCOPE_CONFIG_GENERATION_COMPLETED =
  "The new repository configuration has been created and saved.";
export const REPO_SCOPE_CONFIG_GENERATION_FAILED =
  "The system failed to create repository configuration, so it cannot start.";
export const REPO_SCOPE_CONFIG_INVALID =
  "The repository configuration is broken or has the wrong format; startup has been cancelled.";
export const REPO_SCOPE_CONFIG_MISSING =
  "Repo scope config is missing; initialize project config with ruleSources, approvalMode, and projectContext.";
export const EXCLUDE_REGEN_STARTED =
  "The system is starting to re-evaluate which files to ignore by analyzing the project structure.";
export const EXCLUDE_REGEN_COMPLETED = "The generated exclude snapshot has been updated in SQLite.";
export const EXCLUDE_REGEN_UNCHANGED =
  "The analysis finished, but the list of ignored files did not need to change.";
export const EXCLUDE_REGEN_FAILED =
  "Something went wrong while trying to update the list of ignored files.";

// Git poll
export const GIT_POLL_SNAPSHOT_CHANGED =
  "Changes were detected in the repository; waiting for things to settle before starting any automated tasks.";
export const GIT_POLL_QUIET_TRIGGER =
  "The repository has been quiet for long enough; starting automated tasks like finding issues.";
export const GIT_POLL_SKIPPED_QUIET_WINDOW =
  "The system is waiting for you to finish making changes before starting automated tasks.";
export const GIT_POLL_SKIPPED_INFLIGHT =
  "Automated tasks are already running, so a new run will start once the current one finishes.";
export const GIT_POLL_COALESCED_RUN =
  "Starting a new run of automated tasks now that the previous one has finished.";
export const GIT_SNAPSHOT_STATUS_FAILED =
  "The system failed to check the status of your git repository.";

// Agent runtime
export const AGENT_PROMPT_TOKENS =
  "The system estimated how much work the AI agent will need to do for this request.";
export const AGENT_JSON_RECOVERY_STARTED =
  "The AI agent gave an unreadable response; attempting to fix the formatting automatically.";
export const AGENT_JSON_RECOVERY_SUCCEEDED =
  "The system successfully fixed the AI agent's response into a readable format.";
export const AGENT_JSON_RECOVERY_FAILED =
  "The system couldn't fix the AI agent's response, so the task has been cancelled.";
export const AGENT_JSON_REPAIR_SUCCEEDED =
  "Structured agent JSON was fixed by deterministic repair (no LLM).";
export const AGENT_STRUCTURED_FAILED = "Structured agent run failed (CLI or parse).";
export const AGENT_TIMEOUT_IDLE =
  "The AI agent stopped responding for too long, so the system is shutting it down.";
export const AGENT_TIMEOUT_HARD =
  "The AI agent took too long to finish its task, so the system is forcing it to stop.";
export const AGENT_PROMPT_TOO_LARGE =
  "The instructions for the AI agent are too big to process, so the task was cancelled.";
export const AGENT_FAILED_SPAWN = "The system failed to start the AI agent process.";
export const AGENT_TERMINATED = "The AI agent process stopped unexpectedly before it could finish.";
export const AGENT_CLI_JSON_PARSE_FAILED =
  "The agent CLI exited but returned empty or invalid JSON.";
export const AGENT_TRANSCRIPT_CHAT_CREATED =
  "A new chat session was started to help the AI agent understand the context of your request.";
export const AGENT_TRANSCRIPT_RESUMED =
  "The system is continuing an existing chat session to help the AI agent implement changes.";
export const AGENT_TRANSCRIPT_CHAT_CREATE_FAILED =
  "The system couldn't start a chat session, so it won't be able to look up previous chat context.";
export const AGENT_TRANSCRIPT_PATHS_CHECKED =
  "The system checked for relevant chat transcript files to give to the AI agent.";
export const AGENT_TRANSCRIPT_CAPTURED =
  "The system successfully read a chat transcript and gave it to the AI agent for context.";
export const AGENT_TRANSCRIPT_CAPTURE_SKIPPED =
  "The system couldn't find a relevant chat transcript, so the AI agent will proceed without it.";
export const AGENT_TRANSCRIPT_ENTRY_PARSE_FAILED =
  "A line in the chat transcript did not match the expected schema; the line was skipped.";
export const TRANSCRIPT_INGESTION_STARTED =
  "Transcript ingestion service started; tracking paths for new messages.";
export const TRANSCRIPT_INGESTION_TICK =
  "Transcript ingestion tick completed; paths and event counts updated.";
export const AGENT_IDLE_RESUME_RETRY_SCHEDULED =
  "The AI agent timed out; the system will try to resume the session one more time.";
export const AGENT_IDLE_RESUME_RETRY_STARTED =
  "Starting a retry attempt to resume the AI agent's work.";
export const AGENT_IDLE_RESUME_RETRY_SUCCEEDED =
  "The retry attempt to resume the AI agent was successful.";
export const AGENT_IDLE_RESUME_RETRY_FAILED =
  "The retry attempt failed; the AI agent task has officially failed.";
export const AGENT_STRUCTURED_CHAT_CREATED =
  "A new structured chat session was created to help the AI agent plan its work.";
export const AGENT_STRUCTURED_CHAT_REUSED =
  "The system is reusing an existing structured chat session for the AI agent's planning phase.";
export const EVALUATE_MUTATION_OUTCOME_ERROR =
  "Evaluation of mutation outcome failed; evaluator threw or returned invalid result.";

// Agent CLI queue
export const AGENT_QUEUE_ENCLAIMED =
  "Your request has been added to the queue and is waiting for its turn to run.";
export const AGENT_QUEUE_STARTED = "Your request has started running after waiting in the queue.";
export const AGENT_QUEUE_FINISHED =
  "Your request has finished running; the results have been recorded.";
export const AGENT_QUEUE_WARN_WAIT =
  "A request had to wait in the queue for an unusually long time before starting.";
export const AGENT_QUEUE_AGE_CAP_REJECTED =
  "A request was cancelled because it spent too much time waiting in the queue.";
export const AGENT_QUEUE_HEALTH_ALERT =
  "The request queue is getting backed up; things might be running slower than usual.";
export const AGENT_QUEUE_SHUTDOWN_COMPLETED =
  "A request finished running just before the system shut down.";
export const AGENT_QUEUE_SHUTDOWN_CANCELLED =
  "A request was cancelled because the system is shutting down.";
export const AGENT_QUEUE_SHUTDOWN_ENQUEUE_REJECTED =
  "A new request was rejected because the system is currently shutting down.";
export const AGENT_TMP_DIR_CLEANUP_FAILED =
  "Run-scoped agent tmp dir could not be removed after run finished.";
export const AGENT_TMP_DIR_READDIR_FAILED =
  "Failed to read agent tmp runs dir; skipping TTL cleanup.";
export const AGENT_TMP_DIR_TTL_CLEANED =
  "Stale agent run tmp dir removed by TTL cleanup (e.g. after runtime crash).";
export const READ_JSON_SCHEMA_PARSE_ERROR = "JSON parse failed in parseJsonWithSchemaResult.";

// Workflow feature flags (bootstrap logging from main)
export const WORKFLOW_DISABLED_BY_CONFIG =
  "A specific workflow has been turned off because of a project feature setting.";
export const WORKFLOW_IMPLEMENTING_PROCESS_ERROR =
  "Something went wrong while trying to update a file; check the logs for details.";
export const WORKFLOW_WATCHER_SKIPPED_MISSING_REFS =
  "A workflow service was skipped because it was missing some required information.";

// Git poll (used by git-poll-tick in core)
export const CATEGORY_GENERATION_FAILED = "The system failed to look for issues in this category.";
