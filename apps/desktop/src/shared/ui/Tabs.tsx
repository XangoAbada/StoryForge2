import type { ReactNode } from "react";

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
  return (
    <div className={["ui-seg", className ?? ""].filter(Boolean).join(" ")} role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button key={item.id} type="button" aria-pressed={item.id === value} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
