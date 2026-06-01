import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { loadDashboardById } from "@/lib/dashboard-loader";
import { notFound } from "next/navigation";
import type { TimeRange } from "@/lib/types";
import { CountedLogo } from "@/components/icons";
import Link from "next/link";
import { SharedDashboard } from "./shared-dashboard";

export default async function SharedDashboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const dashboard = await db.query.dashboards.findFirst({
    where: eq(dashboards.shareToken, token),
  });

  if (!dashboard) {
    notFound();
  }

  const timeRange: TimeRange = { type: "relative", value: 30, unit: "days" };
  const { insights } = await loadDashboardById(dashboard.id, timeRange);

  return (
    <div className="min-h-screen bg-surface-0">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <CountedLogo className="w-4 h-4 text-accent" />
          <span className="font-display text-sm tracking-wide text-text-secondary">Counted</span>
        </div>
        <Link
          href="/"
          className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Get your own dashboard
        </Link>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold mb-8">{dashboard.name}</h1>
        <SharedDashboard insights={insights} />
      </div>
    </div>
  );
}
