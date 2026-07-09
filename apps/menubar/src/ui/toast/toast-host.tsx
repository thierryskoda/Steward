import { useToastStore } from "./toast.store.js";
import { cn } from "../primitives/cn.js";

function toastVariant(message: string): "success" | "info" | "warning" | "destructive" {
  const m = message.toLowerCase();
  if (m.includes("reject")) return "warning";
  if (m.includes("fail") || m.includes("error")) return "destructive";
  if (m.includes("implement")) return "success";
  return "info";
}

export function ToastHost(): JSX.Element {
  const envelope = useToastStore((s) => s.envelope);
  const dismiss = useToastStore((s) => s.dismiss);

  if (!envelope) return <></>;

  const onUndo = envelope.onUndo;
  function onUndoClick(): void {
    onUndo();
    dismiss();
  }

  const variant = toastVariant(envelope.message);

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[1000]">
      <div
        className={cn(
          "pointer-events-auto flex animate-[toast-enter_300ms_ease-out] items-center gap-3 rounded-2xl border px-4 py-3 text-[15px] shadow-lg",
          variant === "success" &&
            "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100",
          variant === "info" &&
            "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50",
          variant === "warning" &&
            "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
          variant === "destructive" &&
            "border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
        )}
      >
        <span className="font-medium">{envelope.message}</span>
        <button
          type="button"
          className={cn(
            "rounded-lg border px-3 py-1 text-[14px] font-semibold transition-colors",
            variant === "success" &&
              "border-emerald-300 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/50",
            variant === "info" &&
              "border-zinc-300 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800",
            variant === "warning" &&
              "border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40",
            variant === "destructive" &&
              "border-red-300 text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900/50"
          )}
          onClick={onUndoClick}
        >
          Undo
        </button>
      </div>
    </div>
  );
}
