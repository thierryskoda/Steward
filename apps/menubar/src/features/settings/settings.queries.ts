import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  IAgentCliProvider,
  IConfigResponse,
  IRuntimeStatusResponse,
  IScanningStatusResponse,
  IDocumentationRefreshStatusResponse,
  INextCommitmentRunResponse,
  INextCommitmentStatusResponse,
  IInitializeConfigBody,
  IRulesSnapshotResponse,
  IUpdateConfigBody,
} from "@steward/contracts/schemas";
import {
  getConfig,
  getConnectionConfig,
  getRuntimeStatus,
  getScanningStatus,
  getDocumentationRefreshStatus,
  getNextCommitmentStatus,
  startNextCommitmentRun,
  getLogsDir,
  getRulesSnapshot,
  initializeProjectConfig,
  listProjects,
  getSelectedProject,
  setSelectedProject,
  addProject,
  getCliProvider,
  removeProject,
  setCliProvider,
  startProject,
  stopProject,
  updateConfig,
} from "../../runtime/bridge.js";
import { isRuntimeClientError } from "../../runtime/errors.js";
import type { IProjectWithStatus } from "../../runtime/bridge.js";
import { queryKeys } from "../../utils/query-keys.js";

type IQueryOptions = { enabled?: boolean };

export function useConnectionConfigQuery(
  options?: IQueryOptions
): UseQueryResult<{ baseUrl: string } | null, Error> {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";
  return useQuery({
    queryKey: queryKeys.settings.connectionConfig(selectedRoot ?? "__no-project__"),
    queryFn: getConnectionConfig,
    enabled: (options?.enabled ?? true) && hasSelectedRoot,
  });
}

export function useRuntimeStatusQuery(
  options?: IQueryOptions
): UseQueryResult<IRuntimeStatusResponse | null, Error> {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";
  return useQuery({
    queryKey: queryKeys.settings.runtimeStatus(selectedRoot ?? "__no-project__"),
    queryFn: () => getRuntimeStatus(selectedRoot ?? ""),
    enabled: (options?.enabled ?? true) && hasSelectedRoot,
  });
}

export function useScanningStatusQuery(
  options?: IQueryOptions
): UseQueryResult<IScanningStatusResponse | null, Error> {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";
  return useQuery({
    queryKey: queryKeys.settings.scanningStatus(selectedRoot ?? "__no-project__"),
    queryFn: () => getScanningStatus(selectedRoot ?? ""),
    enabled: (options?.enabled ?? true) && hasSelectedRoot,
  });
}

export function useDocumentationRefreshStatusQuery(
  options?: IQueryOptions
): UseQueryResult<IDocumentationRefreshStatusResponse | null, Error> {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const { data: runtimeStatus } = useRuntimeStatusQuery();
  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";
  return useQuery({
    queryKey: queryKeys.settings.documentationRefreshStatus(selectedRoot ?? "__no-project__"),
    queryFn: () => getDocumentationRefreshStatus(selectedRoot ?? ""),
    enabled: (options?.enabled ?? true) && hasSelectedRoot && runtimeStatus?.state === "running",
    refetchInterval: 30_000,
  });
}

export function useNextCommitmentQuery(
  options?: IQueryOptions
): UseQueryResult<INextCommitmentStatusResponse | null, Error> {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const { data: runtimeStatus } = useRuntimeStatusQuery();
  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";
  return useQuery({
    queryKey: queryKeys.settings.nextCommitment(selectedRoot ?? "__no-project__"),
    queryFn: () => getNextCommitmentStatus(selectedRoot ?? ""),
    enabled: (options?.enabled ?? true) && hasSelectedRoot && runtimeStatus?.state === "running",
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 2_000 : false;
    },
  });
}

export function useStartNextCommitmentMutation(): UseMutationResult<
  INextCommitmentRunResponse,
  Error,
  string,
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectRoot) => startNextCommitmentRun(projectRoot),
    onSuccess: (run, projectRoot) => {
      queryClient.setQueryData<INextCommitmentStatusResponse | null>(
        queryKeys.settings.nextCommitment(projectRoot),
        run
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.settings.nextCommitment(projectRoot),
      });
    },
  });
}

export function useIsProjectReady(): boolean {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const { data: status } = useRuntimeStatusQuery({
    enabled: !!(selectedRoot != null && selectedRoot !== ""),
  });
  return !!(selectedRoot && status?.state === "running");
}

export function useLogsDirQuery(): UseQueryResult<string, Error> {
  return useQuery({
    queryKey: queryKeys.settings.logsDir(),
    queryFn: getLogsDir,
  });
}

export function useRulesSnapshotQuery(
  options?: IQueryOptions
): UseQueryResult<IRulesSnapshotResponse, Error> {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const { data: runtimeStatus } = useRuntimeStatusQuery();
  const isRuntimeReady =
    runtimeStatus?.state === "running" || runtimeStatus?.state === "needs-config";

  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";
  return useQuery({
    queryKey: queryKeys.settings.rulesSnapshot(selectedRoot ?? "__no-project__"),
    queryFn: () => getRulesSnapshot(selectedRoot ?? ""),
    enabled: (options?.enabled ?? true) && hasSelectedRoot && isRuntimeReady,
  });
}

export function useConfigQuery(
  options?: IQueryOptions
): UseQueryResult<IConfigResponse | null, Error> {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const { data: runtimeStatus } = useRuntimeStatusQuery();
  const isRuntimeReady =
    runtimeStatus?.state === "running" || runtimeStatus?.state === "needs-config";

  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";
  return useQuery({
    queryKey: queryKeys.settings.config(selectedRoot ?? "__no-project__"),
    queryFn: () => getConfig(selectedRoot ?? ""),
    enabled: (options?.enabled ?? true) && hasSelectedRoot && isRuntimeReady,
  });
}

export function useCliProviderQuery(
  options?: IQueryOptions
): UseQueryResult<IAgentCliProvider, Error> {
  const { data: selectedRoot } = useSelectedProjectQuery();
  const hasSelectedRoot = selectedRoot != null && selectedRoot !== "";
  return useQuery({
    queryKey: queryKeys.settings.cliProvider(selectedRoot ?? "__no-project__"),
    queryFn: () => getCliProvider(selectedRoot ?? ""),
    enabled: (options?.enabled ?? true) && hasSelectedRoot,
  });
}

export function useUpdateConfigMutation(): UseMutationResult<
  IConfigResponse,
  Error,
  IUpdateConfigBody,
  unknown
> {
  const queryClient = useQueryClient();
  const { data: selectedRoot } = useSelectedProjectQuery();
  return useMutation({
    mutationFn: (body: IUpdateConfigBody) => updateConfig(selectedRoot ?? "", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() });
    },
  });
}

export function useSetCliProviderMutation(): UseMutationResult<
  void,
  Error,
  IAgentCliProvider,
  unknown
> {
  const queryClient = useQueryClient();
  const { data: selectedRoot } = useSelectedProjectQuery();
  const projectKey = selectedRoot ?? "__no-project__";
  return useMutation({
    mutationFn: (provider: IAgentCliProvider) => setCliProvider(selectedRoot ?? "", provider),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.cliProvider(projectKey) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() });
    },
  });
}

export function useInitializeProjectConfigMutation(): UseMutationResult<
  IConfigResponse,
  Error,
  IInitializeConfigBody,
  unknown
> {
  const queryClient = useQueryClient();
  const { data: selectedRoot } = useSelectedProjectQuery();
  const projectKey = selectedRoot ?? "__no-project__";
  return useMutation({
    mutationFn: async (body: IInitializeConfigBody): Promise<IConfigResponse> => {
      try {
        return await initializeProjectConfig(selectedRoot ?? "", body);
      } catch (error) {
        if (
          isRuntimeClientError(error) &&
          error.kind === "api" &&
          error.code === "ALREADY_INITIALIZED"
        ) {
          const existingConfig = await getConfig(selectedRoot ?? "");
          if (existingConfig !== null) return existingConfig;
        }
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.settings.runtimeStatus(projectKey),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.config(projectKey) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
    },
  });
}

export function useListProjectsQuery(): UseQueryResult<IProjectWithStatus[], Error> {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: listProjects,
  });
}

export function useSelectedProjectQuery(): UseQueryResult<string | null, Error> {
  return useQuery({
    queryKey: queryKeys.projects.selected(),
    queryFn: getSelectedProject,
  });
}

function invalidateProjectScopedQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.cto.all() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() });
}

export function useSetSelectedProjectMutation(): UseMutationResult<
  void,
  Error,
  string | null,
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectRoot: string | null) => setSelectedProject(projectRoot),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.selected() });
      invalidateProjectScopedQueries(queryClient);
    },
  });
}

export function useAddProjectMutation(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectRoot: string) => {
      await addProject(projectRoot);
      await startProject(projectRoot);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
      invalidateProjectScopedQueries(queryClient);
    },
  });
}

export function useStartProjectMutation(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectRoot: string) => startProject(projectRoot),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
      invalidateProjectScopedQueries(queryClient);
    },
  });
}

export function usePauseScanningMutation(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectRoot: string) => stopProject(projectRoot),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
      invalidateProjectScopedQueries(queryClient);
    },
  });
}

export function useRemoveProjectMutation(): UseMutationResult<
  void,
  Error,
  { projectRoot: string; selectedRoot: string | null },
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { projectRoot: string; selectedRoot: string | null }) => {
      if (args.projectRoot === args.selectedRoot) await setSelectedProject(null);
      await removeProject(args.projectRoot);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.selected() });
      invalidateProjectScopedQueries(queryClient);
    },
  });
}
