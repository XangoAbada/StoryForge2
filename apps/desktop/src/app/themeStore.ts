import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "storyforge2.ui.theme";
const darkQuery = "(prefers-color-scheme: dark)";

type ThemeState = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

function readPreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function canMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return canMatchMedia() && window.matchMedia(darkQuery).matches ? "dark" : "light";
  }
  return preference;
}

function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
  }
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const preference = readPreference();
  const resolved = resolve(preference);
  applyTheme(resolved);

  if (canMatchMedia()) {
    window.matchMedia(darkQuery).addEventListener("change", () => {
      if (get().preference === "system") {
        const next = resolve("system");
        applyTheme(next);
        set({ resolved: next });
      }
    });
  }

  return {
    preference,
    resolved,
    setPreference: (next) => {
      window.localStorage.setItem(STORAGE_KEY, next);
      const nextResolved = resolve(next);
      applyTheme(nextResolved);
      set({ preference: next, resolved: nextResolved });
    }
  };
});
