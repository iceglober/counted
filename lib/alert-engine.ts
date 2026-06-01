import { db, pool } from "./db";
import { alerts } from "./db/schema";
import { eq, and } from "drizzle-orm";

type Alert = typeof alerts.$inferSelect;

function windowToInterval(window: string): string {
  const match = window.match(/^(\d+)(h|d)$/);
  if (!match) return "1 hour";
  const [, num, unit] = match;
  return unit === "h" ? `${num} hours` : `${num} days`;
}

async function evaluateMetric(
  projectId: string,
  metric: string,
  eventFilter: string | null,
  window: string,
): Promise<number> {
  const interval = windowToInterval(window);
  const params: unknown[] = [projectId, interval];

  let measureSql: string;
  if (metric === "count") {
    measureSql = "COUNT(*)";
  } else if (metric === "unique_sessions") {
    measureSql = "COUNT(DISTINCT session_id)";
  } else {
    params.push(metric);
    measureSql = `SUM(CASE WHEN (props->>$${params.length})::numeric IS NOT NULL THEN (props->>$${params.length})::numeric ELSE 0 END)`;
  }

  let sql = `SELECT ${measureSql} as value FROM events WHERE project_id = $1 AND timestamp >= NOW() - $2::interval`;

  if (eventFilter) {
    params.push(eventFilter);
    sql += ` AND event_name = $${params.length}`;
  }

  const result = await pool.query(sql, params);
  return Number(result.rows[0]?.value ?? 0);
}

async function sendEmail(to: string, alert: Alert, value: number): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const direction = alert.condition === "above" ? "exceeded" : "dropped below";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Counted <alerts@counted.dev>",
      to: [to],
      subject: `Alert: ${alert.name}`,
      html: `<p><strong>${alert.name}</strong> ${direction} threshold.</p>
<p>Current value: <strong>${value}</strong> (threshold: ${alert.threshold})</p>
<p>Window: ${alert.window}</p>
<p style="color: #888; font-size: 12px;">— Counted</p>`,
    }),
  });
}

async function sendSlack(webhookUrl: string, alert: Alert, value: number): Promise<void> {
  const direction = alert.condition === "above" ? "exceeded" : "dropped below";

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `🔔 *${alert.name}* ${direction} threshold.\nCurrent: *${value}* (threshold: ${alert.threshold}) · Window: ${alert.window}`,
    }),
  });
}

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between notifications

export async function evaluateAlerts(): Promise<{ checked: number; triggered: number }> {
  const activeAlerts = await db.query.alerts.findMany({
    where: eq(alerts.enabled, true),
    with: { creator: true },
  });

  let triggered = 0;

  for (const alert of activeAlerts) {
    const value = await evaluateMetric(
      alert.projectId,
      alert.metric,
      alert.eventFilter,
      alert.window,
    );

    const threshold = parseFloat(alert.threshold);
    const isTriggered =
      alert.condition === "above" ? value > threshold : value < threshold;

    if (!isTriggered) {
      await db
        .update(alerts)
        .set({ lastValue: String(value) })
        .where(eq(alerts.id, alert.id));
      continue;
    }

    // Cooldown: skip if triggered less than 1 hour ago
    if (
      alert.lastTriggeredAt &&
      Date.now() - new Date(alert.lastTriggeredAt).getTime() < COOLDOWN_MS
    ) {
      continue;
    }

    const channels = (alert.channels as string[]) ?? [];

    if (channels.includes("email") && alert.creator?.email) {
      await sendEmail(alert.creator.email, alert, value);
    }

    if (channels.includes("slack") && alert.slackWebhookUrl) {
      await sendSlack(alert.slackWebhookUrl, alert, value);
    }

    await db
      .update(alerts)
      .set({
        lastTriggeredAt: new Date(),
        lastValue: String(value),
      })
      .where(eq(alerts.id, alert.id));

    triggered++;
  }

  return { checked: activeAlerts.length, triggered };
}
