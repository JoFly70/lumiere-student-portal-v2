import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, csrfTokenExpiresAt, freshCsrfToken, getCsrfToken, setAuthToken, setCsrfToken } from "../client/src/lib/api";

const token = (msFromNow: number) => `${Date.now() + msFromNow}.nonce.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => { vi.unstubAllGlobals(); setAuthToken(null); setCsrfToken(null); });

describe("CSRF token renewal (S27)", () => {
  it("reads the expiry embedded in the token", () => {
    expect(csrfTokenExpiresAt("1700000000000.n.s")).toBe(1700000000000);
    expect(csrfTokenExpiresAt(null)).toBeNull();
    expect(csrfTokenExpiresAt("garbage")).toBeNull();
  });

  it("keeps a token with time left and renews one that is about to expire", async () => {
    setAuthToken("bearer-1");
    const fresh = token(60 * 60_000);
    const fetchMock = vi.fn(async () => json(200, { csrfToken: fresh }));
    vi.stubGlobal("fetch", fetchMock);
    setCsrfToken(token(30 * 60_000));
    await freshCsrfToken();
    expect(fetchMock).not.toHaveBeenCalled();
    setCsrfToken(token(60_000)); // one minute left: inside the 5-minute margin
    expect(await freshCsrfToken()).toBe(fresh);
    expect(fetchMock).toHaveBeenCalledWith("/api/csrf-token", { headers: { Authorization: "Bearer bearer-1" } });
    expect(getCsrfToken()).toBe(fresh);
  });

  it("an expired token no longer breaks writes after an hour: renewed before the POST", async () => {
    setAuthToken("bearer-1");
    setCsrfToken(token(-10 * 60_000)); // issued at sign-in, expired
    const fresh = token(60 * 60_000);
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/csrf-token") return json(200, { csrfToken: fresh });
      sent.push(new Headers(init?.headers).get("X-CSRF-Token") ?? "");
      return json(200, { ok: true });
    }));
    await expect(apiRequest("/api/x", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true });
    expect(sent).toEqual([fresh]);
  });

  it("a rejected token is renewed once and the request repeated; other 403s are not retried", async () => {
    setAuthToken("bearer-1");
    setCsrfToken(token(30 * 60_000));
    const fresh = token(60 * 60_000);
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/csrf-token") return json(200, { csrfToken: fresh });
      posts += 1;
      return posts === 1 ? json(403, { error: "Invalid CSRF token", code: "CSRF_TOKEN_INVALID" }) : json(200, { ok: true });
    }));
    await expect(apiRequest("/api/x", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true });
    expect(posts).toBe(2);

    posts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { posts += 1; return json(403, { error: "Insufficient permissions" }); }));
    await expect(apiRequest("/api/x", { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 403 });
    expect(posts).toBe(1);
  });
});
