import { randomBytes } from "node:crypto";

export function generateClientKey(): string {
  const key = randomBytes(10).toString("hex").toUpperCase();
  return `ck_${key}`;
}

export function generateServerKey(): string {
  const key = randomBytes(16).toString("hex").toUpperCase();
  return `sk_${key}`;
}

/** @deprecated Use generateClientKey() or generateServerKey() */
export function generateApiKey(): string {
  return generateClientKey();
}
