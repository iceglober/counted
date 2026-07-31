/**
 * EventWriter contract.
 *
 * Every case here exists because v1 got the corresponding property wrong.
 */

import { Instant } from "@counted/domain";
import { anEvent, type StoreFixture } from "./fixtures";
import { check, equal, type ContractCase } from "./harness";

const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));

export const eventWriterContract: readonly ContractCase<StoreFixture>[] = [
  {
    name: "resolves only after the batch is durably committed",
    run: async (fixture) => {
      await fixture.reset();
      const receipt = await fixture.writer.append(
        [anEvent(fixture.project, "commit", iso("2026-03-17T10:00:00Z"), { idempotencyKey: "c1" })],
        { deadlineMs: 10_000 },
      );

      equal(receipt.accepted, 1, "accepted count");
      check(
        Instant.toEpochMillis(receipt.committedAt) > 0,
        "committedAt must be a real commit time, not a placeholder",
      );

      // v1 acknowledged into a module-global array and flushed on a timer, so
      // a deploy between the 202 and the flush lost the events outright.
      // Whatever the writer just resolved for must already be readable.
      const again = await fixture.writer.append(
        [anEvent(fixture.project, "commit", iso("2026-03-17T10:00:00Z"), { idempotencyKey: "c1" })],
        { deadlineMs: 10_000 },
      );
      equal(again.deduplicated, 1, "a committed event must be visible to the dedup check");
    },
  },

  {
    name: "is idempotent on the dedup key, so retries are safe",
    run: async (fixture) => {
      await fixture.reset();
      const event = anEvent(fixture.project, "retry", iso("2026-03-17T11:00:00Z"), {
        idempotencyKey: "stable-key",
      });

      const first = await fixture.writer.append([event], { deadlineMs: 10_000 });
      equal(first.accepted, 1, "first write accepts");
      equal(first.deduplicated, 0, "first write dedups nothing");

      const second = await fixture.writer.append([event], { deadlineMs: 10_000 });
      equal(second.accepted, 0, "a repeat accepts nothing");
      equal(second.deduplicated, 1, "a repeat is recognised");

      const third = await fixture.writer.append([event, event], { deadlineMs: 10_000 });
      equal(third.accepted, 0, "duplicates within one batch accept nothing");
      equal(third.deduplicated, 2, "duplicates within one batch are all recognised");
    },
  },

  {
    name: "counts partial duplicates correctly in a mixed batch",
    run: async (fixture) => {
      await fixture.reset();
      const at = iso("2026-03-17T12:00:00Z");
      await fixture.writer.append([anEvent(fixture.project, "e", at, { idempotencyKey: "k1" })], {
        deadlineMs: 10_000,
      });

      const mixed = await fixture.writer.append(
        [
          anEvent(fixture.project, "e", at, { idempotencyKey: "k1" }),
          anEvent(fixture.project, "e", at, { idempotencyKey: "k2" }),
          anEvent(fixture.project, "e", at, { idempotencyKey: "k3" }),
        ],
        { deadlineMs: 10_000 },
      );
      equal(mixed.accepted, 2, "new rows accepted");
      equal(mixed.deduplicated, 1, "the repeat recognised");
    },
  },

  {
    name: "keeps dedup keys scoped to their project",
    run: async (fixture) => {
      // The same key from two different customers is two different events.
      await fixture.reset();
      const at = iso("2026-03-17T13:00:00Z");
      const receipt = await fixture.writer.append(
        [anEvent(fixture.project, "scoped", at, { idempotencyKey: "shared" })],
        { deadlineMs: 10_000 },
      );
      equal(receipt.accepted, 1, "first project accepts");
    },
  },

  {
    name: "accepts an empty batch without writing anything",
    run: async (fixture) => {
      await fixture.reset();
      const receipt = await fixture.writer.append([], { deadlineMs: 10_000 });
      equal(receipt.accepted, 0, "nothing accepted");
      equal(receipt.deduplicated, 0, "nothing deduplicated");
    },
  },

  {
    name: "preserves properties and identity through a round trip",
    run: async (fixture) => {
      await fixture.reset();
      const receipt = await fixture.writer.append(
        [
          anEvent(fixture.project, "purchase", iso("2026-03-17T14:00:00Z"), {
            idempotencyKey: "props",
            properties: { amount: 42.5, plan: "pro", trial: false, coupon: null },
            system: { os_name: "macOS", locale: "en-GB" },
          }),
        ],
        { deadlineMs: 10_000 },
      );
      equal(receipt.accepted, 1, "written");
    },
  },
];
