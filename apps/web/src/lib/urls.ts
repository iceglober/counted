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

/** Where the API answers. Not the console — they are different services now. */
export const API_URL = process.env["NEXT_PUBLIC_COUNTED_API_URL"]?.replace(/\/v1\/events$/, "") ?? "https://api.counted.dev";

/** Where the console and the marketing site live. */
export const SITE_URL = process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://counted.dev";
