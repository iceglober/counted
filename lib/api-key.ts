import { randomBytes } from "node:crypto";

export function generateApiKey(): string {
  const key = randomBytes(10).toString("hex").toUpperCase();
  return `A-US-${key}`;
}
