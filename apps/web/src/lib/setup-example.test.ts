import { expect, test } from "bun:test";
import { setupExample } from "./setup-example";

test("the copied HTTP example retains a pasted key as one literal header", async () => {
  const key = "key' $(printf unexpected) \" spaced";
  const endpoint = "https://api.example.test/path's";
  const command = `curl() { printf '%s\\0' "$@"; }\n${setupExample("http", endpoint, key)}`;
  const child = Bun.spawn(["sh", "-c", command], {stdout:"pipe",stderr:"pipe"});
  const args = (await new Response(child.stdout).text()).split("\0");
  expect(await child.exited).toBe(0);
  expect(args[0]).toBe(endpoint + "/v1/events");
  expect(args[2]).toBe("authorization: Bearer " + key);
  expect(JSON.parse(args[6]!)).toMatchObject({events:[{name:"page_view",properties:{path:"/welcome"}}]});
});
