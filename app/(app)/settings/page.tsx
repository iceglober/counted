"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Bell, BellOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useProjects } from "@/components/dashboard/dashboard-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/client-api";

const TABS = [
  { id: "general", label: "General" },
  { id: "alerts", label: "Alerts" },
  { id: "billing", label: "Billing" },
];

type Alert = {
  id: string;
  name: string;
  metric: string;
  eventFilter: string | null;
  condition: string;
  threshold: string;
  window: string;
  channels: string[];
  slackWebhookUrl: string | null;
  enabled: boolean;
  lastTriggeredAt: string | null;
  lastValue: string | null;
};

export default function SettingsPage() {
  const [tab, setTab] = useState("general");
  const [mounted, setMounted] = useState(false);
  const [userEmail, setUserEmail] = useState("—");
  const [plan, setPlan] = useState("free");
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const projects = useProjects();
  const [alertsList, setAlertsList] = useState<Alert[]>([]);
  const [alertProjectId, setAlertProjectId] = useState("");
  const [showNewAlert, setShowNewAlert] = useState(false);
  const [newAlert, setNewAlert] = useState({
    name: "",
    metric: "count",
    eventFilter: "",
    condition: "above",
    threshold: "100",
    window: "1h",
    channels: ["email"] as string[],
    slackWebhookUrl: "",
  });

  useEffect(() => {
    setMounted(true);
    authClient.getSession().then((res) => {
      if (res.data?.user?.email) setUserEmail(res.data.user.email);
    });

    fetch("/api/billing/status").then((r) => r.json()).then((data) => {
      if (data.plan) setPlan(data.plan);
      setBillingEnabled(!!data.billingEnabled);
    });

    // Usage bar. The endpoint may not exist yet — fail quietly if so.
    fetch("/api/v0/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.used === "number" && typeof data.limit === "number") {
          setUsage({ used: data.used, limit: data.limit });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (projects.length > 0 && !alertProjectId) {
      setAlertProjectId(projects[0].id);
    }
  }, [projects, alertProjectId]);

  const loadAlerts = useCallback(async (pid: string) => {
    if (!pid) return;
    const res = await fetch(`/api/v0/alerts?projectId=${pid}`);
    if (res.ok) setAlertsList(await res.json());
  }, []);

  useEffect(() => {
    if (alertProjectId) loadAlerts(alertProjectId);
  }, [alertProjectId, loadAlerts]);

  async function createAlert() {
    if (!alertProjectId || !newAlert.name || !newAlert.threshold) return;
    try {
      await api("/api/v0/alerts", {
        method: "POST",
        body: {
          projectId: alertProjectId,
          ...newAlert,
          eventFilter: newAlert.eventFilter || undefined,
          slackWebhookUrl: newAlert.slackWebhookUrl || undefined,
        },
      });
      setShowNewAlert(false);
      setNewAlert({ name: "", metric: "count", eventFilter: "", condition: "above", threshold: "100", window: "1h", channels: ["email"], slackWebhookUrl: "" });
      toast.success("Alert created");
      loadAlerts(alertProjectId);
    } catch {
      /* api() surfaced the error */
    }
  }

  async function toggleAlert(id: string, enabled: boolean) {
    try {
      await api("/api/v0/alerts", { method: "PATCH", body: { id, enabled } });
      loadAlerts(alertProjectId);
    } catch {
      /* api() surfaced the error */
    }
  }

  async function deleteAlert(id: string) {
    try {
      await api(`/api/v0/alerts?id=${id}`, { method: "DELETE" });
      toast.success("Alert deleted");
      loadAlerts(alertProjectId);
    } catch {
      /* api() surfaced the error */
    }
  }

  if (!mounted) return null;

  return (
    <div className="flex-1 min-w-0">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>

      <div className="flex h-[calc(100vh-12rem)]">
      {/* Left — tabs */}
      <div className="w-48 shrink-0 border-r border-border">
        <div className="py-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                tab === t.id
                  ? "text-accent bg-accent/8"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right — content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-xl">

          {tab === "general" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-semibold">General</h1>
              </div>

              <div>
                <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-3">Account</h2>
                <div className="bg-surface-1 border border-border rounded-lg divide-y divide-border">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-text-secondary">Email</span>
                    <span className="text-sm text-text-primary">{userEmail}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-text-secondary">Session</span>
                    <button
                      onClick={async () => {
                        await authClient.signOut();
                        window.location.href = "/login";
                      }}
                      className="text-xs text-error hover:text-error/80 transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "billing" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-semibold">Billing</h1>
              </div>

              <div>
                <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-3">Current plan</h2>
                <div className="bg-surface-1 border border-border rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-text-primary capitalize">{plan}</span>
                    <span className="text-xs text-text-tertiary ml-2">
                      {plan === "free" ? "100K events/month" : "1M events/month"}
                    </span>
                  </div>
                  {plan === "free" ? (
                    billingEnabled ? (
                      <Button
                        disabled={billingLoading}
                        onClick={async () => {
                          setBillingLoading(true);
                          try {
                            const res = await fetch("/api/billing/checkout", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ interval: "monthly" }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (data.url) window.location.href = data.url;
                            else toast.error(data.error ?? "Checkout failed");
                          } catch {
                            toast.error("Checkout failed");
                          } finally {
                            setBillingLoading(false);
                          }
                        }}
                      >
                        {billingLoading ? "Loading..." : "Upgrade to Pro — $12/mo"}
                      </Button>
                    ) : (
                      <span className="text-xs text-text-tertiary">Pro is in early access — billing opens soon</span>
                    )
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={billingLoading}
                      onClick={async () => {
                        setBillingLoading(true);
                        try {
                          const { url } = await api<{ url?: string }>("/api/billing/portal", { method: "POST" });
                          if (url) window.location.href = url;
                        } catch {
                          /* api() surfaced the error */
                        } finally {
                          setBillingLoading(false);
                        }
                      }}
                    >
                      {billingLoading ? "Loading..." : "Manage subscription"}
                    </Button>
                  )}
                </div>
              </div>

              {usage && (
                <div>
                  <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-3">Usage this month</h2>
                  <div className="bg-surface-1 border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-text-secondary tabular-nums">
                        {usage.used.toLocaleString()} / {usage.limit.toLocaleString()} events
                      </span>
                      <span className="text-xs text-text-tertiary tabular-nums">
                        {Math.min(100, Math.round((usage.used / Math.max(1, usage.limit)) * 100))}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${usage.used >= usage.limit ? "bg-error" : "bg-accent"}`}
                        style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "alerts" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-semibold">Alerts</h1>
                  <p className="text-sm text-text-tertiary mt-1">Get notified when metrics cross thresholds.</p>
                </div>
                <button
                  onClick={() => setShowNewAlert(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent bg-accent/10 rounded-md hover:bg-accent/20 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  New alert
                </button>
              </div>

              {projects.length > 1 && (
                <div>
                  <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2">Project</h2>
                  <select
                    value={alertProjectId}
                    onChange={(e) => setAlertProjectId(e.target.value)}
                    className="px-3 py-1.5 text-sm bg-surface-2 border border-border rounded-md text-text-primary"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {showNewAlert && (
                <div className="bg-surface-1 border border-accent/30 rounded-lg p-4 space-y-3">
                  <h2 className="text-sm font-medium">New Alert</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-text-tertiary mb-1 block">Name</label>
                      <Input
                        value={newAlert.name}
                        onChange={(e) => setNewAlert({ ...newAlert, name: e.target.value })}
                        placeholder="High error rate"
                        className="h-8 bg-surface-2"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-tertiary mb-1 block">Metric</label>
                      <select
                        value={newAlert.metric}
                        onChange={(e) => setNewAlert({ ...newAlert, metric: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-sm bg-surface-2 border border-border rounded-md text-text-primary"
                      >
                        <option value="count">Event count</option>
                        <option value="unique_sessions">Unique sessions</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-text-tertiary mb-1 block">Condition</label>
                      <div className="flex gap-2">
                        <select
                          value={newAlert.condition}
                          onChange={(e) => setNewAlert({ ...newAlert, condition: e.target.value })}
                          className="px-2.5 py-1.5 text-sm bg-surface-2 border border-border rounded-md text-text-primary"
                        >
                          <option value="above">Above</option>
                          <option value="below">Below</option>
                        </select>
                        <Input
                          type="number"
                          value={newAlert.threshold}
                          onChange={(e) => setNewAlert({ ...newAlert, threshold: e.target.value })}
                          className="h-8 w-24 bg-surface-2"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-text-tertiary mb-1 block">Window</label>
                      <select
                        value={newAlert.window}
                        onChange={(e) => setNewAlert({ ...newAlert, window: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-sm bg-surface-2 border border-border rounded-md text-text-primary"
                      >
                        <option value="1h">1 hour</option>
                        <option value="24h">24 hours</option>
                        <option value="7d">7 days</option>
                        <option value="30d">30 days</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-text-tertiary mb-1 block">Event (optional)</label>
                      <Input
                        value={newAlert.eventFilter}
                        onChange={(e) => setNewAlert({ ...newAlert, eventFilter: e.target.value })}
                        placeholder="error, page_view, ..."
                        className="h-8 bg-surface-2"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-tertiary mb-1 block">Notify via</label>
                      <div className="flex gap-2">
                        {["email", "slack"].map((ch) => (
                          <button
                            key={ch}
                            onClick={() => {
                              const channels = newAlert.channels.includes(ch)
                                ? newAlert.channels.filter((c) => c !== ch)
                                : [...newAlert.channels, ch];
                              setNewAlert({ ...newAlert, channels });
                            }}
                            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                              newAlert.channels.includes(ch)
                                ? "bg-accent/15 text-accent border border-accent/30"
                                : "bg-surface-2 text-text-secondary border border-transparent hover:text-text-primary"
                            }`}
                          >
                            {ch.charAt(0).toUpperCase() + ch.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {newAlert.channels.includes("slack") && (
                    <div>
                      <label className="text-xs text-text-tertiary mb-1 block">Slack webhook URL</label>
                      <Input
                        value={newAlert.slackWebhookUrl}
                        onChange={(e) => setNewAlert({ ...newAlert, slackWebhookUrl: e.target.value })}
                        placeholder="https://hooks.slack.com/services/..."
                        className="h-8 bg-surface-2"
                      />
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={createAlert} disabled={!newAlert.name || !newAlert.threshold}>
                      Create
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowNewAlert(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {alertsList.length === 0 && !showNewAlert && (
                <div className="bg-surface-1 border border-border rounded-lg p-8 text-center">
                  <Bell className="w-8 h-8 text-text-tertiary mx-auto mb-3" />
                  <p className="text-sm text-text-secondary">No alerts yet.</p>
                </div>
              )}

              {alertsList.length > 0 && (
                <div className="bg-surface-1 border border-border rounded-lg divide-y divide-border">
                  {alertsList.map((alert) => (
                    <div key={alert.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          onClick={() => toggleAlert(alert.id, !alert.enabled)}
                          className={`shrink-0 ${alert.enabled ? "text-accent" : "text-text-tertiary"}`}
                        >
                          {alert.enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                        </button>
                        <div className="min-w-0">
                          <div className={`text-sm font-medium truncate ${alert.enabled ? "text-text-primary" : "text-text-tertiary"}`}>
                            {alert.name}
                          </div>
                          <div className="text-xs text-text-tertiary">
                            {alert.metric === "count" ? "Events" : alert.metric === "unique_sessions" ? "Sessions" : alert.metric}{" "}
                            {alert.condition} {alert.threshold} · {alert.window} window
                            {alert.eventFilter && ` · ${alert.eventFilter}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {alert.lastValue && (
                          <span className="text-xs text-text-tertiary tabular-nums">
                            Last: {alert.lastValue}
                          </span>
                        )}
                        <span className="text-xs text-text-tertiary">
                          {(alert.channels as string[]).join(", ")}
                        </span>
                        <IconButton
                          icon={<Trash2 />}
                          label="Delete alert"
                          tone="danger"
                          onClick={() => deleteAlert(alert.id)}
                          className="size-7"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
      </div>
    </div>
  );
}
