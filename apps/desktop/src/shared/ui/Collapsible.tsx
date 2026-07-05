import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface CollapsibleProps {
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Zwijana sekcja formularza (np. „Zaawansowane"). Body jest odmontowywane po
 * zamknięciu — wartości pól muszą żyć w stanie rodzica, nie w DOM.
 */
export function Collapsible({ title, description, defaultOpen = false, children, className }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={["ui-collapsible", open ? "is-open" : "", className ?? ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="ui-collapsible-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={16} className="ui-collapsible-chevron" aria-hidden />
        <span className="ui-collapsible-heading">
          <span className="ui-collapsible-title">{title}</span>
          {description ? <span className="ui-collapsible-description">{description}</span> : null}
        </span>
      </button>
      {open ? <div className="ui-collapsible-body">{children}</div> : null}
    </section>
  );
}
