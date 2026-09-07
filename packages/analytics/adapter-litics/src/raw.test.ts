import { describe, test, expect } from "bun:test";
import { Duration, Instant, ProjectId } from "@counted/kernel";
import { matches, rawFunnel, rawSeries, rawBreakdown, RawPropertyReader, type RawEvent } from "./raw";
const at = (hour: number) => Instant.fromEpochMillis(Date.UTC(2026, 8, 1, hour));
const query = {scope: {level: "project" as const, project: ProjectId("p")}, bounds: {from: at(0), to: at(48)}, step: "day" as const};
const event = (ts: number, actor: string, url: string | null, country = "US"): RawEvent => ({ts: Instant.toEpochMillis(at(ts)), actor, dimensions: {country, event_type: "view"}, properties: {url, country: "property-country", amount: 12, enabled: true}});
const events = [event(1, "a", "/"), event(2, "a", "/"), event(25, "a", "/docs"), event(26, "b", null)];
describe("bounded property reads", () => {
  test("exact unions and missing property combinations", () => {
    expect(rawSeries(events, {...query, wholeWindow: true}, true).buckets.map((one) => one.value)).toEqual([2]);
    const result = rawBreakdown(events, {...query, by: ["property:url", "country", "property:country"], order: "desc", limit: 10}, true);
    expect(result.rows.map((row) => [row.keys, row.value])).toContainEqual([["/", "US", "property-country"], 1]);
    expect(result.rows.map((row) => [row.keys, row.value])).toContainEqual([[null, "US", "property-country"], 1]);
  });
  test("split series is dense and retains distinct visits per bucket", () => {
    const result = rawSeries(events, {...query, by: "property:url"}, true);
    expect(result.groups?.find((one) => one.key === "/")?.buckets.map((one) => one.value)).toEqual([1, 0]);
    expect(result.groups?.find((one) => one.key === "/docs")?.buckets.map((one) => one.value)).toEqual([0, 1]);
  });
  test("nested operators preserve types and field namespaces", () => {
    expect(matches(events[0]!, {op: "and", operands: [{op: "gte", field: {source: "property", key: "amount"}, value: 10}, {op: "eq", field: {source: "property", key: "enabled"}, value: true}]})).toBe(true);
    expect(matches(events[0]!, {op: "eq", field: {source: "property", key: "country"}, value: "US"})).toBe(false);
    expect(matches(events[0]!, {op: "eq", field: {source: "property", key: "amount"}, value: "12"})).toBe(false);
  });
  test("an oversized observation window refuses before borrowing a connection", async () => {
    const reader = new RawPropertyReader({connect: async () => {throw new Error("must not connect");}});
    expect(reader.read(query.scope, {from: at(0), to: Instant.plus(at(0), Duration.days(96))}, {deadline: Duration.seconds(1), traceId: "bound"})).rejects.toThrow("95 days");
  });
});


describe("ordered visit funnels", () => {
  const named = (name: string, hour: number, actor = "a") => ({...event(hour,actor,null),dimensions:{event_type:name}});
  test("an absent later event retains the completed earlier steps", () => {
    const rows = [named("view",1),named("signup",2),named("view",3,"b")];
    expect(rawFunnel(rows,{...query,steps:["view","signup","never_seen"]}).counts).toEqual([2,1,0]);
    expect(rawFunnel(rows,{...query,steps:["view","never_seen","signup"]}).counts).toEqual([2,0,0]);
  });
  test("repeated step names require distinct later events, within the original deadline", () => {
    const rows = [named("view",1),named("view",1),named("view",2),named("view",3),named("view",1,"b"),named("view",4,"b"),named("view",5,"b")];
    expect(rawFunnel(rows,{...query,steps:["view","view","view"],within:Duration.hours(3)}).counts).toEqual([2,1,1]);
  });
});
