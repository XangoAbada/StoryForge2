import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getAiSettings } from "../../shared/api/commands";
import { describeTextProvider } from "./textProviderInfo";
import { CodexStatusPanel } from "./CodexStatusPanel";

/**
 * Panel dostawcy AI na Dashboardzie. Dla Codeksa pokazuje pełny status (login,
 * model, reasoning); dla pozostałych dostawców — zwięzłą kartę z modelem i
 * wejściem w ustawienia, zamiast zawsze sugerować Codeksa.
 */
export function AiProviderStatusPanel() {
  const aiSettingsQuery = useQuery({
    queryKey: ["ai-settings"],
    queryFn: getAiSettings,
    retry: 0
  });
  const info = describeTextProvider(aiSettingsQuery.data);

  if (info.isCodex) {
    return <CodexStatusPanel compact />;
  }

  return (
    <section className="context-section compact">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Dostawca AI</p>
          <h2>{info.providerLabel}</h2>
        </div>
        <Bot size={18} aria-hidden="true" />
      </div>
      {info.modelLabel ? (
        <p className="muted-text">Model tekstu: {info.modelLabel}</p>
      ) : null}
      <Link to="/settings" className="model-menu-settings-link">
        Otwórz ustawienia AI
      </Link>
    </section>
  );
}
