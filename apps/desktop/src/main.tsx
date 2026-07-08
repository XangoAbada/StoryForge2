import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MotionConfig } from "framer-motion";
import i18n from "./shared/i18n";
import { router } from "./app/router";
import { Toaster, ConfirmHost } from "./shared/ui";
import "./app/themeStore";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/source-serif-4";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles.css";
import "./styles/features/shell.css";
import "./styles/features/dashboard.css";
import "./styles/features/concept.css";
import "./styles/features/brainstorm.css";
import "./styles/features/story-bible.css";
import "./styles/features/plan.css";
import "./styles/features/editor.css";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MotionConfig reducedMotion="user">
          <RouterProvider router={router} />
          <Toaster />
          <ConfirmHost />
        </MotionConfig>
      </I18nextProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
