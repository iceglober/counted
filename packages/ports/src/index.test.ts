import { expect, test } from "bun:test";
import { DOMAIN_LAYER } from "@counted/domain";
import { PORTS_LAYER } from "./index";

test("ports can import the domain across the workspace", () => {
  expect(DOMAIN_LAYER).toBe("counted-domain");
  expect(PORTS_LAYER).toBe("counted-ports");
});
