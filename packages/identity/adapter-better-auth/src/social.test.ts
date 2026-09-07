/**
 * GitHub's profile call, and the address it often does not contain.
 *
 * An OIDC provider states the address and whether it is verified, so the
 * generic mapping handles Google. GitHub states neither when the account keeps
 * its address private, which is the common case for a developer's account —
 * and an address we get wrong here is an account created under the wrong
 * person, or no account at all.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { githubUserInfo } from "./auth";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers the two calls the profile fetch makes, and nothing else. */
const githubReturning = (profile: unknown, emails: unknown, profileOk = true) => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/user")) {
      return new Response(JSON.stringify(profile), { status: profileOk ? 200 : 401 });
    }
    if (url.endsWith("/user/emails")) return new Response(JSON.stringify(emails), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
};

const profile = {
  id: 42,
  login: "grace",
  name: "Grace Hopper",
  email: null,
  avatar_url: "https://avatars.example/grace.png",
};

describe("the GitHub profile", () => {
  test("a private address is taken from the primary one, with its verified flag", async () => {
    githubReturning(profile, [
      { email: "other@example.com", primary: false, verified: true },
      { email: "grace@example.com", primary: true, verified: true },
    ]);

    const info = await githubUserInfo("token");
    expect(info).not.toBeNull();
    expect(info?.email).toBe("grace@example.com");
    expect(info?.emailVerified).toBe(true);
    expect(info?.name).toBe("Grace Hopper");
    expect(info?.id).toBe("42");
  });

  test("an unverified address is not reported as verified", async () => {
    githubReturning(profile, [{ email: "grace@example.com", primary: true, verified: false }]);
    expect((await githubUserInfo("token"))?.emailVerified).toBe(false);
  });

  test("a public address on the profile is used, and its flag still comes from the list", async () => {
    githubReturning({ ...profile, email: "grace@example.com" }, [
      { email: "grace@example.com", primary: true, verified: true },
    ]);

    const info = await githubUserInfo("token");
    expect(info?.email).toBe("grace@example.com");
    expect(info?.emailVerified).toBe(true);
  });

  test("no address at all is a refusal, not an account with none", async () => {
    githubReturning(profile, []);
    expect(await githubUserInfo("token")).toBeNull();
  });

  test("a rejected token is a refusal", async () => {
    githubReturning(profile, [], false);
    expect(await githubUserInfo("token")).toBeNull();
  });

  test("the login stands in for a missing name", async () => {
    githubReturning({ ...profile, name: null }, [
      { email: "grace@example.com", primary: true, verified: true },
    ]);
    expect((await githubUserInfo("token"))?.name).toBe("grace");
  });
});
