/**
 * S25: keeps the student's EN/FR choice on the server as well as in this browser, so it follows them to another
 * device and staff can see it in "View as Student". Server: /api/student/preferences (server/routes/student-preferences.ts).
 *
 * On sign-in a saved server choice wins; with none saved, an explicit choice made in this browser is uploaded.
 * After that, every change is saved. Failures are silent: the browser copy keeps working.
 */
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { isLanguage, LANGUAGE_STORAGE_KEY, useLanguage, type Language } from "@/i18n";

export const LANGUAGE_PREFERENCE_PATH = "/api/student/preferences";

function hasExplicitBrowserChoice(): boolean {
  try {
    return isLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Pure decision for the first sync (exported for tests). */
export function initialSync(server: Language | null, local: Language, localExplicit: boolean): { apply: Language | null; upload: Language | null } {
  if (server) return { apply: server === local ? null : server, upload: null };
  return { apply: null, upload: localExplicit ? local : null };
}

const save = (language: Language) => api.put(`${LANGUAGE_PREFERENCE_PATH}/language`, { language }).catch(() => undefined);

export function LanguagePreferenceSync() {
  const { language, setLanguage } = useLanguage();
  const synced = useRef(false);
  const last = useRef<Language>(language);

  useEffect(() => {
    let cancelled = false;
    const explicit = hasExplicitBrowserChoice();
    api
      .get<{ language: unknown }>(LANGUAGE_PREFERENCE_PATH)
      .then((r) => {
        if (cancelled) return;
        const server = isLanguage(r?.language) ? r.language : null;
        const { apply, upload } = initialSync(server, last.current, explicit);
        if (apply) {
          last.current = apply;
          setLanguage(apply);
        }
        if (upload) void save(upload);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) synced.current = true;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (language === last.current) return;
    last.current = language;
    if (synced.current) void save(language);
  }, [language]);

  return null;
}
