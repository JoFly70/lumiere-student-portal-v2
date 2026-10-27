/**
 * LOCAL UI SIMULATION harness (S20). Served only by scripts/s20/render-assistant-screens.ts, which swaps it in for
 * client/src/main.tsx via Playwright route interception. Renders the real app (authenticated student shell, stubbed API)
 * plus <AcademicAssistant /> in a sibling root, because the component is not mounted in App.tsx by this agent.
 */
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import "@/index.css";
import { queryClient } from "@/lib/queryClient";
import { I18nProvider } from "@/i18n";
import { AcademicAssistant } from "@/components/academic-assistant";

createRoot(document.getElementById("root")!).render(<App />);
const host = document.createElement("div");
host.id = "assistant-harness-root";
document.body.appendChild(host);
createRoot(host).render(
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <AcademicAssistant />
    </I18nProvider>
  </QueryClientProvider>,
);
