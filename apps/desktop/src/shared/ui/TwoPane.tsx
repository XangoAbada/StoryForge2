import type { CSSProperties, ReactNode } from "react";

export interface TwoPaneProps {
  /** Zawartość lewego panelu (lista + wyszukiwarka). */
  pane: ReactNode;
  children: ReactNode;
  paneWidth?: number;
  className?: string;
}

export function TwoPane({ pane, children, paneWidth = 280, className }: TwoPaneProps) {
  return (
    <div
      className={["ui-two-pane", className ?? ""].filter(Boolean).join(" ")}
      style={{ "--pane-width": `${paneWidth}px` } as CSSProperties}
    >
      <aside className="ui-pane-list">{pane}</aside>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}
