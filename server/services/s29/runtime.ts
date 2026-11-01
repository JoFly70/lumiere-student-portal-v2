/**
 * S29 — process-level hooks used by server/index.ts (kept here so index.ts changes stay minimal).
 *  - safeLogPath(): request paths are logged without calendar subscription tokens.
 *  - onResponseFinished(): 5xx responses become bounded incidents (subsystem + category + request id only), and
 *    every API response gives the durable scheduler a throttled chance to run (Autoscale has no idle timer).
 */
import { errorCode } from "./db";

const FEED = /^\/api\/calendar\/feed\/[^/]+$/;
export function safeLogPath(path: string): string {
  return FEED.test(path) ? "/api/calendar/feed/[token].ics" : path;
}

export function subsystemOfPath(path: string): string {
  const p = safeLogPath(path).split("?")[0] ?? "";
  const seg = p.split("/").filter(Boolean);
  if (seg[0] !== "api") return "app";
  if (seg[1] === "admin" && seg[2] === "s29") return `s29:${seg[3] ?? "root"}`;
  if (seg[1] === "student" && seg[2] === "s29") return `s29:${seg[3] ?? "student"}`;
  if (seg[1] === "admin" || seg[1] === "student") return `${seg[1]}:${seg[2] && !/^[0-9a-f-]{8,}$/i.test(seg[2]) ? seg[2] : "root"}`;
  return seg[1] ?? "api";
}

export function onResponseFinished(path: string, statusCode: number, requestId: string): void {
  if (!path.startsWith("/api")) return;
  void import("./scheduler").then(({ kickFromRequest }) => kickFromRequest()).catch(() => undefined);
  if (statusCode < 500 || !process.env.DATABASE_URL) return;
  void (async () => {
    try {
      const [{ db }, { recordIncident }, { s29Schema }] = await Promise.all([import("../../lib/db"), import("./incidents"), import("./db")]);
      const exec = db as unknown as import("./db").SqlExecutor;
      if (!(await s29Schema(exec)).present) return;
      await recordIncident(exec, { subsystem: subsystemOfPath(path).slice(0, 40), category: statusCode === 503 ? "db.unavailable" : "http.5xx", severity: statusCode === 503 ? "warning" : "warning", requestId });
    } catch (error) {
      void errorCode(error);
    }
  })();
}

export function startS29Runtime(): void {
  void import("./scheduler").then(({ startScheduler }) => startScheduler()).catch(() => undefined);
}
