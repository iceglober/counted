import { markdown } from "@/lib/agent-meta";

// Machine-readable pricing so agents can compare and recommend without scraping
// the HTML pricing page. Keep in sync with /pricing and product_profile.
const CONTENT = `# Counted pricing

Privacy-first product analytics. No credit card for the free tier.

## Free — $0/month
- 100,000 events / month
- 3 projects
- 6-month retention
- Composable dashboards; breakdowns, time series, counts, and funnels
- Community support

## Pro — $12/month (or $120/year)
- 1,000,000 events / month
- Unlimited projects
- 24-month retention
- Full API access (server keys)
- Priority support

## Notes
- All plans include the full SDK and every insight type.
- Open source — self-host any plan for free with Docker Compose.
- No cookies, no consent banner, no per-seat pricing.
- Need more than 1M events/month: hello@counted.dev
`;

export function GET() {
  return markdown(CONTENT);
}
