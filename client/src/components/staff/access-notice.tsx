/**
 * One-time, calm notice for a staff member who was redirected away from a page their role cannot open
 * (ProtectedRoute stores a flag in sessionStorage; the shell reads and clears it). Client only: the redirect and
 * the server guards are unchanged.
 */
import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { useLocation } from "wouter";
import { useT } from "@/i18n";
import { StaffNotice } from "@/components/staff/staff-ui";

export const ACCESS_NOTICE_KEY = "lumiere_access_notice";

export function flagAccessNotice(): void {
  try { sessionStorage.setItem(ACCESS_NOTICE_KEY, "restricted"); } catch { /* storage blocked: the redirect still works */ }
}

export function AccessNotice() {
  const { t } = useT();
  const [location] = useLocation();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(ACCESS_NOTICE_KEY)) { sessionStorage.removeItem(ACCESS_NOTICE_KEY); setShow(true); }
    } catch { /* ignore */ }
  }, [location]);
  if (!show) return null;
  return (
    <div className="mb-4" data-testid="access-notice">
      <StaffNotice tone="gold" role="status" icon={<Info className="h-4 w-4" />} action={<button type="button" onClick={() => setShow(false)} className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-student-gold-ink" aria-label={t("staff.access.dismiss")}><X className="h-4 w-4" aria-hidden="true" /></button>}>
        {t("staff.access.restricted")}
      </StaffNotice>
    </div>
  );
}
