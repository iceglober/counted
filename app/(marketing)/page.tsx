import Link from "next/link";
import { TallyMark } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { dashboardSections } from "@/lib/mock-data";
import type { MetricData, TimeSeriesData, BreakdownItem } from "@/lib/mock-data";

function MiniSparkline({ data }: { data: number[] }) {
  const w = 64;
  const h = 20;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: 2 + (1 - (v - min) / range) * (h - 4),
  }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 2)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(pts.length - 1, i + 1)];
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-16 h-5">
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
    </svg>
  );
}

function DashboardPreview() {
  const overview = dashboardSections[0];
  const metrics = overview.widgets.filter((w) => w.type === "metric");
  const chart = overview.widgets.find((w) => w.type === "timeseries");
  const chartData = chart?.data as TimeSeriesData | undefined;

  const cw = 320;
  const ch = 80;
  const values = chartData?.values ?? [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * cw,
    y: 4 + (1 - (v - min) / range) * (ch - 8),
  }));
  let linePath = `M ${pts[0]?.x ?? 0} ${pts[0]?.y ?? 0}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 2)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(pts.length - 1, i + 1)];
    linePath += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
  }
  const fillPath = `${linePath} L ${cw} ${ch} L 0 ${ch} Z`;

  return (
    <div className="bg-surface-1 border border-border rounded-xl overflow-hidden shadow-2xl shadow-surface-0/80">
      {/* Fake header bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-surface-3" />
          <div className="w-2.5 h-2.5 rounded-full bg-surface-3" />
          <div className="w-2.5 h-2.5 rounded-full bg-surface-3" />
        </div>
        <div className="flex-1 text-center text-xs text-text-tertiary">counted.dev</div>
      </div>

      <div className="flex">
        {/* Mini sidebar */}
        <div className="w-32 border-r border-border p-3 hidden sm:block">
          <div className="flex items-center gap-1.5 mb-4">
            <TallyMark className="w-3 h-3 text-accent" />
            <span className="text-[10px] font-display text-text-secondary">Counted</span>
          </div>
          <div className="space-y-1">
            <div className="h-5 bg-accent/10 rounded text-[10px] text-accent px-2 flex items-center">Dashboard</div>
            <div className="h-5 rounded text-[10px] text-text-tertiary px-2 flex items-center">Events</div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="flex-1 p-4">
          {/* Metrics row */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {metrics.map((m) => {
              const d = m.data as MetricData;
              return (
                <div key={m.id} className="bg-surface-2 rounded-md px-2.5 py-2">
                  <div className="text-[9px] text-text-tertiary uppercase tracking-wider">{m.title}</div>
                  <div className="flex items-end justify-between mt-1">
                    <span className="text-sm font-semibold tabular-nums">{d.value}</span>
                    <MiniSparkline data={d.sparkline} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mini chart */}
          <div className="bg-surface-2 rounded-md p-2.5">
            <div className="text-[9px] text-text-tertiary uppercase tracking-wider mb-2">Sessions over time</div>
            <svg viewBox={`0 0 ${cw} ${ch}`} className="w-full">
              <defs>
                <linearGradient id="preview-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={fillPath} fill="url(#preview-fill)" />
              <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border bg-surface-0/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <TallyMark className="w-5 h-5 text-accent" />
            <span className="font-display text-lg tracking-wide">Counted</span>
          </Link>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Features</a>
            <a href="#sdk" className="text-sm text-text-secondary hover:text-text-primary transition-colors">SDK</a>
            <ThemeToggle />
            <Link href="/login" className="text-sm text-accent hover:text-accent-hover transition-colors">Sign in</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-20">
        <div className="max-w-2xl animate-rise">
          <h1 className="font-display text-5xl sm:text-6xl leading-[1.1] tracking-tight">
            Every event,<br />
            <span className="italic text-accent">counted.</span>
          </h1>
          <p className="mt-6 text-lg text-text-secondary leading-relaxed max-w-lg">
            Privacy-first analytics with composable dashboards you actually want to use.
            No cookies. No PII. Just the data that matters.
          </p>
          <div className="mt-8 flex items-center gap-4">
            <Link
              href="/login"
              className="px-5 py-2.5 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Get started
            </Link>
            <Link
              href="/proj_1"
              className="px-5 py-2.5 text-sm text-text-secondary border border-border rounded-md hover:border-border-hover hover:text-text-primary transition-colors"
            >
              Live demo
            </Link>
          </div>
        </div>

        {/* Dashboard preview */}
        <div className="mt-16 animate-rise" style={{ animationDelay: "200ms" }}>
          <div className="relative">
            <div className="absolute -inset-12 bg-[radial-gradient(ellipse_at_center,_var(--color-accent)_0%,_transparent_70%)] opacity-[0.06] blur-2xl pointer-events-none" />
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* Stats — not in cards, inline. Asymmetric spacing per design-for-ai */}
      <section className="border-y border-border bg-surface-1/40">
        <div className="max-w-5xl mx-auto px-6 py-10 flex items-center justify-between sm:justify-start sm:gap-20">
          <div>
            <div className="text-2xl font-semibold tabular-nums">~2KB</div>
            <div className="text-xs text-text-tertiary mt-1 uppercase tracking-wider">SDK size (gzipped)</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">Zero</div>
            <div className="text-xs text-text-tertiary mt-1 uppercase tracking-wider">Cookies set</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">100%</div>
            <div className="text-xs text-text-tertiary mt-1 uppercase tracking-wider">Aptabase-compatible</div>
          </div>
        </div>
      </section>

      {/* Features — mixed presentation, not identical card grid */}
      <section id="features" className="max-w-5xl mx-auto px-6 py-24">
        <h2 className="font-display text-3xl tracking-tight">
          Dashboards that <span className="italic text-accent">compose</span>
        </h2>
        <p className="mt-3 text-text-secondary max-w-lg">
          Aptabase gives you one view. Counted gives you the building blocks
          to create the views your product actually needs.
        </p>

        <div className="mt-12 grid sm:grid-cols-5 gap-y-10 gap-x-12">
          {/* Feature 1 — takes 3 cols */}
          <div className="sm:col-span-3">
            <div className="text-xs text-accent uppercase tracking-wider font-medium">Sections &amp; groups</div>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed">
              Organize widgets under collapsible headers. Group acquisition
              metrics separately from engagement, revenue separately from
              platform breakdown. Collapse what you do not need right now.
            </p>
          </div>

          {/* Feature 2 — takes 2 cols */}
          <div className="sm:col-span-2">
            <div className="text-xs text-accent uppercase tracking-wider font-medium">Flexible grid</div>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed">
              Widgets span 1 to 4 columns. Mix metric cards, time series
              charts, and breakdown tables in any arrangement.
            </p>
          </div>

          {/* Feature 3 — full width, different format */}
          <div className="sm:col-span-5 border-l-2 border-accent/30 pl-5">
            <div className="text-xs text-accent uppercase tracking-wider font-medium">Composable queries</div>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed max-w-2xl">
              Every widget runs its own query. Filter by event name, group by any
              property, aggregate with count, unique sessions, sum, avg, or percentiles.
              Each widget is independent — change one without touching the rest.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="sm:col-span-2">
            <div className="text-xs text-accent uppercase tracking-wider font-medium">Multiple dashboards</div>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed">
              Create as many dashboards as your product needs. One for
              daily standups, one for monthly reviews, one per feature team.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="sm:col-span-3">
            <div className="text-xs text-accent uppercase tracking-wider font-medium">Funnel &amp; retention</div>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed">
              Conversion funnels through event sequences. Cohort retention grids.
              The analysis Aptabase cannot do, built into the same composable model.
            </p>
          </div>
        </div>
      </section>

      {/* SDK section */}
      <section id="sdk" className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <div className="grid sm:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="font-display text-3xl tracking-tight">
                Three lines<span className="text-text-tertiary">.</span>
              </h2>
              <p className="mt-3 text-text-secondary max-w-sm">
                Install the SDK, initialize with your project key, and start tracking.
                Wire-compatible with Aptabase — migration is a one-line import swap.
              </p>
              <div className="mt-6 space-y-3 text-sm text-text-secondary">
                <div className="flex items-baseline gap-2">
                  <span className="text-accent text-xs">01</span>
                  <span>Install <code className="font-mono text-xs text-text-primary bg-surface-2 px-1.5 py-0.5 rounded">@counted/sdk</code></span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-accent text-xs">02</span>
                  <span>Initialize with your project key</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-accent text-xs">03</span>
                  <span>Call <code className="font-mono text-xs text-text-primary bg-surface-2 px-1.5 py-0.5 rounded">track()</code> wherever events happen</span>
                </div>
              </div>
            </div>

            {/* Code block */}
            <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border text-xs text-text-tertiary">app.ts</div>
              <pre className="p-4 text-sm leading-relaxed font-mono overflow-x-auto">
                <code>
                  <span className="text-accent">import</span>
                  <span className="text-text-primary"> {"{"} Analytics {"}"} </span>
                  <span className="text-accent">from</span>
                  <span className="text-success"> &quot;@counted/sdk&quot;</span>
                  <br />
                  <br />
                  <span className="text-accent">const</span>
                  <span className="text-text-primary"> analytics </span>
                  <span className="text-accent">= new</span>
                  <span className="text-text-primary"> Analytics({"{"}</span>
                  <br />
                  <span className="text-text-primary">  appKey</span>
                  <span className="text-text-tertiary">: </span>
                  <span className="text-success">&quot;A-US-your-key&quot;</span>
                  <br />
                  <span className="text-text-primary">{"}"})</span>
                  <br />
                  <br />
                  <span className="text-text-primary">analytics.</span>
                  <span className="text-accent">track</span>
                  <span className="text-text-primary">(</span>
                  <span className="text-success">&quot;signup&quot;</span>
                  <span className="text-text-primary">, {"{"} </span>
                  <span className="text-text-primary">plan</span>
                  <span className="text-text-tertiary">: </span>
                  <span className="text-success">&quot;pro&quot;</span>
                  <span className="text-text-primary"> {"}"})</span>
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-24 text-center">
          <h2 className="font-display text-3xl tracking-tight">
            Start counting what <span className="italic text-accent">matters</span>
          </h2>
          <p className="mt-3 text-text-secondary">
            Free for up to 100k events per month. No credit card required.
          </p>
          <div className="mt-8">
            <Link
              href="/login"
              className="inline-flex px-6 py-3 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Get started for free
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TallyMark className="w-4 h-4 text-text-tertiary" />
            <span className="text-xs text-text-tertiary">&copy; 2026 Counted</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-text-tertiary">
            <a href="https://github.com/iceglober/counted" className="hover:text-text-secondary transition-colors">GitHub</a>
            <a href="#" className="hover:text-text-secondary transition-colors">Docs</a>
            <a href="#" className="hover:text-text-secondary transition-colors">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
