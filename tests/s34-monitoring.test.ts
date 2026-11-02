import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, logError, setErrorReporter, wasErrorReported } from "../server/lib/logger";

// S34 (S33-07): logger.error is forwarded (once, allowlisted context only) to a registered reporter.
describe("logger.error -> error reporter", () => {
  const reporter = vi.fn();
  beforeEach(() => {
    reporter.mockReset();
    logger.silent = true;
    setErrorReporter(reporter);
  });
  afterEach(() => {
    setErrorReporter(null);
    logger.silent = false;
  });

  it("forwards the Error object once, and marks it reported", () => {
    const err = new Error("boom");
    logger.error("Route failed", { error: err, method: "POST", path: "/api/x?token=abc" });
    logger.error("Route failed again", { error: err });
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0]![0]).toBe(err);
    expect(wasErrorReported(err)).toBe(true);
    expect(wasErrorReported(new Error("other"))).toBe(false);
  });

  it("sends only allowlisted context; records, bodies and tokens are dropped or redacted", () => {
    logger.error("fail", {
      error: new Error("x"), method: "GET", path: "/api/calendar/feed/SECRETTOKEN/me.ics?token=abc", statusCode: 500, event: "students.update",
      studentRecord: { name: "Ada", grade: "A" }, body: { dob: "2000-01-01" }, authorization: "Bearer abcdefghijklmnop", token: "t0k", fileContent: "transcript text",
    });
    const ctx = reporter.mock.calls[0]![1];
    expect(Object.keys(ctx).sort()).toEqual(["event", "method", "path", "statusCode"]);
    const dump = JSON.stringify(ctx);
    for (const bad of ["Ada", "2000-01-01", "abcdefghijklmnop", "t0k", "transcript text", "SECRETTOKEN", "token=abc"]) expect(dump).not.toContain(bad);
  });

  it("a message-only error is reported as a redacted synthetic error", () => {
    logger.error("Upload failed for https://x/storage/v1/object/sign/docs/a.pdf?token=eyJabcdefghij.klmnopqrstuv.wxyzabcdefgh", { error: "db said no" });
    const err = reporter.mock.calls[0]![0] as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain("eyJabcdefghij");
  });

  it("logError forwards the original Error", () => {
    const err = new Error("via logError");
    logError(err, { route: "/api/y" });
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it("a throwing reporter never breaks logging", () => {
    reporter.mockImplementation(() => { throw new Error("sentry down"); });
    expect(() => logger.error("still logs", { error: new Error("e") })).not.toThrow();
    expect(reporter).toHaveBeenCalled();
  });

  it("no reporter registered is a no-op", () => {
    setErrorReporter(null);
    expect(() => logger.error("nothing registered", { error: new Error("e") })).not.toThrow();
    expect(reporter).not.toHaveBeenCalled();
  });
});
