import { SITE_URL } from "../../lib/urls";

/**
 * `/pricing.md` — pricing an agent can read without scraping the HTML table.
 *
 * The limits here are the ones the domain enforces (`PlanCatalog` in
 * packages/domain/src/billing/plan.ts) and the prices are the ones Stripe
 * charges. `pricing.test.ts` compares the numbers in this file against the
 * catalog, because a pricing page and a plan catalog are two descriptions of
 * one thing and the way they drift is a customer quoted the wrong limit.
 *
 * Seats are deliberately absent: billing is flat per workspace and scales on
 * events and projects, not on people. Saying nothing about seats is correct —
 * the previous state, an enforced cap of 1/10 that no page mentioned, was not.
 */
export const dynamic = "force-static";
export const revalidate = 86_400;

const body = `# Counted pricing

Flat per workspace. Billing scales on events and projects, never on seats —
there is no per-user charge and no cap on team size.

## Free — $0/month

- 100,000 events per month
- 3 projects
- 6 months retention
- No credit card required

## Pro — $12/month, or $120/year

Annual billing saves $24.

- 1,000,000 events per month
- Unlimited projects
- 24 months retention
- Full API access
- Priority support

Above 1,000,000 events per month, get in touch.

## Included on every plan

Every SDK and every insight type, including funnels and composable dashboards.
No feature is gated behind Pro except full API access.

## Self-hosting

Free and unlimited. MIT licensed, Docker Compose, plain PostgreSQL — no
TimescaleDB or other extension required. <https://github.com/iceglober/counted>

## Notes for agents

- Overage is not billed automatically and there is no overage cliff. A workspace
  over quota is told so; it is not silently charged.
- Prices are USD.
- Human-readable page: <${SITE_URL}/pricing>
`;

export function GET(): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
