import { expect, test } from "bun:test";
import { money } from "./money";

test("formats ordinary, zero-decimal and Stripe compatibility currency units", () => {
  expect(money(990, "usd")).toBe("$9.90");
  expect(money(990, "jpy")).toBe("¥990");
  expect(money(500, "isk")).toBe("ISK 5");
  expect(money(500, "ugx")).toBe("UGX 5");
});
