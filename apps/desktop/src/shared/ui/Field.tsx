import type { ReactNode } from "react";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Akcje przy etykiecie (np. przyciski AI). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, actions, children, className }: FieldProps) {
  return (
    <label className={["ui-field", className ?? ""].filter(Boolean).join(" ")}>
      <span className="ui-field-head">
        <span className="ui-field-label">{label}</span>
        {actions ? <span className="ui-field-actions">{actions}</span> : null}
      </span>
      {children}
      {hint ? <span className="ui-field-hint">{hint}</span> : null}
    </label>
  );
}
