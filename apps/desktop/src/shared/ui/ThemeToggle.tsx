import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../app/themeStore";

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation("shell");
  const resolved = useThemeStore((state) => state.resolved);
  const setPreference = useThemeStore((state) => state.setPreference);
  const next = resolved === "dark" ? "light" : "dark";
  const label = t(`shell.theme.${next}`);

  return (
    <button
      type="button"
      className={["ui-btn", "ui-btn-icon", "ui-theme-toggle", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      onClick={() => setPreference(next)}
      title={label}
      aria-label={label}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={resolved}
          className="ui-theme-toggle-icon"
          initial={{ opacity: 0, rotate: -40, scale: 0.7 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 40, scale: 0.7 }}
          transition={{ duration: 0.16 }}
        >
          {resolved === "dark" ? <Moon size={16} /> : <Sun size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
