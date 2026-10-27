/**
 * S18 — the restored ORIGINAL Student Support Center (presentation from
 * support-old.tsx) on the secured S16 backend.
 *
 * Counters (clickable filters) -> search + topic filter -> ticket cards with
 * inline expansion -> full detail modal (conversation + metadata panel) ->
 * create dialog. Live data only: no sample tickets, no admin toggles, no
 * client-side authorization. Strings live in original-support-text.ts
 * (SUPPORT_TEXT) so they can be swapped for t("support.*") later.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowUpRight, Calendar, ChevronDown, ChevronUp, Eye, FileText, Filter, MessageSquare, Paperclip, Plus, Search, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTickets, useUploadTicketAttachment } from "@/hooks/use-tickets";
import { SUPPORT_TOPICS, SUPPORT_TOPIC_INFO, type SupportTopic } from "@shared/support-contract";
import {
  COUNTER_KEYS,
  NO_FILTERS,
  ORIGINAL_CATEGORY_STYLE,
  ORIGINAL_PRIORITY_STYLE,
  ORIGINAL_STATUS_STYLE,
  filterCards,
  hasActiveFilters,
  showPriorityOnCard,
  sortByRecent,
  statusCounts,
  toCardModel,
  type CounterKey,
  type OriginalCardModel,
  type OriginalFilters,
} from "./original-support-adapter";
import { useSupportText } from "./original-support-text";
import { STATUS_ICON, StatusBadge, formatDate, formatFileSize } from "./original-support-bits";
import { OriginalCreateDialog, type CreatedTicket } from "./original-create-dialog";
import { OriginalTicketDetailModal } from "./original-ticket-detail";

export { SUPPORT_TEXT } from "./original-support-text";


function itemFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("item");
  } catch {
    return null;
  }
}

function TicketCard({
  ticket, isExpanded, onToggle, onViewDetails,
}: { ticket: OriginalCardModel; isExpanded: boolean; onToggle: () => void; onViewDetails: () => void }) {
  const { T, language } = useSupportText();
  const priority = ORIGINAL_PRIORITY_STYLE[ticket.priority];
  const panelId = `ticket-panel-${ticket.ticketNumber}`;
  return (
    <Card className="hover-elevate transition-all" data-testid={`ticket-card-${ticket.ticketNumber}`} data-status={ticket.status}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm text-muted-foreground" data-testid={`ticket-id-${ticket.ticketNumber}`}>{ticket.ticketNumber}</code>
              <StatusBadge status={ticket.status} />
              {showPriorityOnCard(ticket.priority) && (
                <Badge variant="secondary" className={`${priority.bgColor} ${priority.color}`}>{T.priority[ticket.priority]}</Badge>
              )}
              <Badge variant="secondary" className={ORIGINAL_CATEGORY_STYLE[ticket.category]}>{T.topics[ticket.topic]?.label ?? ticket.topicLabel}</Badge>
            </div>
            <h4 className="mb-1 text-sm font-medium [overflow-wrap:anywhere] sm:truncate" data-testid={`ticket-subject-${ticket.ticketNumber}`}>{ticket.subject}</h4>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" aria-hidden="true" />{formatDate(ticket.createdAt, language)}</span>
              <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" aria-hidden="true" />{T.list.comment(ticket.commentCount)}</span>
              {ticket.attachmentCount > 0 && (
                <span className="flex items-center gap-1"><Paperclip className="h-3 w-3" aria-hidden="true" />{ticket.attachmentCount}</span>
              )}
              {ticket.awaitingYou && <span className="font-medium text-purple-700 dark:text-purple-400">{T.list.needsReply}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon" onClick={onViewDetails} aria-label={`${T.list.viewDetails}: ${ticket.ticketNumber}`} data-testid={`button-view-${ticket.ticketNumber}`}>
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon" onClick={onToggle}
              aria-expanded={isExpanded} aria-controls={panelId}
              aria-label={`${isExpanded ? T.list.collapse : T.list.expand}: ${ticket.ticketNumber}`}
              data-testid={`button-expand-${ticket.ticketNumber}`}
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div id={panelId} className="mt-4 space-y-3 border-t pt-4" data-testid={`ticket-expanded-${ticket.ticketNumber}`}>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">{ticket.description}</p>
            {ticket.contextLabel && <p className="text-xs text-muted-foreground">{T.detail.relatedTo} <span className="font-medium text-foreground">{ticket.contextLabel}</span></p>}
            {ticket.attachmentCount > 0 && (
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="gap-1"><FileText className="h-3 w-3" />{T.list.files(ticket.attachmentCount)}</Badge>
              </div>
            )}
            <Button size="sm" onClick={onViewDetails} data-testid={`button-details-${ticket.ticketNumber}`}>
              {T.list.viewFullDetails}
              <ArrowUpRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Uploads the files chosen in the create dialog through the real attachment API, one by one, and reports truthfully. */
function PostCreateUploads({ created, onDone }: { created: CreatedTicket; onDone: () => void }) {
  const { T } = useSupportText();
  const upload = useUploadTicketAttachment(created.id);
  const [state, setState] = useState<{ added: number; failed: string[]; running: boolean }>({ added: 0, failed: [], running: created.files.length > 0 });
  const started = useRef(false);
  useEffect(() => {
    if (started.current || created.files.length === 0) return;
    started.current = true;
    (async () => {
      let added = 0;
      const failed: string[] = [];
      for (const file of created.files) {
        try { await upload.mutateAsync({ file }); added += 1; }
        catch (e) { failed.push(T.notice.fileFailed(file.name, e instanceof Error ? e.message : "")); }
      }
      setState({ added, failed, running: false });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div role="status" aria-live="polite" className="flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950/30" data-testid="create-confirmation">
      <div className="space-y-1">
        <p className="font-medium">{T.notice.created(created.ticketNumber)}</p>
        {created.files.length > 0 && state.running && <p>{T.notice.uploadingFiles(created.files.length)}</p>}
        {!state.running && state.added > 0 && <p>{T.notice.filesDone(state.added)}</p>}
        {state.failed.map((f) => <p key={f} role="alert" className="text-destructive">{f}</p>)}
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onDone} aria-label={T.notice.dismiss}><X className="h-3 w-3" /></Button>
    </div>
  );
}

export function OriginalStudentSupport() {
  const { T } = useSupportText();
  const itemParam = useMemo(itemFromUrl, []);
  const tickets = useTickets({ limit: 100 });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState<boolean>(!!itemParam);
  const [filters, setFilters] = useState<OriginalFilters>(NO_FILTERS);
  const [created, setCreated] = useState<CreatedTicket | null>(null);

  const cards = useMemo(() => sortByRecent((tickets.data?.tickets ?? []).map(toCardModel)), [tickets.data]);
  const counts = useMemo(() => statusCounts(cards), [cards]);
  const visible = useMemo(() => filterCards(cards, filters), [cards, filters]);
  const total = tickets.data?.pagination.total ?? cards.length;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const setStatus = (key: CounterKey) => setFilters((f) => ({ ...f, status: f.status === key ? "all" : key }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6" data-testid="original-student-support">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl" data-testid="text-page-title">{T.title}</h1>
          <p className="mt-1 text-muted-foreground">{T.subtitle}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-ticket">
          <Plus className="mr-2 h-4 w-4" />
          {T.createTicket}
        </Button>
      </div>

      {created && <PostCreateUploads key={created.id} created={created} onDone={() => setCreated(null)} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" role="group" aria-label={T.list.statusFilterLabel}>
        {COUNTER_KEYS.map((key) => {
          const style = ORIGINAL_STATUS_STYLE[key];
          const Icon = STATUS_ICON[key];
          const active = filters.status === key;
          return (
            <Card
              key={key}
              className={`hover-elevate cursor-pointer ${active ? "ring-2 ring-primary" : ""}`}
              data-testid={`card-status-${key}`}
            >
              <button
                type="button"
                onClick={() => setStatus(key)}
                aria-pressed={active}
                className="block w-full rounded-lg p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-4"
              >
                <div className="flex items-center gap-3">
                  <div className={`rounded-lg p-2 ${style.bgColor}`}><Icon className={`h-4 w-4 ${style.color}`} aria-hidden="true" /></div>
                  <div>
                    <p className="text-2xl font-bold" data-testid={`count-${key}`}>{tickets.isSuccess ? counts[key] : "–"}</p>
                    <p className="text-xs text-muted-foreground">{T.status[key]}</p>
                  </div>
                </div>
              </button>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-lg">{T.list.heading}</CardTitle>
            <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  placeholder={T.list.searchPlaceholder}
                  aria-label={T.list.searchLabel}
                  className="pl-9 text-base sm:text-sm"
                  value={filters.query}
                  onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                  data-testid="input-search"
                />
              </div>
              <Select value={filters.topic} onValueChange={(v) => setFilters((f) => ({ ...f, topic: v as SupportTopic | "all" }))}>
                <SelectTrigger className="w-full sm:w-56 [&>span]:flex-1 [&>span]:text-left" aria-label={T.list.topicLabel} data-testid="filter-category">
                  <Filter className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{T.list.allTopics}</SelectItem>
                  {SUPPORT_TOPICS.map((k) => <SelectItem key={k} value={k}>{T.topics[k]?.label ?? SUPPORT_TOPIC_INFO[k].label}</SelectItem>)}
                </SelectContent>
              </Select>
              {filters.status !== "all" && (
                <Button variant="outline" size="sm" onClick={() => setFilters((f) => ({ ...f, status: "all" }))} data-testid="button-clear-status">
                  {T.status[filters.status]} <X className="ml-1 h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{T.list.clearFilter}</span>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {tickets.isLoading ? (
            <div role="status" className="space-y-3" data-testid="support-loading">
              {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg border bg-muted/50" />)}
              <span className="sr-only">{T.list.loading}</span>
            </div>
          ) : tickets.isError ? (
            <div role="alert" className="space-y-3 py-8 text-center" data-testid="support-error">
              <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
              <h3 className="text-lg font-medium">{T.list.errorTitle}</h3>
              <p className="text-sm text-muted-foreground">{tickets.error instanceof Error ? tickets.error.message : ""}</p>
              <Button variant="outline" onClick={() => tickets.refetch()}>{T.list.retry}</Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center" data-testid="support-empty">
              <MessageSquare className="mx-auto mb-4 h-12 w-12 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-lg font-medium">{T.list.noTickets}</h3>
              <p className="mt-1 text-muted-foreground">{hasActiveFilters(filters) ? T.list.adjustFilters : T.list.createFirst}</p>
              {hasActiveFilters(filters) && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setFilters(NO_FILTERS)}>{T.list.clearFilter}</Button>
              )}
            </div>
          ) : (
            <div className="space-y-3" data-testid="ticket-list">
              {visible.map((t) => (
                <TicketCard key={t.id} ticket={t} isExpanded={expanded.has(t.id)} onToggle={() => toggle(t.id)} onViewDetails={() => setSelectedId(t.id)} />
              ))}
              {total > cards.length && <p className="pt-2 text-center text-xs text-muted-foreground">{T.list.showingLatest(cards.length, total)}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <OriginalCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultItemKey={itemParam}
        onCreated={(c) => { setCreateOpen(false); setCreated(c); }}
      />
      <OriginalTicketDetailModal ticketId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

export default OriginalStudentSupport;
