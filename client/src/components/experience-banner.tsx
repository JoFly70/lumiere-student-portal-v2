import { useAuth, leaveExperienceTab } from "@/lib/auth";
import { useT } from "@/i18n";
import { banner } from "@/lib/experience-session";

/** Persistent, unmistakable banner shown in the owner's "Experience as student" tab. Fixed; layout offsets via --exp-h. */
export function ExperienceBanner() {
  const { experience, logout } = useAuth();
  const { language } = useT();
  if (!experience) return null;
  const copy = banner(language, experience.label);
  return (
    <div
      role="status"
      data-testid="experience-banner"
      className="fixed inset-x-0 top-0 z-40 flex h-[var(--exp-h)] items-center gap-3 bg-[#b45309] px-3 text-white shadow sm:px-4"
    >
      <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug sm:text-sm">{copy.text}</p>
      <button
        type="button"
        onClick={() => { void logout().catch(() => leaveExperienceTab()); }}
        className="min-h-[36px] shrink-0 rounded-md border border-white/70 bg-white/10 px-3 text-sm font-semibold hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        data-testid="button-exit-experience"
      >
        {copy.exit}
      </button>
    </div>
  );
}
