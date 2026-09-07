import { expect, test } from "bun:test";
import { Instant } from "@counted/kernel";
import { createTestIdentity } from "./testing/harness";

test("organization pages preserve timestamp ties, report orphans, and exclude the holding workspace", async () => {
  const identity = createTestIdentity();
  const first = await identity.givenWorkspace("First");
  const second = await identity.givenWorkspace("Second");
  const third = await identity.givenWorkspace("Third");
  const owner = await identity.givenMember(second, "owner");
  const member = await identity.givenMember(third, "member");
  const adapter = (await identity.auth.auth.$context).adapter;
  await adapter.updateMany({ model: "organization", where: [], update: { createdAt: new Date("2026-09-01T00:00:00Z") } });
  await adapter.create({ model: "organization", data: { id: identity.holdingWorkspace, name: "Holding", slug: "holding", createdAt: new Date("2026-09-01T00:00:00Z") }, forceAllowId: true });
  const start = await identity.organizations.page({ since: Instant.EPOCH, cursor: null, limit: 2 });
  expect(start.items).toHaveLength(2);
  expect(start.cursor).not.toBeNull();
  const end = await identity.organizations.page({ since: Instant.EPOCH, cursor: start.cursor, limit: 2 });
  expect(end.items).toHaveLength(1);
  expect(end.cursor).toBeNull();
  const all = [...start.items, ...end.items];
  expect(new Set(all.map((one) => one.workspace))).toEqual(new Set([first, second, third]));
  expect(all.find((one) => one.workspace === second)?.owner).toBe(owner);
  expect(all.find((one) => one.workspace === third)?.owner).toBeNull();
  expect(member).toBeDefined();
});
