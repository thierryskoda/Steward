import type { IInboxRuleItem } from "@steward/contracts/schemas";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInboxRules, approveRule, rejectRule } from "../../runtime-client.js";
import { queryKeys } from "../../utils/query-keys.js";
import { LOAD_TIMEOUT_MS, withLoadTimeout } from "../../utils/query-utils.js";
import { useSelectedProjectQuery } from "../settings/settings.queries.js";

export function useInboxRulesQuery(args: {
  projectRoot: string;
  enabled?: boolean;
}): UseQueryResult<IInboxRuleItem[], Error> {
  return useQuery({
    queryKey: queryKeys.inbox.rules(args.projectRoot),
    queryFn: () => withLoadTimeout(getInboxRules(args.projectRoot), LOAD_TIMEOUT_MS),
    enabled: args.enabled ?? true,
  });
}

export function useInboxRulesCountQuery(args: {
  projectRoot: string;
  enabled?: boolean;
}): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: queryKeys.inbox.rules(args.projectRoot),
    queryFn: () => withLoadTimeout(getInboxRules(args.projectRoot), LOAD_TIMEOUT_MS),
    enabled: args.enabled ?? true,
    select: (data) => data.length,
  });
}

type IApproveRuleVars = { ruleId: string };
type IRejectRuleVars = { ruleId: string };

export function useApproveRuleMutation(): UseMutationResult<
  void,
  Error,
  IApproveRuleVars,
  unknown
> {
  const queryClient = useQueryClient();
  const { data: selectedRoot } = useSelectedProjectQuery();
  return useMutation({
    mutationFn: (vars: IApproveRuleVars) => approveRule(selectedRoot ?? "", vars),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cto.all() });
    },
  });
}

export function useRejectRuleMutation(): UseMutationResult<void, Error, IRejectRuleVars, unknown> {
  const queryClient = useQueryClient();
  const { data: selectedRoot } = useSelectedProjectQuery();
  return useMutation({
    mutationFn: (vars: IRejectRuleVars) => rejectRule(selectedRoot ?? "", vars),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cto.all() });
    },
  });
}
