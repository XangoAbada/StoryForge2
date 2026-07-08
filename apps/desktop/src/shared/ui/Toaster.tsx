import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToastStore, type ToastVariant } from "./toastStore";

const ICONS: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return createPortal(
    <div className="ui-toaster" role="region" aria-label="Powiadomienia">
      <AnimatePresence>
        {toasts.map((item) => {
          const Icon = ICONS[item.variant];
          return (
            <motion.div
              key={item.id}
              className={`ui-toast ui-toast-${item.variant}`}
              role="status"
              aria-live={item.variant === "error" ? "assertive" : "polite"}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <Icon size={16} aria-hidden className="ui-toast-icon" />
              <span className="ui-toast-message">{item.message}</span>
              <button
                type="button"
                className="ui-toast-close"
                aria-label="Zamknij powiadomienie"
                onClick={() => dismiss(item.id)}
              >
                <X size={14} aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body
  );
}
