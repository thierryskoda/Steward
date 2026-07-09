import type { IInboxFindingItem } from "@steward/contracts/schemas";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInboxFindings, approveFinding, rejectFinding } from "../../runtime-client.js";
import { queryKeys } from "../../utils/query-keys.js";
import { LOAD_TIMEOUT_MS, withLoadTimeout } from "../../utils/query-utils.js";
import { useSelectedProjectQuery } from "../settings/settings.queries.js";

export function useInboxFindingsQuery(args: {
  projectRoot: string;
  enabled?: boolean;
}): UseQueryResult<IInboxFindingItem[], Error> {
  return useQuery({
    queryKey: queryKeys.inbox.findings(args.projectRoot),
    queryFn: () => withLoadTimeout(getInboxFindings(args.projectRoot), LOAD_TIMEOUT_MS),
    enabled: args.enabled ?? true,
  });
}

export function useInboxFindingsCountQuery(args: {
  projectRoot: string;
  enabled?: boolean;
}): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: queryKeys.inbox.findings(args.projectRoot),
    queryFn: () => withLoadTimeout(getInboxFindings(args.projectRoot), LOAD_TIMEOUT_MS),
    enabled: args.enabled ?? true,
    select: (data) => data.length,
  });
}

type IApproveFindingVars = { itemId: string; selectedOptionId?: "A" | "B" | "C" };
type IRejectFindingVars = { itemId: string; rejectReason: string };

export function useApproveFindingMutation(): UseMutationResult<
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cto.all() });
    },
  });
}

export function useRejectFindingMutation(): UseMutationResult<
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cto.all() });
    },
  });
}
