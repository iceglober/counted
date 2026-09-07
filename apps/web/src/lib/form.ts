/**
 * Reading a form, and getting back to the page afterwards.
 *
 * A `"use server"` module may export nothing but async functions, so the
 * helpers every action needs live here instead of beside them.
 */

import type { Failure } from "./failure";
import { failureQuery } from "./failure";

/** A required field, trimmed. Empty means absent — the API refuses both. */
export const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** An optional field. `undefined` rather than `""`, so it can be omitted. */
export const optional = (form: FormData, name: string): string | undefined => {
  const value = text(form, name);
  return value === "" ? undefined : value;
};

/** A whole number, or `null` when the field is absent or not one. */
export const integer = (form: FormData, name: string): number | null => {
  const raw = text(form, name);
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
};

/**
 * A finite number, or `null` when the field is absent or not one. For the
 * fields that are allowed a fraction — a threshold is `z.number()`, not an int.
 */
export const decimal = (form: FormData, name: string): number | null => {
  const raw = text(form, name);
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Where the action sends the reader when it is done.
 *
 * **Validated, not trusted.** `returnTo` arrives in a hidden field, which means
 * it arrives from whoever composed the request. An unchecked one turns every
 * mutating action in the console into an open redirect: a link that renames
 * your dashboard and then lands you on an attacker's page wearing Counted's
 * chrome. Only a same-site absolute path is accepted, and `//evil.example` is
 * refused explicitly because it is a *protocol-relative URL* that
 * `startsWith("/")` waves straight through.
 */
export const returnTo = (form: FormData, fallback: string): string => {
  const raw = text(form, "returnTo");
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
};

/** The same path with a failure attached, for the page to render as an alert. */
export const withFailure = (path: string, failure: Failure): string => {
  const [base, existing] = path.split("?");
  const params = new URLSearchParams(existing ?? "");
  params.delete("code");
  params.delete("reason");
  for (const [key, value] of new URLSearchParams(failureQuery(failure))) params.set(key, value);
  return `${base}?${params.toString()}`;
};

/**
 * The same path with one flag set, and any previous failure cleared — the
 * "it worked" signal a redirect has to carry when there is nothing to show but
 * a sentence.
 */
export const withFlag = (path: string, name: string, value: string): string => {
  const [base, existing] = path.split("?");
  const params = new URLSearchParams(existing ?? "");
  params.delete("code");
  params.delete("reason");
  params.set(name, value);
  return `${base}?${params.toString()}`;
};

/** The same path with any previous failure cleared, so a retry does not keep it. */
export const withoutFailure = (path: string): string => {
  const [base, existing] = path.split("?");
  const params = new URLSearchParams(existing ?? "");
  params.delete("code");
  params.delete("reason");
  const query = params.toString();
  return query === "" ? (base ?? "/") : `${base}?${query}`;
};
