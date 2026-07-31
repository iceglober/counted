/**
 * `@counted/aptabase-compat` — edge translation, and nothing else.
 *
 * Aptabase's vocabulary lives in this package and stops at its boundary. The
 * domain, the application layer and the store never learn that a request
 * arrived in someone else's shape.
 *
 * Everything here is pure: given a body and some headers it produces events or
 * a reason, and produces a response shape. It performs no I/O, so the whole
 * translation is testable without a server, and the API mounts it in one file.
 */

export { translate, type AptabaseEvent, type IngestEvent, type Translation } from "./translate";
export { looksLikeAptabaseKey, presentedKey, type KeySource, type PresentedKey } from "./keys";
export {
  accepted,
  badRequest,
  gone,
  rateLimited,
  tooLarge,
  unauthorized,
  type CompatResponse,
} from "./respond";
