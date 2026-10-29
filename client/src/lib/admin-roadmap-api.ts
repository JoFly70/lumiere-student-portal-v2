import type { AdminRoadmapState, StudentRoadmapView } from "@shared/student-roadmap-contract";
import { getAuthToken, freshCsrfToken } from "./api";
import { classifyRoadmapFailure, roadmapEndpoint, type RoadmapFailure } from "./admin-roadmap-logic";

export class RoadmapApiError extends Error {
  readonly failure: RoadmapFailure;
  constructor(failure: RoadmapFailure) {
    super(failure.message);
    this.name = "RoadmapApiError";
    this.failure = failure;
  }
}

async function headers(json: boolean, method: string): Promise<Headers> {
  const h = new Headers();
  const token = getAuthToken();
  if (token) h.set("Authorization", `Bearer ${token}`);
  if (method !== "GET") {
    const csrf = await freshCsrfToken();
    if (csrf) h.set("X-CSRF-Token", csrf);
  }
  if (json) h.set("Content-Type", "application/json");
  return h;
}

async function send<T>(method: string, url: string, body?: BodyInit | null, json = false): Promise<T> {
  // Multipart bodies must NOT get a Content-Type header: the browser adds the boundary.
  const res = await fetch(url, { method, headers: await headers(json, method), body: body ?? undefined, credentials: "include" });
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    throw new RoadmapApiError(classifyRoadmapFailure(res.status, parsed));
  }
  return (await res.json()) as T;
}

const sendJson = <T>(method: string, url: string, data?: unknown) =>
  send<T>(method, url, data === undefined ? undefined : JSON.stringify(data), data !== undefined);

export const adminRoadmapApi = {
  get: (studentId: string) => send<AdminRoadmapState>("GET", roadmapEndpoint(studentId)),
  preview: (studentId: string) => send<StudentRoadmapView>("GET", roadmapEndpoint(studentId, "draft/preview")),
  importWorkbook: (studentId: string, file: File, replaceDraft: boolean, companion?: File | null) => {
    const form = new FormData();
    form.append("workbook", file, file.name);
    // S07: optional execution workbook merged into the same draft.
    if (companion) form.append("companion", companion, companion.name);
    return send<AdminRoadmapState>("POST", roadmapEndpoint(studentId, "imports", { replaceDraft }), form);
  },
  importPackage: (studentId: string, pkg: unknown, replaceDraft: boolean) =>
    sendJson<AdminRoadmapState>("POST", roadmapEndpoint(studentId, "imports", { replaceDraft }), pkg),
  saveDraft: (studentId: string, body: unknown) => sendJson<AdminRoadmapState>("PUT", roadmapEndpoint(studentId, "draft"), body),
  acknowledge: (studentId: string, body: unknown) => sendJson<AdminRoadmapState>("POST", roadmapEndpoint(studentId, "draft/acknowledge"), body),
  publish: (studentId: string, body: unknown) => sendJson<AdminRoadmapState>("POST", roadmapEndpoint(studentId, "draft/publish"), body),
  discard: (studentId: string, body: unknown) => sendJson<AdminRoadmapState>("POST", roadmapEndpoint(studentId, "draft/discard"), body),
  fromPublished: (studentId: string) => sendJson<AdminRoadmapState>("POST", roadmapEndpoint(studentId, "draft/from-published"), {}),
};
