import type { IRuntimeStatusResponse } from "@steward/contracts/schemas";

type IRuntimeState = IRuntimeStatusResponse;

let state: IRuntimeState = {
  pid: 0,
  state: "stopped",
  startedAt: 0,
  lastHeartbeatAt: 0,
  lastError: null,
};

export function getRuntimeState(): IRuntimeState {
  return { ...state };
}

export function updateRuntimeState(partial: Partial<IRuntimeState>): void {
  state = {
    ...state,
    ...partial,
  };
}
