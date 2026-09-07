import { expect, test } from "bun:test";
import { Instant, WorkspaceId, AccountId, type Role } from "@counted/kernel";
import { Subscription, Workspace, PlanCatalog } from "@counted/tenancy-domain";
import type { BillingGateway } from "@counted/tenancy-app";
import { authorizeDeps } from "../index";
import { createServer } from "../server";
import { fixedGeo, frozenClock, testDependencies, unavailableEngine } from "../testing";

const at = Instant.fromEpochMillis(Date.UTC(2026,8,7));
const ws = WorkspaceId("billing_review_workspace");
const account = AccountId("billing_review_owner");
const paid: Subscription = {...Subscription.none(ws,at),plan:"pro",payment:"active",customer:"cus_review",subscription:"sub_review",renewsAt:at};

function fixture(payment: Subscription["payment"], role: Role = "owner", unavailable = false) {
  const original = testDependencies();
  const opened = Workspace.open(ws,"Billing review",account,at);
  if (!opened.ok) throw new Error("invalid fixture");
  const workspace = Workspace.rehydrate({...opened.value.workspace.snapshot(), plan:"pro", payment});
  let detailReads = 0;
  let priceReads = 0;
  let writes = 0;
  const billing: BillingGateway = {
    prices:async () => { priceReads++; if(unavailable) throw new Error("provider offline"); return [{plan:"pro",cadence:"monthly",amount:990,currency:"usd"}]; },
    subscriptionDetails:async () => {detailReads++; return {cadence:"monthly",price:{amount:990,currency:"usd"},cancelAtPeriodEnd:false,periodEndsAt:at};},
    createCheckoutSession:async () => {writes++; return {url:"https://stripe.test/checkout",expiresAt:null};},
    createPortalSession:async () => {writes++; return {url:"https://stripe.test/portal",expiresAt:null};},
    verifyWebhook:() => ({ok:false,error:{kind:"BadSignature"}}),
  };
  const deps = testDependencies({
    clock:frozenClock(at),billing,
    engine: unavailableEngine({counts: async () => ({ok:true,value:{buckets:[]},computedAt:at})}),
    reads:{...original.reads,workspaces:{...original.reads.workspaces,find:async () => workspace},subscriptions:{...original.reads.subscriptions,find:async () => ({...paid,payment})}},
    identity:{...original.identity,
      memberships:{...original.identity.memberships,roleOf:async () => role,membersOf:async () => []},
      http:{...original.identity.http,principal:async () => ({account,email:"fixture@example.test",emailVerified:true,activeWorkspace:ws,expiresAt:at})},
    },
  });
  const app = createServer({deps,authorize:authorizeDeps(deps),webhook:null,mintTraceId:() => "billing-review",ingest:{
    credentials:deps.identity.credentials,commit:{submit:async () => ({kind:"Committed",accepted:0,deduplicated:0,rejected:[],commit:null})} as never,
    projectWorkspace:async () => ws,logger:deps.logger,maxBodyBytes:1000,geo:fixedGeo(),trustedProxyHops:1,
  }});
  return {counts:() => ({detailReads,priceReads,writes}),get:(path:string) => app.request(`http://api.test/v1/workspaces/${ws}${path ? "/" + path : ""}`,{headers:{cookie:"session=fixture"}}),
    checkout:() => app.request(`http://api.test/v1/workspaces/${ws}/billing/checkout`,{method:"POST",headers:{cookie:"session=fixture","content-type":"application/json"},body:JSON.stringify({plan:"pro",cadence:"monthly",successUrl:"https://app.test/done",cancelUrl:"https://app.test/back"})}),
  };
}

test("canceled subscriptions retain billing access but expose no stale renewal quote", async () => {
  const world = fixture("canceled");
  const response = await world.get("subscription");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({subscription:{payment:"canceled",hasBillingAccount:true},details:null,detailsUnavailable:false,billingAvailable:true});
  expect(world.counts().detailReads).toBe(0);
});

test("paid subscriptions expose provider cadence and period without mutating entitlement", async () => {
  const world = fixture("active");
  const response = await world.get("subscription");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({subscription:{payment:"active"},details:{cadence:"monthly",periodEndsAt:Instant.toISO(at)}});
  expect(world.counts()).toEqual({detailReads:1,priceReads:0,writes:0});
});

test("pricing outages are explicit while the confirmed catalog remains readable", async () => {
  const world = fixture("none","owner",true);
  const response = await world.get("billing/plans");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({current:"free",pricing:"unavailable",prices:[]});
});

test("billing reads and writes obey the actual resource permissions", async () => {
  const member = fixture("active","member");
  expect((await member.get("subscription")).status).toBe(403);
  expect((await member.checkout()).status).toBe(403);
  expect(member.counts()).toEqual({detailReads:0,priceReads:0,writes:0});
  const admin = fixture("active","admin");
  expect((await admin.get("subscription")).status).toBe(200);
  expect((await admin.checkout()).status).toBe(403);
  expect(admin.counts().writes).toBe(0);
});


test("a canceled former-Pro workspace exposes Free consistently and can subscribe again", async () => {
  const world = fixture("canceled");
  const [workspace,usage,plans,subscription] = await Promise.all([
    world.get(""),world.get("usage"),world.get("billing/plans"),world.get("subscription"),
  ]);
  for (const response of [workspace,usage,plans,subscription]) expect(response.status).toBe(200);
  expect(await workspace.json()).toMatchObject({workspace:{plan:"free",payment:"canceled",limits:PlanCatalog.free.limits,inGrace:false}});
  expect(await usage.json()).toMatchObject({usage:{plan:"free",events:{limit:PlanCatalog.free.limits.eventsPerMonth},projects:{limit:PlanCatalog.free.limits.projects}}});
  expect(await plans.json()).toMatchObject({current:"free",pricing:"available"});
  expect(await subscription.json()).toMatchObject({subscription:{plan:"pro",payment:"canceled",hasBillingAccount:true},details:null});
  const checkout = await world.checkout();
  expect(checkout.status).toBe(200);
  expect(await checkout.json()).toMatchObject({session:{url:"https://stripe.test/checkout"}});
});

test("active and past-due Pro workspaces retain their effective Pro allowances", async () => {
  for (const payment of ["active","past_due"] as const) {
    const response = await fixture(payment).get("");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({workspace:{plan:"pro",payment,limits:PlanCatalog.pro.limits,inGrace:payment === "past_due"}});
  }
});
