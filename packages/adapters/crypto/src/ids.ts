/**
 * Identifier generation.
 *
 * UUIDv7 rather than v4: the first 48 bits are a millisecond timestamp, so ids
 * sort by creation time. That matters because these become primary keys, and a
 * random key scatters inserts across the whole btree while a time-ordered one
 * appends — which is the difference between a healthy index and a fragmented
 * one on a table taking events continuously.
 *
 * They remain opaque on the wire. The embedded timestamp reveals when a row
 * was created, which is not sensitive for a workspace or a project id, and no
 * identifier here is ever derived from anything about a person.
 */

import { randomBytes } from "node:crypto";

export const uuidv7 = (): string => {
  const bytes = randomBytes(16);
  const millis = Date.now();

  // 48-bit big-endian timestamp.
  bytes[0] = (millis / 2 ** 40) & 0xff;
  bytes[1] = (millis / 2 ** 32) & 0xff;
  bytes[2] = (millis / 2 ** 24) & 0xff;
  bytes[3] = (millis / 2 ** 16) & 0xff;
  bytes[4] = (millis / 2 ** 8) & 0xff;
  bytes[5] = millis & 0xff;

  // Version 7, RFC 9562 variant.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const idGenerator = { next: uuidv7 } as const;

/**
 * A claim or share token. Longer than a credential secret because it travels
 * in a URL, where it may be logged, pasted or shoulder-surfed — and unlike a
 * credential it cannot be scoped down.
 */
export const issueGrantToken = (): string => randomBytes(32).toString("base64url");
