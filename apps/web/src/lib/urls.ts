/**
 * The public hostnames, in one place.
 *
 * They were nine scattered string literals across the marketing pages, the
 * docs and two llms.txt routes — and half of them still said
 * `app.counted.dev/api/v0`, which is v1's console serving v1's deprecated
 * endpoint. A reader following those instructions would have integrated
 * against the compat edge by accident.
 *
 * Overridable, because the same pages have to be right on a preview
 * deployment as well as in production.
 */

/**
 * The fallback when `NEXT_PUBLIC_COUNTED_API_URL` is unset — one value, read by
 * both this module and `api.ts`.
 *
 * They used to disagree: this file fell back to `https://api.counted.dev` and
 * `publicApiUrl()` fell back to `http://localhost:8080`. Both read the same
 * variable, so production was fine — but a deploy that lost the variable would
 * have served an `/llms.txt` telling agents to call `api.counted.dev` while the
 * console itself called localhost. Documentation right, app broken, nothing
 * comparing the two.
 *
 * Localhost is the safer of the two defaults, and not only for development.
 * Counted is self-hostable, and a self-hoster who builds without setting this
 * would, under the other default, ship a console that silently sends their
 * events to *our* API. Failing to connect is the better failure.
 */
export const DEFAULT_API_URL = "http://localhost:8080";

/** Where the API answers. Not the console — they are different services now. */
export const API_URL =
  process.env["NEXT_PUBLIC_COUNTED_API_URL"]?.replace(/\/v1\/events$/, "") ?? DEFAULT_API_URL;

/** Where the console and the marketing site live. */
export const SITE_URL = process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://counted.dev";
