import type { ReactNode } from "react";
import { X } from "lucide-react";

export interface ChipProps {
  children: ReactNode;
  tone?: "plain" | "accent" | "ai";
  /** Chip staje się przyciskiem przełączanym. */
  pressed?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  title?: string;
}

export function Chip({ children, tone = "plain", pressed, onClick, onRemove, removeLabel, title }: ChipProps) {
  const className = ["ui-chip", tone !== "plain" ? `ui-chip-${tone}` : ""].filter(Boolean).join(" ");
  const remove = onRemove ? (
    <button type="button" className="ui-chip-remove" aria-label={removeLabel ?? "Usuń"} onClick={onRemove}>
      <X size={11} aria-hidden />
    </button>
  ) : null;

  if (onClick) {
    return (
      <button type="button" className={className} aria-pressed={pressed} onClick={onClick} title={title}>
        {children}
        {remove}
      </button>
    );
  }
  return (
    <span className={className} title={title}>
      {children}
      {remove}
    </span>
  );
}
