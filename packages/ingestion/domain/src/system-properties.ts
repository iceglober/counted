/**
 * The six things every SDK reports about the machine, plus the one thing the
 * edge works out — normalised.
 *
 * A closed record rather than a free-form bag. These become dimension columns,
 * and a dimension column that grows a new name whenever an SDK invents a field
 * cannot be indexed, summarised, or reasoned about. Anything else a client sends
 * stays an ordinary event property, where an open set is fine.
 *
 * Everything except `os_name` may be `null`, and `null` means "we looked and
 * there was nothing" — a browser that reports no version, a server process with
 * no locale, an address no registry has delegated. `os_name` is total by
 * construction (see `os-name.ts`), because a null in the dimension every
 * breakdown starts from is a bucket every query has to special-case forever.
 *
 * **`country` is the odd one and the signature says so.** It is not in the
 * payload at all: it is derived from the request address at the edge, the
 * address is discarded, and it arrives here as a second argument. See
 * `country.ts` for why a client must not be able to set it.
 */

import type { CountryCode } from "./country";
import { canonicalOsName, type OsName } from "./os-name";

export type SystemProperties = {
  readonly os_name: OsName;
  /** What the client called it, when that differed. See `os-name.ts`. */
  readonly os_name_raw: string | null;
  readonly os_version: string | null;
  readonly locale: string | null;
  readonly app_version: string | null;
  readonly device_model: string | null;
  readonly sdk_version: string | null;
  /** Derived from the request address at ingest; the address is never kept. */
  readonly country: CountryCode | null;
};

/** Bounded so one client cannot widen a dimension column with a kilobyte of junk. */
export const MAX_SYSTEM_VALUE_LENGTH = 128;

const asBoundedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Truncated rather than refused: a long `device_model` is a client quirk,
  // not a reason to lose the event. The prefix is still the useful part.
  return trimmed.length > MAX_SYSTEM_VALUE_LENGTH ? trimmed.slice(0, MAX_SYSTEM_VALUE_LENGTH) : trimmed;
};

/**
 * Total. Given anything at all — including `undefined`, a string, an array —
 * it returns a full record. There is no failure mode here on purpose: a
 * malformed `systemProperties` should cost the event its dimensions, not its
 * existence.
 *
 * `country` is a parameter rather than a field of `raw`, and it is required
 * rather than defaulted. Required, because a caller that forgets it would get
 * events with no geography and no error — the silent failure this codebase
 * refuses. A parameter, because `raw` is the client's and `country` is ours:
 * whatever the payload says under that key is ignored, exactly like any other
 * key that is not one of the six.
 */
export const normaliseSystemProperties = (
  raw: unknown,
  country: CountryCode | null,
): SystemProperties => {
  const source: Record<string, unknown> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const os = canonicalOsName(asBoundedString(source["os_name"]));

  return {
    os_name: os.osName,
    os_name_raw: os.osNameRaw,
    os_version: asBoundedString(source["os_version"]),
    locale: asBoundedString(source["locale"]),
    app_version: asBoundedString(source["app_version"]),
    device_model: asBoundedString(source["device_model"]),
    sdk_version: asBoundedString(source["sdk_version"]),
    country,
  };
};
