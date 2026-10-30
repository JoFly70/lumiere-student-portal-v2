/**
 * The floating Lumière orb for staff screens (bottom-left, same look as the student button). Admin opens the Owner AI
 * (carrying the student when on a student file), staff opens Web research, coaches have no orb. It only navigates:
 * the destinations keep their own role guards.
 */
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";
import { LumiereOrb } from "@/components/s27/lumiere-orb";
import { useSidebarOffset } from "./use-sidebar-offset";
import "@/styles/academic-assistant.css";

export function studentIdFromPath(path: string): string | null {
  const m = /^\/admin\/students\/([^/?#]+)/.exec(path);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function StaffOrb() {
  const { user } = useAuth();
  const { t } = useT();
  const [location, navigate] = useLocation();
  useSidebarOffset();
  const role = user?.role;
  if (role !== "admin" && role !== "staff") return null;
  const base = role === "admin" ? "/admin/assistant" : "/admin/web-research";
  if (location === base || location.startsWith(`${base}/`)) return null;
  const sid = role === "admin" ? studentIdFromPath(location) : null;
  const target = sid ? `${base}?studentId=${encodeURIComponent(sid)}` : base;
  return (
    <button
      type="button"
      className="aa-fab aa-fab--staff"
      aria-label={t("orb.ask")}
      onClick={() => navigate(target)}
      data-testid="staff-orb"
      data-target={target}
    >
      <span className="aa-fab-crest"><LumiereOrb size={28} /></span>
      <span className="aa-fab-label">{t("orb.ask")}</span>
    </button>
  );
}
