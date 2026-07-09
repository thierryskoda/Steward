import { create } from "zustand";

type IToastEnvelope = {
  message: string;
  onUndo: () => void;
  onTimeout: () => void;
  durationMs: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

type IToastState = {
  envelope: IToastEnvelope | null;
};

type IToastActions = {
  show: (args: {
    message: string;
    onUndo: () => void;
    onTimeout: () => void;
    durationMs?: number;
  }) => void;
  dismiss: () => void;
  /** Called by internal timer; runs onTimeout and clears. */
  handleTimeout: () => void;
};

export type IToastStore = IToastState & IToastActions;

const DEFAULT_DURATION_MS = 5000;

export const useToastStore = create<IToastStore>((set, get) => ({
  envelope: null,

  show(args): void {
    const prev = get().envelope;
    if (prev) {
      clearTimeout(prev.timeoutId);
    }
    const durationMs = args.durationMs ?? DEFAULT_DURATION_MS;
    const timeoutId = setTimeout(() => {
      get().handleTimeout();
    }, durationMs);
    set({
      envelope: {
        message: args.message,
        onUndo: args.onUndo,
        onTimeout: args.onTimeout,
        durationMs,
        timeoutId,
      },
    });
  },

  dismiss(): void {
    const envelope = get().envelope;
    if (envelope) {
      clearTimeout(envelope.timeoutId);
    }
    set({ envelope: null });
  },

  handleTimeout(): void {
    const envelope = get().envelope;
    if (!envelope) return;
    clearTimeout(envelope.timeoutId);
    envelope.onTimeout();
    set({ envelope: null });
  },
}));
