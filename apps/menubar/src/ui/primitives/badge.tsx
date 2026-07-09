import * as React from "react";
import { cn } from "./cn";

export interface IBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "destructive" | "success";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: IBadgeProps): React.ReactElement {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2",
        {
          "border-transparent bg-zinc-900 text-zinc-50 hover:bg-zinc-900/80 dark:bg-zinc-100 dark:text-zinc-900":
            variant === "default",
          "border-transparent bg-zinc-100 text-zinc-900 hover:bg-zinc-100/80 dark:bg-zinc-800 dark:text-zinc-100":
            variant === "secondary",
          "border border-zinc-200 text-zinc-950 dark:border-zinc-600 dark:text-zinc-100":
            variant === "outline",
          "border-transparent bg-red-500 text-zinc-50 hover:bg-red-500/80":
            variant === "destructive",
          "border-transparent bg-emerald-500 text-zinc-50 hover:bg-emerald-500/80":
            variant === "success",
        },
        className
      )}
      {...props}
    />
  );
}
