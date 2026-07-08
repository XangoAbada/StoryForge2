import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
}

export interface TabsProps<T extends string = string> {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}

export function Tabs<T extends string>({ items, value, onChange, ariaLabel }: TabsProps<T>) {
  const instanceId = useId();
  return (
    <div role="tablist" aria-label={ariaLabel} className="ui-tabs">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          className="ui-tab"
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.badge != null ? <span className="ui-tab-badge">{item.badge}</span> : null}
          {item.id === value ? (
            <motion.span
              className="ui-tab-indicator"
              layoutId={`tab-indicator-${instanceId}`}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}

export interface SegmentedProps<T extends string = string> {
  items: ReadonlyArray<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  className?: string;
}

export function Segmented<T extends string>({ items, value, onChange, ariaLabel, className }: SegmentedProps<T>) {
  const instanceId = useId();
  return (
    <div className={["ui-seg", className ?? ""].filter(Boolean).join(" ")} role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button key={item.id} type="button" aria-pressed={item.id === value} onClick={() => onChange(item.id)}>
          {item.id === value ? (
            <motion.span
              className="ui-seg-thumb"
              layoutId={`seg-thumb-${instanceId}`}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          ) : null}
          <span className="ui-seg-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
