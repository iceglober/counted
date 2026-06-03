import { NextRequest, NextResponse } from "next/server";
import { logError, logInfo } from "@/lib/log";

// Railway webhook → email bridge. Point a Railway project webhook at
//   https://app.counted.dev/api/internal/railway-hook?token=<RAILWAY_HOOK_SECRET>
// and deploy failures / crashes email OPS_ALERT_EMAIL via Resend — no Slack, no
// third-party. The ?token guards the endpoint; only failure-class statuses email
// (routine building/success are skipped to avoid noise).

type RailwayPayload = {
  status?: string;
  type?: string;
  deployment?: { status?: string };
  project?: { name?: string };
  environment?: { name?: string };
};

const ALERT_STATUSES = new Set(["FAILED", "CRASHED", "BUILD_FAILED", "DEPLOY_FAILED", "REMOVED"]);

export async function POST(request: NextRequest) {
  const secret = process.env.RAILWAY_HOOK_SECRET;
  if (!secret || request.nextUrl.searchParams.get("token") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: RailwayPayload = {};
  try {
    payload = (await request.json()) as RailwayPayload;
  } catch {
    /* tolerate empty/non-JSON pings */
  }

  const status = (payload.status ?? payload.deployment?.status ?? "UNKNOWN").toString().toUpperCase();
  const project = payload.project?.name ?? "counted";
  const environment = payload.environment?.name ?? "production";

  if (!ALERT_STATUSES.has(status)) {
    return NextResponse.json({ ok: true, skipped: status });
  }

  const to = process.env.OPS_ALERT_EMAIL ?? "austin@iceglobe.io";
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Counted <alerts@counted.dev>",
          to: [to],
          subject: `⚠️ Counted deploy ${status} — ${project}/${environment}`,
          html:
            `<p><strong>Deploy ${status}</strong> on <strong>${project} / ${environment}</strong>.</p>` +
            `<p>Open Railway → the service → Deployments to investigate.</p>` +
            `<p style="color:#888;font-size:12px;">— Counted ops</p>`,
        }),
      });
    } catch (e) {
      logError("railway_hook_email", e, { status, project });
    }
  }

  logInfo("railway_hook", { status, project, environment });
  return NextResponse.json({ ok: true });
}
