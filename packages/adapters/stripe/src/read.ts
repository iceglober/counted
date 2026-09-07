/**
 * Reading fields off a parsed webhook body.
 *
 * The body arrives as JSON from outside. Casting it to `Stripe.Event` — which
 * is what the SDK's `constructEvent` does — buys a type that says `customer:
 * string | Customer | DeletedCustomer` and a runtime that will happily be
 * `undefined`, so the first thing that touches a missing field throws a
 * TypeError inside a webhook handler at 3am. These readers return null
 * instead, and the translator turns a null into a named refusal.
 *
 * It also decouples this file from the SDK's type churn. Stripe moves fields
 * between API versions — `current_period_end` left `Subscription` for
 * `SubscriptionItem`, `invoice.subscription` became
 * `invoice.parent.subscription_details.subscription` — and when that happens
 * the failure here is a `Malformed` with a detail, not a crash.
 */

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const readRecord = (
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null => (source === null ? null : asRecord(source[key]));

export const readString = (source: Record<string, unknown> | null, key: string): string | null => {
  if (source === null) return null;
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

export const readNumber = (source: Record<string, unknown> | null, key: string): number | null => {
  if (source === null) return null;
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export const readBoolean = (
  source: Record<string, unknown> | null,
  key: string,
): boolean | null => {
  if (source === null) return null;
  const value = source[key];
  return typeof value === "boolean" ? value : null;
};

/**
 * A Stripe reference field, expanded or not.
 *
 * Every association in Stripe's API is either the id (`"sub_123"`) or the whole
 * object (`{ id: "sub_123", … }`) depending on what the caller expanded.
 * Webhooks send unexpanded ids — except when the object *is* the association,
 * which is exactly the `customer.subscription.*` case. Handling both is one
 * line and removes a class of bug that only shows up in production.
 */
export const readRef = (source: Record<string, unknown> | null, key: string): string | null => {
  if (source === null) return null;
  const value = source[key];
  if (typeof value === "string" && value.length > 0) return value;
  return readString(asRecord(value), "id");
};

/** Stripe metadata is `Record<string, string>`, or absent. Non-string values are ignored. */
export const readMetadata = (source: Record<string, unknown> | null): Record<string, string> => {
  const metadata = readRecord(source, "metadata");
  if (metadata === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
};

/** The `data.items` list of any Stripe list-shaped field. */
export const readList = (
  source: Record<string, unknown> | null,
  key: string,
): readonly Record<string, unknown>[] => {
  const list = readRecord(source, key);
  const data = list === null ? null : list["data"];
  if (!Array.isArray(data)) return [];
  return data.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null);
};
