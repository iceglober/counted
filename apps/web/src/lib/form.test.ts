import { describe, expect, test } from "bun:test";
import {
  decimal,
  integer,
  optional,
  returnTo,
  text,
  withFailure,
  withFlag,
  withoutFailure,
} from "./form";

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
};

describe("reading fields", () => {
  test("a required field is trimmed and an absent one is empty", () => {
    expect(text(form({ name: "  Acme  " }), "name")).toBe("Acme");
    expect(text(form({}), "name")).toBe("");
  });

  test("an optional field is undefined rather than empty", () => {
    // The difference matters: `{ name: "" }` is a request to set an empty name
    // and gets refused; omitting the key is a request to leave it alone.
    expect(optional(form({ name: "   " }), "name")).toBeUndefined();
    expect(optional(form({ name: "x" }), "name")).toBe("x");
  });

  test("a non-integer is null, not NaN", () => {
    expect(integer(form({ width: "6" }), "width")).toBe(6);
    expect(integer(form({ width: "6.5" }), "width")).toBeNull();
    expect(integer(form({ width: "six" }), "width")).toBeNull();
  });

  test("a decimal keeps its fraction and refuses what is not a finite number", () => {
    // A threshold of 0.5 is a legitimate threshold; `integer` would drop it.
    expect(decimal(form({ value: "0.5" }), "value")).toBe(0.5);
    expect(decimal(form({ value: "-3" }), "value")).toBe(-3);
    expect(decimal(form({ value: "" }), "value")).toBeNull();
    expect(decimal(form({ value: "Infinity" }), "value")).toBeNull();
    expect(decimal(form({ value: "ten" }), "value")).toBeNull();
  });
});

describe("where an action sends the reader", () => {
  test("a same-site path is kept", () => {
    expect(returnTo(form({ returnTo: "/w/w1/dashboards" }), "/")).toBe("/w/w1/dashboards");
  });

  test("an absolute URL is refused", () => {
    // Otherwise every mutating action is an open redirect: a link that renames
    // your dashboard and lands you on someone else's page wearing our chrome.
    expect(returnTo(form({ returnTo: "https://evil.example/" }), "/fallback")).toBe("/fallback");
  });

  test("a protocol-relative URL is refused", () => {
    // The one a `startsWith("/")` check waves straight through.
    expect(returnTo(form({ returnTo: "//evil.example/" }), "/fallback")).toBe("/fallback");
    expect(returnTo(form({ returnTo: "/\\evil.example/" }), "/fallback")).toBe("/fallback");
  });
});

describe("carrying a failure back to the page", () => {
  const failure = { code: "CONFLICT", status: 409, reason: "NameUnchanged", message: "x" };

  test("it is appended without losing the path's own query", () => {
    const next = withFailure("/w/w1/projects?showArchived=1", failure);
    const params = new URL(next, "http://x").searchParams;
    expect(params.get("showArchived")).toBe("1");
    expect(params.get("code")).toBe("CONFLICT");
    expect(params.get("reason")).toBe("NameUnchanged");
  });

  test("a second failure replaces the first rather than stacking", () => {
    const once = withFailure("/w/w1/projects", failure);
    const twice = withFailure(once, { ...failure, reason: "NameRequired" });
    expect(new URL(twice, "http://x").searchParams.getAll("reason")).toEqual(["NameRequired"]);
  });

  test("a success flag clears the previous failure", () => {
    // Otherwise the page renders "that did not work" beside "invitation sent".
    const next = withFlag("/w/w1/members?code=CONFLICT&reason=AlreadyAMember", "invited", "1");
    const params = new URL(next, "http://x").searchParams;
    expect(params.get("invited")).toBe("1");
    expect(params.get("code")).toBeNull();
  });

  test("clearing it leaves the rest of the query alone", () => {
    expect(withoutFailure("/w/w1/projects?code=CONFLICT&reason=X&tab=keys")).toBe(
      "/w/w1/projects?tab=keys",
    );
    expect(withoutFailure("/w/w1/projects?code=CONFLICT")).toBe("/w/w1/projects");
  });
});
