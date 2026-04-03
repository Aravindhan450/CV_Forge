import * as React from "react";

import { cn } from "@/lib/utils";

type Variant = "neutral" | "success" | "warning" | "danger";

const variantMap: Record<Variant, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-amber-700",
  danger: "bg-danger/15 text-danger",
};

export function Badge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", variantMap[variant], className)}>
      {children}
    </span>
  );
}
