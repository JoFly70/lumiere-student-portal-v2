import { useT } from "@/i18n";

/** Keyboard users reach the page content without tabbing through the sidebar, search and header controls. */
export function StudentSkipLink() {
  const { t } = useT();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-student-seal focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-student-seal-ink"
      data-testid="student-skip-link"
    >
      {t("app.skipToContent")}
    </a>
  );
}
