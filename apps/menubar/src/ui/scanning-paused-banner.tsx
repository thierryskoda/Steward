import { Button } from "./primitives/button.js";

export function ScanningPausedBanner(args: {
  isResuming: boolean;
  onResume: () => void;
}): JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
      <span>
        Scanning is paused. Existing suggestions stay available; new discovery is stopped.
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={args.isResuming}
        onClick={args.onResume}
      >
        {args.isResuming ? "Resuming..." : "Resume scanning"}
      </Button>
    </div>
  );
}
