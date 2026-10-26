import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  attachmentError,
  groupTickets,
  nextAction,
  outstandingSummary,
  publicAttachments,
  publicComments,
  replyState,
  reopenDaysLeft,
  studentStatusLabel,
  validateRequestDraft,
  absoluteTime,
  relativeTime,
} from "../client/src/components/support/support-presentation";
import { ConversationThread, ReplyComposer } from "../client/src/components/support/student-conversation";
import { StudentTicketList } from "../client/src/components/support/student-ticket-list";
import { NewRequestForm } from "../client/src/components/support/student-request-form";
import { SUPPORT_TOPICS } from "../shared/support-contract";
import {
  ALL_SUMMARIES, CONTEXT_OPTIONS, INTERNAL_NOTE_TEXT, SUPPORT_NOW as NOW, TICKET_AWAITING_STUDENT,
  TICKET_RESOLVED, TICKET_RESOLVED_EXPIRED, TICKET_WITH_CONTEXT, TICKET_WITH_LEAKED_INTERNAL, TICKET_WITH_LUMIERE,
} from "./helpers/support-ui-fixtures";

(globalThis as any).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("S08 presentation helpers", () => {
  it("uses student wording for statuses, never enum names", () => {
    expect(studentStatusLabel("waiting_on_student")).toBe("Waiting for you");
    expect(studentStatusLabel("in_progress")).toBe("With your advisor");
    expect(studentStatusLabel("open")).toBe("Received");
  });

  it("says who acts next", () => {
    expect(nextAction({ status: "waiting_on_student" }, NOW).tone).toBe("you");
    const w = nextAction({ status: "in_progress", assignee: { name: "Camille Moreau" } }, NOW);
    expect(w.tone).toBe("lumiere");
    expect(w.detail).toContain("Camille Moreau");
    expect(nextAction({ status: "resolved", resolved_at: "2026-10-20T09:00:00Z" }, NOW).detail).toContain("Reply within 14 days");
    expect(nextAction({ status: "resolved", resolved_at: "2026-09-01T09:00:00Z" }, NOW).title).toBe("Resolved and closed");
    expect(nextAction({ status: "closed" }, NOW).title).toBe("Closed");
  });

  it("computes the reopen window", () => {
    expect(reopenDaysLeft("2026-10-20T15:00:00Z", NOW)).toBe(8);
    expect(reopenDaysLeft(null, NOW)).toBeNull();
  });

  it("groups into needs reply / with Lumière / resolved, newest first", () => {
    const g = groupTickets(ALL_SUMMARIES);
    expect(g.needsReply.map((t) => t.id)).toEqual(["t-1"]);
    expect(g.withLumiere.map((t) => t.id)).toEqual(["t-5", "t-2"]);
    expect(g.resolved.map((t) => t.id)).toEqual(["t-3", "t-4"]);
    expect(g.outstanding).toBe(3);
    expect(outstandingSummary(g)).toBe("3 open requests · 1 waiting for you");
    expect(outstandingSummary(groupTickets([]))).toBe("No open requests");
  });

  it("decides reply availability with statusAfterStudentReply", () => {
    expect(replyState({ status: "closed" }, true, NOW)).toMatchObject({ canReply: false });
    expect(replyState({ status: "resolved", resolved_at: "2026-09-01T00:00:00Z" }, true, NOW).reason).toContain("14 days");
    expect(replyState({ status: "resolved", resolved_at: "2026-10-20T00:00:00Z" }, true, NOW)).toMatchObject({ canReply: true });
    expect(replyState({ status: "open" }, false, NOW).canReply).toBe(false);
  });

  it("filters internal notes and their attachments", () => {
    const comments = [
      { id: "a", is_internal: false, created_at: "2026-10-02T00:00:00Z" },
      { id: "b", is_internal: true, created_at: "2026-10-01T00:00:00Z" },
      { id: "c", is_internal: false, created_at: "2026-10-01T00:00:00Z" },
    ];
    expect(publicComments(comments).map((c) => c.id)).toEqual(["c", "a"]);
    const atts: any[] = [{ id: "1", comment_id: "b" }, { id: "2", comment_id: "a" }, { id: "3", comment_id: null }];
    expect(publicAttachments(atts, comments).map((a) => a.id)).toEqual(["2", "3"]);
  });

  it("validates the request like the server", () => {
    expect(validateRequestDraft({ topic: null, subject: "abcd", description: "short" })).toMatchObject({
      topic: expect.any(String), subject: expect.stringContaining("5"), description: expect.stringContaining("10"),
    });
    expect(validateRequestDraft({ topic: "general", subject: "  hello  ", description: "0123456789" })).toEqual({});
    expect(validateRequestDraft({ topic: "general", subject: "x".repeat(201), description: "y".repeat(5001) })).toMatchObject({
      subject: expect.any(String), description: expect.any(String),
    });
  });

  it("checks attachments against the allow-list and 10 MB", () => {
    expect(attachmentError({ name: "a.pdf", size: 1000, type: "application/pdf" })).toBeNull();
    expect(attachmentError({ name: "a.exe", size: 1000, type: "application/x-msdownload" })).toContain("not a supported type");
    expect(attachmentError({ name: "a.pdf", size: 11 * 1024 * 1024, type: "application/pdf" })).toContain("10 MB");
    expect(attachmentError({ name: "a.pdf", size: 0, type: "application/pdf" })).toContain("empty");
  });

  it("formats relative and absolute time", () => {
    expect(relativeTime("2026-10-26T14:59:50Z", NOW)).toBe("just now");
    expect(relativeTime("2026-10-26T10:00:00Z", NOW)).toContain("ago");
    expect(absoluteTime("2026-10-26T10:00:00Z")).toMatch(/Oct 2\d, 2026 at \d/);
  });
});

describe("S08 student components (SSR)", () => {
  it("never renders internal notes even if the API sent them", () => {
    const m = html(React.createElement(ConversationThread, { ticket: TICKET_WITH_LEAKED_INTERNAL, now: NOW }));
    expect(m).not.toContain(INTERNAL_NOTE_TEXT);
    expect(m).not.toContain("probation");
    expect(text(m)).not.toMatch(/internal/i);
  });

  it("distinguishes student and advisor messages and starts with the original request", () => {
    const m = html(React.createElement(ConversationThread, { ticket: TICKET_AWAITING_STUDENT, now: NOW }));
    expect(m.indexOf('data-testid="message-student"')).toBeLessThan(m.indexOf('data-testid="message-advisor"'));
    expect(text(m)).toContain("Original request");
    expect(text(m)).toContain("Lumière advisor");
    expect(text(m)).toContain("Camille Moreau");
    expect(text(m)).toContain("Waiting for your reply");
  });

  it("shows no priority and no raw enums", () => {
    const m = html(React.createElement(ConversationThread, { ticket: { ...TICKET_AWAITING_STUDENT, priority: "urgent" }, now: NOW }));
    const t = text(m);
    expect(t).not.toMatch(/urgent|priority/i);
    expect(t).not.toContain("waiting_on_student");
    expect(t).toContain("Ref LP-1042");
  });

  it("shows the resolution card and reopen hint, or a calm closed state", () => {
    const open = text(html(React.createElement(ConversationThread, { ticket: TICKET_RESOLVED, now: NOW })));
    expect(open).toContain("How this was resolved");
    expect(open).toContain("re-issued");
    expect(open).toContain("Reply within 14 days");
    const expired = html(React.createElement(ConversationThread, { ticket: TICKET_RESOLVED_EXPIRED, now: NOW }));
    expect(text(expired)).toContain("reopen window has passed");
    const composer = html(React.createElement(ReplyComposer, { ticket: TICKET_RESOLVED_EXPIRED, now: NOW, value: "", onChange() {}, onSend() {} }));
    expect(composer).toMatch(/<textarea[^>]* disabled=""/);
    expect(composer).toMatch(/<button[^>]* disabled=""[^>]*data-testid="button-send-reply"/);
    expect(text(composer)).toContain("can no longer be reopened");
  });

  it("enables the composer for an open request", () => {
    const composer = html(React.createElement(ReplyComposer, { ticket: TICKET_WITH_LUMIERE, now: NOW, value: "Hi", onChange() {}, onSend() {} }));
    expect(composer).not.toMatch(/<textarea[^>]* disabled=""/);
    expect(composer).toContain('data-testid="composer"');
  });

  it("shows academic context and attachments", () => {
    const m = html(React.createElement(ConversationThread, { ticket: TICKET_WITH_CONTEXT, now: NOW, onDownload() {} }));
    expect(text(m)).toContain("Principles of Marketing (MKT300)");
    expect(m).toContain("touchstone-2-feedback.pdf");
    expect(m).toContain('data-testid="attachment-chip"');
  });

  it("lists grouped requests with resolved collapsed and an empty state", () => {
    const m = html(React.createElement(StudentTicketList, { tickets: ALL_SUMMARIES as any, selectedId: null, now: NOW, onSelect() {} }));
    expect(text(m)).toContain("Needs your reply");
    expect(text(m)).toContain("With Lumière");
    expect(text(m)).toContain("Resolved requests (2)");
    expect(text(m)).toContain("Your advisor replied");
    expect((m.match(/data-testid="ticket-item"/g) ?? []).length).toBe(5);
    const empty = html(React.createElement(StudentTicketList, { tickets: [], selectedId: null, now: NOW, onSelect() {}, onNew() {} }));
    expect(empty).toContain('data-testid="list-empty"');
    expect(text(empty)).toContain("No requests yet");
  });

  it("offers every topic as a tile, no priority, and the context picker only when available", () => {
    const m = html(React.createElement(NewRequestForm, { contextOptions: CONTEXT_OPTIONS, defaultItemKey: "course-mkt-300", onSubmit() {}, onCancel() {} }));
    for (const t of SUPPORT_TOPICS) expect(m).toContain(`data-testid="topic-tile-${t}"`);
    expect(m).toContain('data-testid="context-picker"');
    expect(m).toMatch(/<option value="course-mkt-300" selected/);
    expect(text(m)).toContain("Related course or milestone");
    expect(text(m)).not.toMatch(/priority/i);
    const none = html(React.createElement(NewRequestForm, { contextOptions: { available: false, planVersion: null, items: [] }, onSubmit() {}, onCancel() {} }));
    expect(none).not.toContain('data-testid="context-picker"');
  });
});
