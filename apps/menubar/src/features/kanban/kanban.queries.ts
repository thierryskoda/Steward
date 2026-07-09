import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICtoItem } from "@steward/contracts/schemas";
import { getCtoItems, approveFinding, rejectFinding, undoFinding } from "../../runtime-client.js";
import { queryKeys } from "../../utils/query-keys.js";
import { LOAD_TIMEOUT_MS, withLoadTimeout } from "../../utils/query-utils.js";
import { useSelectedProjectQuery } from "../settings/settings.queries.js";

export function useCtoItemsQuery(args: {
  projectRoot: string;
  enabled?: boolean;
}): UseQueryResult<ICtoItem[], Error> {
  return useQuery({
    queryKey: queryKeys.cto.items(args.projectRoot),
    queryFn: () => withLoadTimeout(getCtoItems(args.projectRoot), LOAD_TIMEOUT_MS),
    enabled: args.enabled ?? true,
  });
}

type IApproveFindingVars = { itemId: string; selectedOptionId?: "A" | "B" | "C" };
type IRejectFindingVars = { itemId: string; rejectReason: string };

export function useKanbanApproveFindingMutation(): UseMutationResult<
  void,
  Error,
  IApproveFindingVars,
  unknown
> {
  const queryClient = useQueryClient();
  const { data: selectedRoot } = useSelectedProjectQuery();
  return useMutation({
    mutationFn: (vars: IApproveFindingVars) => approveFinding(selectedRoot ?? "", vars),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cto.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
    },
  });
}

export function useKanbanRejectFindingMutation(): UseMutationResult<
  void,
  Error,
  IRejectFindingVars,
  unknown
> {
  const queryClient = useQueryClient();
  const { data: selectedRoot } = useSelectedProjectQuery();
  return useMutation({
    mutationFn: (vars: IRejectFindingVars) => rejectFinding(selectedRoot ?? "", vars),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cto.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
    },
  });
}

export function useKanbanUndoFindingMutation(): UseMutationResult<
  void,
  Error,
  { itemId: string },
  unknown
> {
  const queryClient = useQueryClient();
  const { data: selectedRoot } = useSelectedProjectQuery();
  return useMutation({
    mutationFn: (vars: { itemId: string }) => undoFinding(selectedRoot ?? "", vars),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cto.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
    },
  });
}
