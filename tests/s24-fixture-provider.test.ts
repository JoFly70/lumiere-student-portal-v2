import { describe, expect, it } from "vitest";
import { fixtureProviderGetUser, makeLocalJWT } from "./helpers/s09-profile-stack";

describe("disposable fixture provider verification", () => {
  it("accepts a signed synthetic fixture without bypassing application auth", async () => {
    const response = await fixtureProviderGetUser(makeLocalJWT("synthetic-only", "fixture@example.test"));
    expect(response.error).toBeNull();
    expect(response.data.user?.id).toBe("synthetic-only");
    expect(response.data.user?.email_confirmed_at).toBeTruthy();
  });
  it("rejects a modified or malformed fixture", async () => {
    const signed = makeLocalJWT("synthetic-only", "fixture@example.test");
    const [header, payload] = signed.split(".");
    expect((await fixtureProviderGetUser(`${header}.${payload}.invalid`)).data.user).toBeNull();
    expect((await fixtureProviderGetUser("not-a-session")).data.user).toBeNull();
  });
});
