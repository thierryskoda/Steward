import * as React from "react";
import { FileText, Folder, X } from "lucide-react";
import { cn } from "./cn";

interface IBadgeInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

function iconForEntry(entry: string): React.ReactElement {
  return entry.includes(".") ? (
    <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
  ) : (
    <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
  );
}

export function BadgeInput({
  value,
  onChange,
  placeholder = "Type and press Enter…",
  className,
  disabled = false,
  "aria-label": ariaLabel,
}: IBadgeInputProps): React.ReactElement {
  const [draft, setDraft] = React.useState("");

  const commitDraft = (): void => {
    const t = draft.trim();
    if (!t) return;
    if (value.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  };

  const removeAt = (index: number): void => {
    onChange([...value.slice(0, index), ...value.slice(index + 1)]);
  };

  return (
    <div
      className={cn(
        "flex min-h-[2.75rem] flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/60",
        disabled && "pointer-events-none opacity-60",
        className
      )}
    >
      {value.map((entry, i) => (
        <span
          key={`${entry}-${i}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {iconForEntry(entry)}
          <span className="truncate font-mono">{entry}</span>
          <button
            type="button"
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-50"
            onClick={(): void => removeAt(i)}
            aria-label={`Remove ${entry}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <input
        type="text"
        className="min-w-[8rem] flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        placeholder={value.length === 0 ? placeholder : ""}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e): void => setDraft(e.target.value)}
        onKeyDown={(e): void => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
          }
          if (e.key === "Backspace" && draft === "" && value.length > 0) {
            removeAt(value.length - 1);
          }
        }}
        onBlur={(): void => {
          if (draft.trim()) commitDraft();
        }}
      />
    </div>
  );
}
