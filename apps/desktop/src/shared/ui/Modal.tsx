import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button";

export interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
  /** Stopka: przyciski akcji; Button variant="danger" wyrównuje się do lewej. */
  footer?: ReactNode;
  labelledBy?: string;
}

export function Modal({ title, onClose, size = "md", children, footer }: ModalProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    shellRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="ui-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        className={`ui-modal ui-modal-${size}`}
        tabIndex={-1}
      >
        <header className="ui-modal-head">
          <h2>{title}</h2>
          <Button variant="icon" aria-label="Zamknij" onClick={onClose}>
            <X size={16} aria-hidden />
          </Button>
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer ? <footer className="ui-modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}
