/**
 * S18 — restored original "Create New Support Ticket" dialog on the secured
 * S16 create flow: topic (not category), no priority picker (students are
 * always "medium" server-side), real idempotent create, optional files that
 * are uploaded through the real attachment API after the ticket exists.
 */
import React, { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  describeCreateFailure,
  newIdempotencyKey,
  useCreateTicket,
  useSupportContextOptions,
} from "@/hooks/use-tickets";
import type { SupportTopic } from "@shared/support-contract";
import { SUPPORT_TOPIC_INFO } from "@shared/support-contract";
import { ORIGINAL_CATEGORY_STYLE } from "./original-support-adapter";
import { useSupportText } from "./original-support-text";
import { formatFileSize } from "./original-support-bits";
import { TOPIC_CHOICES, attachmentError, validateRequestDraft } from "./support-presentation";

export const MAX_CREATE_FILES = 3;

export interface CreatedTicket {
  readonly id: string;
  readonly ticketNumber: string;
  readonly files: File[];
}

export function OriginalCreateDialog({
  open,
  onClose,
  onCreated,
  defaultItemKey,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (t: CreatedTicket) => void;
  /** `?item=` deep link from the roadmap. */
  defaultItemKey?: string | null;
}) {
  const { T, language } = useSupportText();
  const [topic, setTopic] = useState<SupportTopic | null>(defaultItemKey ? "roadmap_question" : null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [itemKey, setItemKey] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // One idempotency key per distinct submission; a retry of the SAME content reuses it.
  const submissionKey = useRef<{ fingerprint: string; key: string } | null>(null);

  const createTicket = useCreateTicket();
  const contextOptions = useSupportContextOptions(open);
  const options = contextOptions.data?.available ? contextOptions.data.items : [];
  const effectiveItem = itemKey || (defaultItemKey && options.some((o) => o.key === defaultItemKey) ? defaultItemKey : "");

  const errors = validateRequestDraft({ topic, subject, description }, language);
  const failure = createTicket.isError ? describeCreateFailure(createTicket.error) : null;

  const reset = () => {
    setTopic(null); setSubject(""); setDescription(""); setItemKey(""); setFiles([]); setFileError(null); setAttempted(false);
    submissionKey.current = null;
    createTicket.reset();
  };

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    let err: string | null = null;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_CREATE_FILES) { err = T.create.maxFiles(MAX_CREATE_FILES); break; }
      const bad = attachmentError(f, language);
      if (bad) { err = bad; continue; }
      next.push(f);
    }
    setFiles(next);
    setFileError(err);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = () => {
    setAttempted(true);
    if (Object.keys(errors).length > 0 || !topic) return;
    const fingerprint = JSON.stringify([topic, subject.trim(), description.trim(), effectiveItem || null]);
    if (submissionKey.current?.fingerprint !== fingerprint) submissionKey.current = { fingerprint, key: newIdempotencyKey() };
    createTicket.mutate(
      {
        idempotencyKey: submissionKey.current.key,
        topic,
        subject: subject.trim(),
        description: description.trim(),
        context: effectiveItem ? { roadmapItemKey: effectiveItem } : undefined,
      },
      {
        // Only after the API answered successfully; never optimistic.
        onSuccess: ({ ticket }) => {
          const created = { id: ticket.id, ticketNumber: ticket.ticket_number, files };
          reset();
          onCreated(created);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !createTicket.isPending) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto sm:w-full" data-testid="create-ticket-dialog">
        <DialogHeader className="text-left">
          <DialogTitle>{T.create.title}</DialogTitle>
          <DialogDescription>{T.create.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="ticket-topic">{T.create.topic}</Label>
            <Select value={topic ?? undefined} onValueChange={(v) => setTopic(v as SupportTopic)}>
              <SelectTrigger id="ticket-topic" data-testid="select-category" aria-invalid={attempted && !!errors.topic}>
                <SelectValue placeholder={T.create.topicPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {TOPIC_CHOICES.map((t) => (
                  <SelectItem key={t.key} value={t.key} data-testid={`topic-option-${t.key}`}>{T.topics[t.key]?.label ?? t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {topic && (
              <p className="text-xs text-muted-foreground">
                <span className={`mr-2 inline-block rounded px-1.5 py-0.5 ${ORIGINAL_CATEGORY_STYLE[SUPPORT_TOPIC_INFO[topic].category]}`}>{T.topics[topic]?.label ?? SUPPORT_TOPIC_INFO[topic].label}</span>
                {T.topics[topic]?.hint ?? SUPPORT_TOPIC_INFO[topic].hint}
              </p>
            )}
            {attempted && errors.topic && <p role="alert" className="text-sm font-medium text-destructive">{errors.topic}</p>}
          </div>

          {options.length > 0 && (
            <div className="space-y-2" data-testid="context-picker">
              <Label htmlFor="ticket-context">{T.create.related}</Label>
              <select
                id="ticket-context"
                value={effectiveItem}
                onChange={(e) => setItemKey(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background sm:text-sm"
              >
                <option value="">{T.create.relatedNone}</option>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>{o.title}{o.code ? ` (${o.code})` : ""}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="subject">{T.create.subject}</Label>
            <Input
              id="subject"
              placeholder={T.create.subjectPlaceholder}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-invalid={attempted && !!errors.subject}
              data-testid="input-subject"
              className="text-base sm:text-sm"
            />
            {attempted && errors.subject && <p role="alert" className="text-sm font-medium text-destructive">{errors.subject}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{T.create.descriptionLabel}</Label>
            <Textarea
              id="description"
              placeholder={T.create.descriptionPlaceholder}
              className="min-h-[150px] text-base sm:text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-invalid={attempted && !!errors.description}
              data-testid="input-description"
            />
            {attempted && errors.description && <p role="alert" className="text-sm font-medium text-destructive">{errors.description}</p>}
          </div>

          <div className="space-y-2">
            <Label>{T.create.attachments}</Label>
            <div className="rounded-lg border-2 border-dashed p-4">
              <input
                ref={fileRef}
                type="file"
                multiple
                className="sr-only"
                aria-label={T.create.attachments}
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx"
                onChange={(e) => pickFiles(e.target.files)}
                data-testid="input-file-attachment"
              />
              {files.length > 0 ? (
                <div className="space-y-2">
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded bg-muted p-2" data-testid="selected-file">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0" />
                        <span className="truncate text-sm">{f.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">({formatFileSize(f.size, language)})</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" type="button" aria-label={T.create.remove(f.name)} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {files.length < MAX_CREATE_FILES && (
                    <Button variant="outline" size="sm" type="button" onClick={() => fileRef.current?.click()} data-testid="button-add-more-files">
                      <Plus className="mr-1 h-3 w-3" />{T.create.addMore}
                    </Button>
                  )}
                </div>
              ) : (
                <button type="button" className="w-full cursor-pointer py-4 text-center" onClick={() => fileRef.current?.click()} data-testid="button-attach-zone">
                  <Paperclip className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{T.create.attachZone}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{T.create.attachHelp}</p>
                </button>
              )}
            </div>
            {fileError && <p role="alert" className="text-sm font-medium text-destructive" data-testid="file-error">{fileError}</p>}
          </div>

          {failure && (
            <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm" data-testid="submit-error">
              {failure.message} {failure.mayHaveSaved ? T.create.maySaved : T.create.notSent}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => { if (!createTicket.isPending) onClose(); }} disabled={createTicket.isPending} data-testid="button-cancel-ticket">{T.create.cancel}</Button>
          <Button onClick={submit} disabled={createTicket.isPending} data-testid="button-submit-ticket">
            {createTicket.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            {createTicket.isPending ? T.create.submitting : T.create.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
