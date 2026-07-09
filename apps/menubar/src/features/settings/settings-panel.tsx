import React from "react";
import ReactMarkdown from "react-markdown";
import { Settings } from "lucide-react";
import {
  useConnectionConfigQuery,
  useCliProviderQuery,
  useConfigQuery,
  useRuntimeStatusQuery,
  useScanningStatusQuery,
  useLogsDirQuery,
  useRulesSnapshotQuery,
  useListProjectsQuery,
  useSelectedProjectQuery,
  useSetSelectedProjectMutation,
  useUpdateConfigMutation,
  useAddProjectMutation,
  useStartProjectMutation,
  usePauseScanningMutation,
  useRemoveProjectMutation,
  useSetCliProviderMutation,
} from "./settings.queries.js";
import { openLogsDirectory, openFolderDialog } from "../../runtime/bridge.js";
import type {
  IAgentCliProvider,
  IFeatureFlags,
  IRulesSnapshotCategoryEntry,
  IUpdateConfigBody,
} from "@steward/contracts/schemas";
import {
  DEFAULT_AGENT_CLI_PROVIDER,
  SELECTABLE_AGENT_CLI_PROVIDERS,
} from "@steward/contracts/schemas";
import { ErrorState } from "../../ui/error-state.js";
import { BadgeInput } from "../../ui/primitives/badge-input.js";
import { Button } from "../../ui/primitives/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/primitives/card.js";
import { Modal } from "../../ui/primitives/modal.js";
import { cn } from "../../ui/primitives/cn.js";

const FEATURE_LABELS: Record<keyof IFeatureFlags, string> = {
  genericFindingEnabled: "Generic finding",
  rulesWorkflowEnabled: "Rules workflow",
  continualLearningEnabled: "Continual learning",
  optionHintsEnabled: "Option hints",
};

const APPROVAL_CARDS: Array<{
  value: "always_approve" | "trust_ai";
  title: string;
  description: string;
}> = [
  {
    value: "always_approve",
    title: "Strict Approval",
    description: "Review every finding before implementation (two options).",
  },
  {
    value: "trust_ai",
    title: "Trust AI",
    description: "Allow streamlined flow when a single recommended option is returned.",
  },
];

type ISelectableAgentCliProvider = (typeof SELECTABLE_AGENT_CLI_PROVIDERS)[number];
type ICliProviderOption = {
  value: ISelectableAgentCliProvider;
  title: string;
  description: string;
};

const CLI_PROVIDER_LABELS: Record<
  ISelectableAgentCliProvider,
  Pick<ICliProviderOption, "title" | "description">
> = {
  cursor_cli: {
    title: "Cursor",
    description: "Cursor Agent CLI",
  },
  codex_cli: {
    title: "Codex",
    description: "Codex CLI",
  },
  claude_code_cli: {
    title: "Claude Code",
    description: "Claude Code CLI",
  },
};

const CLI_PROVIDER_OPTIONS: ICliProviderOption[] = SELECTABLE_AGENT_CLI_PROVIDERS.map((value) => ({
  value,
  ...CLI_PROVIDER_LABELS[value],
}));

export function SettingsPanel(): JSX.Element {
  const [devOpen, setDevOpen] = React.useState(false);
  const [restartRequired, setRestartRequired] = React.useState(false);
  const { data: projects = [] } = useListProjectsQuery();
  const { data: selectedRoot } = useSelectedProjectQuery();
  const setSelected = useSetSelectedProjectMutation();
  const addProjectMutation = useAddProjectMutation();
  const startProjectMutation = useStartProjectMutation();
  const pauseScanningMutation = usePauseScanningMutation();
  const removeProjectMutation = useRemoveProjectMutation();
  const updateConfigMutation = useUpdateConfigMutation();
  const setCliProviderMutation = useSetCliProviderMutation();
  const connectionQuery = useConnectionConfigQuery();
  const cliProviderQuery = useCliProviderQuery();
  const statusQuery = useRuntimeStatusQuery();
  const logsDirQuery = useLogsDirQuery();
  const scanningStatusQuery = useScanningStatusQuery();
  const selectedProjInList = projects.find((p) => p.projectRoot === selectedRoot);
  const defaultScanningStatus =
    selectedProjInList?.status === "running" ? ("active" as const) : ("paused" as const);
  const scanningStatus = scanningStatusQuery.data?.status ?? defaultScanningStatus;
  const {
    data: repoConfig,
    isPending: configPending,
    isError: configError,
    error: configErrorObj,
  } = useConfigQuery();
  const {
    data: rulesSnapshot,
    isPending: rulesPending,
    isError: rulesError,
  } = useRulesSnapshotQuery();
  const ruleCategories = rulesSnapshot?.categories ?? [];

  async function handleAddProject(): Promise<void> {
    const path = await openFolderDialog();
    if (path) addProjectMutation.mutate(path);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 pb-28 pt-8" role="tabpanel">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Settings
        </h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => void handleAddProject()}
            disabled={addProjectMutation.isPending}
          >
            {addProjectMutation.isPending ? "Adding…" : "Add project"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="px-3"
            aria-label="Developer settings"
            onClick={() => setDevOpen(true)}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {restartRequired ? (
        <div
          className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          Restart required for non-feature configuration changes to take effect.
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {projects.map((proj) => (
          <ProjectSettingsCard
            key={proj.projectKey}
            proj={proj}
            isSelected={proj.projectRoot === selectedRoot}
            scanningStatus={scanningStatus}
            repoConfig={proj.projectRoot === selectedRoot ? repoConfig : null}
            configPending={proj.projectRoot === selectedRoot ? configPending : false}
            configError={proj.projectRoot === selectedRoot ? configError : false}
            configErrorMessage={
              proj.projectRoot === selectedRoot && configErrorObj instanceof Error
                ? configErrorObj.message
                : "Failed to load config."
            }
            setSelected={() => setSelected.mutate(proj.projectRoot)}
            onStart={() => startProjectMutation.mutate(proj.projectRoot)}
            onPauseScanning={() => pauseScanningMutation.mutate(proj.projectRoot)}
            onRemove={() =>
              removeProjectMutation.mutate({
                projectRoot: proj.projectRoot,
                selectedRoot: selectedRoot ?? null,
              })
            }
            isStarting={startProjectMutation.isPending}
            isPausingScanning={pauseScanningMutation.isPending}
            isRemoving={removeProjectMutation.isPending}
            updateConfigMutation={updateConfigMutation}
            onNonFeatureSave={() => setRestartRequired(true)}
            cliProvider={proj.projectRoot === selectedRoot ? cliProviderQuery.data : undefined}
            cliProviderPending={
              proj.projectRoot === selectedRoot ? cliProviderQuery.isPending : false
            }
            cliProviderError={proj.projectRoot === selectedRoot ? cliProviderQuery.isError : false}
            cliProviderErrorMessage={
              proj.projectRoot === selectedRoot && cliProviderQuery.error instanceof Error
                ? cliProviderQuery.error.message
                : "Failed to load agent CLI."
            }
            isSettingCliProvider={setCliProviderMutation.isPending}
            onCliProviderChange={(provider) =>
              setCliProviderMutation.mutate(provider, {
                onSuccess: () => {
                  if (proj.status !== "stopped") setRestartRequired(true);
                },
              })
            }
          />
        ))}
      </div>

      <section className="mt-10">
        <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Rules categories
        </h3>
        {projects.find((p) => p.projectRoot === selectedRoot)?.status === "stopped" ? (
          <p className="text-[14px] text-zinc-500 dark:text-zinc-400">
            This project runtime is stopped. Start the runtime to view active rules categories.
          </p>
        ) : rulesPending ? (
          <p className="text-[14px] text-zinc-500 dark:text-zinc-400">Loading…</p>
        ) : rulesError ? (
          <p className="text-[14px] text-zinc-500 dark:text-zinc-400">Could not load rules.</p>
        ) : ruleCategories.length === 0 ? (
          <p className="text-[14px] text-zinc-500 dark:text-zinc-400">No rules snapshot.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {ruleCategories.map((entry) => (
              <RulesCategoryCard key={entry.categoryId} entry={entry} />
            ))}
          </div>
        )}
      </section>

      <Modal
        isOpen={devOpen}
        onClose={() => setDevOpen(false)}
        title="Developer settings"
        size="md"
      >
        <DeveloperSettingsBody
          connectionQuery={connectionQuery}
          statusQuery={statusQuery}
          logsDirQuery={logsDirQuery}
          onOpenLogs={() => void openLogsDirectory()}
        />
      </Modal>
    </div>
  );
}

function DeveloperSettingsBody(args: {
  connectionQuery: ReturnType<typeof useConnectionConfigQuery>;
  statusQuery: ReturnType<typeof useRuntimeStatusQuery>;
  logsDirQuery: ReturnType<typeof useLogsDirQuery>;
  onOpenLogs: () => void;
}): JSX.Element {
  const { connectionQuery, statusQuery, logsDirQuery, onOpenLogs } = args;

  if (connectionQuery.isPending || statusQuery.isPending) {
    return <p className="text-[14px] text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }
  if (connectionQuery.isError) {
    return (
      <ErrorState
        title="Connection"
        message={connectionQuery.error?.message ?? "Could not load connection config."}
      />
    );
  }
  if (statusQuery.isError) {
    return (
      <ErrorState
        title="Runtime status"
        message={statusQuery.error?.message ?? "Could not load runtime status."}
      />
    );
  }
  if (connectionQuery.data == null) {
    return <ErrorState title="Connection" message="Missing connection config." />;
  }
  if (statusQuery.data == null) {
    return <ErrorState title="Runtime" message="Missing runtime status." />;
  }

  const logsLoading = logsDirQuery.isPending;
  const logsErr = logsDirQuery.isError;

  return (
    <div className="space-y-4 text-[14px] text-zinc-800 dark:text-zinc-200">
      <div>
        <span className="text-zinc-500 dark:text-zinc-400">Base URL</span>
        <p className="mt-1 break-all font-mono text-[13px]">{connectionQuery.data.baseUrl}</p>
      </div>
      <div>
        <span className="text-zinc-500 dark:text-zinc-400">Runtime state</span>
        <p className="mt-1 font-medium">{statusQuery.data.state}</p>
      </div>
      <div>
        <span className="text-zinc-500 dark:text-zinc-400">PID</span>
        <p className="mt-1 font-mono">{String(statusQuery.data.pid)}</p>
      </div>
      <div>
        <span className="text-zinc-500 dark:text-zinc-400">Logs directory</span>
        {logsLoading ? (
          <p className="mt-1 text-zinc-500">Loading…</p>
        ) : logsErr ? (
          <p className="mt-1 text-red-600 dark:text-red-400">
            {logsDirQuery.error?.message ?? "Could not resolve logs path."}
          </p>
        ) : logsDirQuery.data != null ? (
          <p className="mt-1 break-all font-mono text-[13px]">{logsDirQuery.data}</p>
        ) : (
          <p className="mt-1 text-red-600 dark:text-red-400">Missing logs directory.</p>
        )}
      </div>
      <Button type="button" variant="outline" onClick={onOpenLogs}>
        Open logs
      </Button>
    </div>
  );
}

function ProjectSettingsCard(args: {
  proj: import("../../runtime/bridge.js").IProjectWithStatus;
  isSelected: boolean;
  repoConfig: import("@steward/contracts/schemas").IConfigResponse | null | undefined;
  configPending: boolean;
  configError: boolean;
  configErrorMessage: string;
  setSelected: () => void;
  onStart: () => void;
  onPauseScanning: () => void;
  onRemove: () => void;
  isStarting: boolean;
  isPausingScanning: boolean;
  isRemoving: boolean;
  updateConfigMutation: ReturnType<typeof useUpdateConfigMutation>;
  onNonFeatureSave: () => void;
  scanningStatus?: "active" | "paused";
  cliProvider: IAgentCliProvider | undefined;
  cliProviderPending: boolean;
  cliProviderError: boolean;
  cliProviderErrorMessage: string;
  isSettingCliProvider: boolean;
  onCliProviderChange: (provider: IAgentCliProvider) => void;
}): JSX.Element {
  const isScanningActive = args.isSelected
    ? args.scanningStatus === "active"
    : args.proj.status === "running";
  const isRuntimeStopped = args.proj.status === "stopped";
  const displayName = args.proj.projectRoot.split("/").pop() ?? args.proj.projectRoot;

  const [ruleSources, setRuleSources] = React.useState<string[]>(() =>
    args.repoConfig ? [...args.repoConfig.ruleSources] : []
  );
  const [projectContext, setProjectContext] = React.useState<string[]>(() =>
    args.repoConfig ? [...args.repoConfig.projectContext] : []
  );
  const [approvalMode, setApprovalMode] = React.useState<"always_approve" | "trust_ai">(
    () => args.repoConfig?.approvalMode ?? "trust_ai"
  );
  const [features, setFeatures] = React.useState<IFeatureFlags | null>(() =>
    args.repoConfig ? { ...args.repoConfig.features } : null
  );

  React.useEffect(() => {
    if (args.repoConfig) {
      setRuleSources([...args.repoConfig.ruleSources]);
      setProjectContext([...args.repoConfig.projectContext]);
      setApprovalMode(args.repoConfig.approvalMode);
      setFeatures({ ...args.repoConfig.features });
    }
  }, [args.repoConfig]);

  function handleSave(): void {
    if (!args.repoConfig || features === null) return;
    const body: IUpdateConfigBody = {
      ruleSources,
      projectContext,
      approvalMode,
      features,
    };
    args.updateConfigMutation.mutate(body, {
      onSuccess: (_data, variables) => {
        if (
          variables.ruleSources !== undefined ||
          variables.projectContext !== undefined ||
          variables.approvalMode !== undefined
        ) {
          args.onNonFeatureSave();
        }
      },
    });
  }

  return (
    <Card className="rounded-3xl border-zinc-200 dark:border-zinc-800">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 pb-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-lg text-zinc-900 dark:text-zinc-50">{displayName}</CardTitle>
          <p className="break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {args.proj.projectRoot}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!args.isSelected ? (
            <Button type="button" variant="outline" size="sm" onClick={args.setSelected}>
              Select
            </Button>
          ) : null}
          {isRuntimeStopped ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={args.isStarting}
              onClick={args.onStart}
            >
              {args.isStarting ? "Starting..." : "Start project"}
            </Button>
          ) : isScanningActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={args.isPausingScanning}
              onClick={args.onPauseScanning}
            >
              {args.isPausingScanning ? "Pausing..." : "Pause scanning"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={args.isStarting}
              onClick={args.onStart}
            >
              {args.isStarting ? "Resuming..." : "Resume scanning"}
            </Button>
          )}
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={args.isRemoving}
            onClick={args.onRemove}
          >
            Remove
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-2">
        {!args.isSelected ? (
          <p className="text-[14px] text-zinc-500 dark:text-zinc-400">
            Select this project to edit configuration, rule sources, and feature flags.
          </p>
        ) : (
          <>
            <AgentCliSelector
              value={args.cliProvider}
              isPending={args.cliProviderPending}
              isError={args.cliProviderError}
              errorMessage={args.cliProviderErrorMessage}
              isSaving={args.isSettingCliProvider}
              onChange={args.onCliProviderChange}
            />
            {args.proj.status === "stopped" ? null : args.configPending &&
              args.repoConfig == null ? (
              <p className="text-[14px] text-zinc-500 dark:text-zinc-400">Loading configuration…</p>
            ) : args.configError ? (
              <ErrorState title="Configuration" message={args.configErrorMessage} />
            ) : args.repoConfig != null && features === null ? (
              <p className="text-[14px] text-zinc-500 dark:text-zinc-400">Loading configuration…</p>
            ) : args.repoConfig != null && features != null ? (
              <>
                <div>
                  <label className="mb-2 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
                    Rule sources
                  </label>
                  <BadgeInput
                    value={ruleSources}
                    onChange={setRuleSources}
                    aria-label="Rule sources"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
                    Project context
                  </label>
                  <BadgeInput
                    value={projectContext}
                    onChange={setProjectContext}
                    aria-label="Project context"
                  />
                </div>
                <div>
                  <p className="mb-2 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
                    Approval mode
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {APPROVAL_CARDS.map((card) => {
                      const selected = approvalMode === card.value;
                      return (
                        <button
                          key={card.value}
                          type="button"
                          onClick={() => setApprovalMode(card.value)}
                          className={cn(
                            "rounded-2xl border p-4 text-left transition-all",
                            selected
                              ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:ring-zinc-100"
                              : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600"
                          )}
                        >
                          <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                            {card.title}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                            {card.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-3 text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
                    Runtime flows
                  </p>
                  <div className="flex flex-col gap-2">
                    {(Object.keys(FEATURE_LABELS) as (keyof IFeatureFlags)[]).map((key) => (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/50"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300"
                          checked={features[key]}
                          onChange={() =>
                            setFeatures((prev) => (prev ? { ...prev, [key]: !prev[key] } : prev))
                          }
                        />
                        <span className="text-[14px] text-zinc-800 dark:text-zinc-200">
                          {FEATURE_LABELS[key]}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  disabled={args.updateConfigMutation.isPending}
                  onClick={() => handleSave()}
                >
                  {args.updateConfigMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <ErrorState title="Configuration" message="Missing configuration data." />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AgentCliSelector(args: {
  value: IAgentCliProvider | undefined;
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  isSaving: boolean;
  onChange: (provider: IAgentCliProvider) => void;
}): JSX.Element {
  const selectedProvider = args.value ?? DEFAULT_AGENT_CLI_PROVIDER;

  if (args.isPending) {
    return <p className="text-[14px] text-zinc-500 dark:text-zinc-400">Loading agent CLI…</p>;
  }

  if (args.isError) {
    return <ErrorState title="Agent CLI" message={args.errorMessage} />;
  }

  return (
    <div>
      <p className="mb-2 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
        Agent CLI
      </p>
      <div role="radiogroup" aria-label="Agent CLI" className="grid gap-3 sm:grid-cols-2">
        {CLI_PROVIDER_OPTIONS.map((option) => {
          const selected = selectedProvider === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={args.isSaving}
              onClick={() => {
                if (!selected) args.onChange(option.value);
              }}
              className={cn(
                "rounded-2xl border p-4 text-left transition-all",
                selected
                  ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:ring-zinc-100"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600",
                args.isSaving ? "cursor-wait opacity-70" : ""
              )}
            >
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">{option.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {option.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RulesCategoryCard({ entry }: { entry: IRulesSnapshotCategoryEntry }): JSX.Element {
  const label = humanizeCategoryId(entry.categoryId);
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[13px] font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {label}
        </span>
        <span className="text-[12px] text-zinc-500 dark:text-zinc-400">{entry.rulePath}</span>
      </div>
      <div className="rules-markdown text-[14px] text-zinc-800 dark:text-zinc-200">
        <ReactMarkdown>{entry.ruleContent}</ReactMarkdown>
      </div>
    </div>
  );
}

function humanizeCategoryId(categoryId: string): string {
  return categoryId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
