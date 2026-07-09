/**
 * Onboarding wizard when runtime state is needs-config: set projectContext, ruleSources, approvalMode, then Finish to run blocking activation.
 * Prefills from existing config when present; shows warning badges when sources are empty.
 */
import { useState } from "react";
import {
  useConfigQuery,
  useInitializeProjectConfigMutation,
  useSelectedProjectQuery,
} from "../settings/settings.queries.js";
import type { IConfigResponse } from "@steward/contracts/schemas";
import { BadgeInput } from "../../ui/primitives/badge-input.js";
import { Button } from "../../ui/primitives/button.js";
import { cn } from "../../ui/primitives/cn.js";

const APPROVAL_CARDS: Array<{
  value: "always_approve" | "trust_ai";
  title: string;
  description: string;
}> = [
  {
    value: "always_approve",
    title: "Strict Approval",
    description:
      "You must review and approve every finding before implementation (two options per finding).",
  },
  {
    value: "trust_ai",
    title: "Trust AI",
    description:
      "AI may propose a single recommended path; trust_ai flow when only one option is returned.",
  },
];

export function ConfigOnboardingPanel(): JSX.Element {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const { data: existingConfig, isPending: configLoading } = useConfigQuery({
    enabled: !!(selectedRoot != null && selectedRoot !== ""),
  });

  if (configLoading && existingConfig == null) {
    return (
      <main
        className="flex min-h-screen w-full flex-col items-center justify-center bg-[#F9FAFB] px-6 py-12 dark:bg-zinc-950"
        id="suggestions-panel"
      >
        <p className="text-[15px] text-zinc-500 dark:text-zinc-400">Loading…</p>
      </main>
    );
  }

  if (selectedRoot == null || selectedRoot === "") {
    return (
      <main
        className="flex min-h-screen w-full flex-col items-center justify-center bg-[#F9FAFB] px-6 py-12 dark:bg-zinc-950"
        id="suggestions-panel"
      >
        <p className="text-[15px] text-zinc-500 dark:text-zinc-400">No project selected.</p>
      </main>
    );
  }

  return (
    <ConfigOnboardingForm
      key={`${selectedRoot}-${existingConfig != null ? "loaded" : "pending"}`}
      projectRoot={selectedRoot}
      existingConfig={existingConfig ?? null}
    />
  );
}

function ConfigOnboardingForm(args: {
  projectRoot: string;
  existingConfig: IConfigResponse | null;
}): JSX.Element {
  const { projectRoot, existingConfig } = args;
  const initializeMutation = useInitializeProjectConfigMutation();

  const [ruleSources, setRuleSources] = useState<string[]>(() => existingConfig?.ruleSources ?? []);
  const [projectContext, setProjectContext] = useState<string[]>(
    () => existingConfig?.projectContext ?? []
  );
  const [approvalMode, setApprovalMode] = useState<"always_approve" | "trust_ai">(
    () => existingConfig?.approvalMode ?? "trust_ai"
  );

  const emptyRuleSources = ruleSources.length === 0;
  const emptyProjectContext = projectContext.length === 0;
  const hasWarnings = emptyRuleSources || emptyProjectContext;

  async function handleFinish(): Promise<void> {
    try {
      await initializeMutation.mutateAsync({
        ruleSources,
        projectContext,
        approvalMode,
      });
    } catch {
      // Mutation reports via query client
    }
  }

  return (
    <main
      className="flex w-full flex-col items-stretch justify-center bg-[#F9FAFB] px-6 py-12 dark:bg-zinc-950"
      id="suggestions-panel"
      role="main"
    >
      <div className="mx-auto w-full max-w-[520px] rounded-2xl border border-zinc-200 bg-white p-8 shadow-card-overlay dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 text-[20px] font-bold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">
          Project setup
        </h2>
        <p className="mb-6 text-[15px] text-zinc-500 dark:text-zinc-400">
          Configure rule sources, project context, and approval mode. You can change these later in
          Settings.
        </p>
        <div className="mb-6 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Selected project
          </p>
          <p
            className="mt-1 break-all font-mono text-[12px] leading-relaxed text-zinc-800 dark:text-zinc-200"
            title={projectRoot}
          >
            {projectRoot}
          </p>
        </div>

        {hasWarnings ? (
          <div
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
            role="status"
          >
            {emptyRuleSources ? (
              <span className="block">No rule sources — suggestions from rules will be empty.</span>
            ) : null}
            {emptyProjectContext ? (
              <span className="block">
                No project context — AI has less context about the repo.
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="mb-6 space-y-2">
          <label className="mb-1 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
            Rule sources
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Paths or globs (e.g.{" "}
            <code className="font-mono text-zinc-700 dark:text-zinc-300">AGENTS.md</code>).
          </p>
          <BadgeInput
            aria-label="Rule sources"
            value={ruleSources}
            onChange={setRuleSources}
            placeholder="Type a path and press Enter…"
          />
        </div>

        <div className="mb-6 space-y-2">
          <label className="mb-1 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
            Project context
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Files or folders to include as context (one entry per line).
          </p>
          <BadgeInput
            aria-label="Project context paths"
            value={projectContext}
            onChange={setProjectContext}
            placeholder="e.g. README.md — press Enter…"
          />
        </div>

        <div className="mb-6">
          <p className="mb-3 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
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
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50">{card.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {card.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          type="button"
          disabled={initializeMutation.isPending}
          onClick={() => void handleFinish()}
        >
          {initializeMutation.isPending ? "Setting up…" : "Finish"}
        </Button>

        {initializeMutation.isError ? (
          <p className="mt-3 text-[14px] text-red-600 dark:text-red-400">
            {initializeMutation.error instanceof Error
              ? initializeMutation.error.message
              : "Setup failed."}
          </p>
        ) : null}
      </div>
    </main>
  );
}
