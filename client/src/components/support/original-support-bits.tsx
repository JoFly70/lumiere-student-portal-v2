/** S18 — small shared pieces of the restored original Support UI. */
import React from "react";
import { CheckCircle2, Circle, Clock, Loader2, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TicketStatus } from "@shared/support-contract";
import { ORIGINAL_STATUS_STYLE } from "./original-support-adapter";
import { SUPPORT_TEXT as T } from "./original-support-text";

export const STATUS_ICON: Readonly<Record<TicketStatus, LucideIcon>> = {
  open: Circle,
  in_progress: Loader2,
  waiting_on_student: Clock,
  resolved: CheckCircle2,
  closed: CheckCircle2,
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  const style = ORIGINAL_STATUS_STYLE[status];
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant="secondary" className={`${style.bgColor} ${style.color}`} data-testid="status-badge" data-status={status}>
      <Icon className="mr-1 h-3 w-3" aria-hidden="true" />
      {T.status[status]}
    </Badge>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
