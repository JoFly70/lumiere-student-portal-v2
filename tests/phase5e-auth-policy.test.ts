import { describe, expect, it } from "vitest";
import {
  hasRecoveryAuthenticationMethod,
  isDuplicateSignupError,
  resolvePasswordResetAppUrl,
} from "../server/lib/auth-policy";

function unsignedJwt(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

describe("Phase 5E auth policy", () => {
  it("classifies stable duplicate statuses and codes", () => {
    expect(isDuplicateSignupError({ status: 409 })).toBe(true);
    expect(isDuplicateSignupError({ code: "user_already_exists" })).toBe(true);
    expect(isDuplicateSignupError({
      status: 422,
      message: "Password does not meet provider requirements",
    })).toBe(false);
  });

  it("classifies the observed Supabase duplicate message", () => {
    expect(isDuplicateSignupError({
      message: "A user with this email address has already been registered",
    })).toBe(true);
    expect(isDuplicateSignupError({ message: "Password should be at least 6 characters" })).toBe(false);
  });

  it("requires a secure non-local production APP_URL", () => {
    expect(resolvePasswordResetAppUrl("https://portal.example.com/", true))
      .toBe("https://portal.example.com");
    expect(resolvePasswordResetAppUrl(undefined, true)).toBeNull();
    expect(resolvePasswordResetAppUrl("not a URL", true)).toBeNull();
    expect(resolvePasswordResetAppUrl("http://portal.example.com", true)).toBeNull();
    expect(resolvePasswordResetAppUrl("https://localhost:5000", true)).toBeNull();
  });

  it("retains the development localhost default", () => {
    expect(resolvePasswordResetAppUrl(undefined, false)).toBe("http://localhost:5000");
  });

  it("rejects ordinary password JWTs and accepts OTP/recovery AMR", () => {
    expect(hasRecoveryAuthenticationMethod(unsignedJwt({
      amr: [{ method: "password" }],
    }))).toBe(false);
    expect(hasRecoveryAuthenticationMethod(unsignedJwt({
      amr: [{ method: "otp" }],
    }))).toBe(true);
    expect(hasRecoveryAuthenticationMethod(unsignedJwt({
      amr: [{ method: "recovery" }],
    }))).toBe(true);
  });

  it("fails closed for malformed JWTs or missing AMR", () => {
    expect(hasRecoveryAuthenticationMethod("not-a-jwt")).toBe(false);
    expect(hasRecoveryAuthenticationMethod(unsignedJwt({ sub: "user" }))).toBe(false);
  });
});