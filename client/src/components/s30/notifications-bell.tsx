/**
 * Notifications bell: unread count + popover list. Clicking an item marks it read and navigates to its href;
 * "mark all read" clears the rest. A 503 (not switched on) shows a calm line, never an error.
 */
import React, { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isS30Unavailable, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/lib/s30-ops-queries";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { notificationText, relativeTime } from "./operations/ops-helpers";
import { useOpsT } from "./operations/use-ops-t";
import type { NotificationView } from "@shared/s30-contract";

export function NotificationsBell({ className }: { className?: string }) {
  const { t, locale } = useOpsT();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const q = useNotifications(!!user);
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = q.data?.unread ?? 0;
  const list = useMemo(() => q.data?.notifications ?? [], [q.data]);
  const now = new Date();
  const badge = unread > 99 ? "99+" : String(unread);

  const choose = (n: NotificationView) => {
    if (!n.readAt) markOne.mutate(n.id);
    setOpen(false);
    if (n.href) navigate(n.href);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="notif-bell" aria-label={unread > 0 ? t("notif.openCount", { n: unread }) : t("notif.open")}
          className={cn("relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-transparent text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2", className)}>
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          {unread > 0 ? (
            <span data-testid="notif-count" aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-semibold leading-[18px]"
              style={{ background: "var(--occ-umber, var(--t-accent))", color: "var(--t-bg, #fff)" }}>{badge}</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,360px)] p-0" data-testid="notif-popover">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="m-0 text-sm font-semibold">{t("notif.title")}</h2>
          <button type="button" className="text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-50" style={{ color: "var(--t-accent-text, inherit)" }}
            disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()} data-testid="notif-mark-all">{t("notif.markAll")}</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {q.isLoading ? <p className="m-0 px-4 py-6 text-center text-sm text-muted-foreground" role="status">{t("notif.loading")}</p>
            : q.isError ? <p className="m-0 px-4 py-6 text-center text-sm text-muted-foreground" data-testid="notif-unavailable">{isS30Unavailable(q.error) ? t("notif.unavailable") : t("notif.error")}</p>
            : list.length === 0 ? <p className="m-0 px-4 py-6 text-center text-sm text-muted-foreground" data-testid="notif-empty">{t("notif.empty")}</p>
            : (
              <ul className="m-0 list-none p-0">
                {list.map((n) => (
                  <li key={n.id} className="border-b last:border-b-0">
                    <button type="button" onClick={() => choose(n)} data-testid="notif-item" data-unread={!n.readAt}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                      <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: n.readAt ? "transparent" : "var(--t-accent, currentColor)", border: n.readAt ? "1px solid var(--t-line-2, currentColor)" : "none" }} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block break-words text-sm", !n.readAt && "font-semibold")}>
                          {!n.readAt ? <span className="sr-only">{t("notif.unread")}: </span> : null}{notificationText(t, n, locale)}
                        </span>
                        <time className="mt-0.5 block text-xs text-muted-foreground" dateTime={n.createdAt}>{relativeTime(n.createdAt, now, locale)}</time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
