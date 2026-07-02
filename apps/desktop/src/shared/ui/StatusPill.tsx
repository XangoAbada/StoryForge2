import type { ReactNode } from "react";

export interface StatusPillProps {
  tone: "success" | "warn" | "muted" | "danger" | "accent";
  children: ReactNode;
  title?: string;
}

export function StatusPill({ tone, children, title }: StatusPillProps) {
  return (
    <span className={`ui-pill ui-pill-${tone}`} title={title}>
      {children}
    </span>
  );
}
