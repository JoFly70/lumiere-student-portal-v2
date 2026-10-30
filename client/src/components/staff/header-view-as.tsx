/**
 * Persistent "View as student" in the staff header (top-right) on every student-file page, admin only. Same action
 * and audit trail as the old in-page button: useExperienceAction opens the student's experience in a new tab.
 */
import { useLocation } from "wouter";
import { Eye, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useExperienceAction } from "@/components/admin/dossier/dossier-parts";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { studentIdFromPath } from "@/components/orb/staff-orb";

function ViewAsButton({ studentId }: { studentId: string }) {
  const { t } = useT();
  const action = useExperienceAction(studentId);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className={cn(ownerBtn.seal, "inline-flex min-h-10 items-center gap-2 px-3")}
        onClick={() => void action.run()}
        disabled={action.pending}
        aria-label={t("staff.viewAs")}
        data-testid="button-view-as-student"
      >
        {action.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        <span className="hidden sm:inline">{t("staff.viewAs")}</span>
      </button>
      {action.error ? (
        <p role="alert" className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-student-line bg-student-card p-2 text-xs text-student-ink shadow-md" data-testid="view-as-error">
          {action.error} <button type="button" className="font-semibold text-student-gold-ink underline" onClick={action.dismiss}>OK</button>
        </p>
      ) : null}
    </div>
  );
}

export function HeaderViewAs() {
  const { user } = useAuth();
  const [location] = useLocation();
  const id = user?.role === "admin" ? studentIdFromPath(location) : null;
  if (!id) return null;
  return <ViewAsButton key={id} studentId={id} />;
}
