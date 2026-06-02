"use client";

import { useState, useEffect, useCallback } from "react";
import { Sun, Moon, Monitor, Check, Plus, Trash2, Bell, BellOff } from "lucide-react";
import { applyTheme } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";
import { useProjects } from "@/components/dashboard/dashboard-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

type ThemeMode = "dark" | "light" | "auto";

const ACCENT_PRESETS = [
  { name: "Iris", color: "#7C6CF7", hover: "#8E80F9", lightColor: "#5B4BD6", lightHover: "#4F40C4" },
  { name: "Amber", color: "#D4A853", hover: "#E0BA6A", lightColor: "#B8912E", lightHover: "#A37F22" },
  { name: "Blue", color: "#5B8DEF", hover: "#7AA3F5", lightColor: "#3B6FD9", lightHover: "#2B5FC9" },
  { name: "Green", color: "#3FCF8E", hover: "#5DDAA3", lightColor: "#1D8A52", lightHover: "#157A45" },
  { name: "Rose", color: "#EF6B8A", hover: "#F28DA5", lightColor: "#D44D6E", lightHover: "#C03D5E" },
  { name: "Purple", color: "#A78BFA", hover: "#BCA4FB", lightColor: "#7C5CE0", lightHover: "#6B4ACC" },
  { name: "Orange", color: "#F59E42", hover: "#F7B267", lightColor: "#D97B1A", lightHover: "#C06A10" },
  { name: "Teal", color: "#2DD4BF", hover: "#5EDDD0", lightColor: "#0D9488", lightHover: "#0A7A70" },
  { name: "Red", color: "#EF6461", hover: "#F28180", lightColor: "#C93C3C", lightHover: "#B52E2E" },
];

const TABS = [
  { id: "general", label: "General" },
  { id: "alerts", label: "Alerts" },
  { id: "billing", label: "Billing" },
  { id: "theme", label: "Theme" },
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
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [accentName, setAccentName] = useState("Iris");
  const [mounted, setMounted] = useState(false);
  const [userEmail, setUserEmail] = useState("—");
  const [plan, setPlan] = useState("free");
  const [billingLoading, setBillingLoading] = useState(false);
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
    const stored = localStorage.getItem("theme") as ThemeMode | null;
    setThemeMode(stored ?? "dark");

    const accent = localStorage.getItem("accent");
    if (accent) {
      try {
        const parsed = JSON.parse(accent);
        const match = ACCENT_PRESETS.find((p) => p.color === parsed.color);
        if (match) setAccentName(match.name);
      } catch {}
    }

    authClient.getSession().then((res) => {
      if (res.data?.user?.email) setUserEmail(res.data.user.email);
    });

    fetch("/api/billing/status").then((r) => r.json()).then((data) => {
      if (data.plan) setPlan(data.plan);
    });
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
    const res = await fetch("/api/v0/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: alertProjectId,
        ...newAlert,
        eventFilter: newAlert.eventFilter || undefined,
        slackWebhookUrl: newAlert.slackWebhookUrl || undefined,
      }),
    });
    if (res.ok) {
      setShowNewAlert(false);
      setNewAlert({ name: "", metric: "count", eventFilter: "", condition: "above", threshold: "100", window: "1h", channels: ["email"], slackWebhookUrl: "" });
      loadAlerts(alertProjectId);
    }
  }

  async function toggleAlert(id: string, enabled: boolean) {
    await fetch("/api/v0/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    loadAlerts(alertProjectId);
  }

  async function deleteAlert(id: string) {
    await fetch(`/api/v0/alerts?id=${id}`, { method: "DELETE" });
    loadAlerts(alertProjectId);
  }

  function changeThemeMode(mode: ThemeMode) {
    setThemeMode(mode);
    localStorage.setItem("theme", mode);
    applyTheme(mode);
  }

  function changeAccent(preset: typeof ACCENT_PRESETS[number]) {
    setAccentName(preset.name);
    applyAccent(preset);
    localStorage.setItem("accent", JSON.stringify(preset));
  }

  function applyAccent(preset: typeof ACCENT_PRESETS[number]) {
    const isLight = document.documentElement.classList.contains("light");
    document.documentElement.style.setProperty("--color-accent", isLight ? preset.lightColor : preset.color);
    document.documentElement.style.setProperty("--color-accent-hover", isLight ? preset.lightHover : preset.hover);
  }

  function resetAccent() {
    setAccentName("Iris");
    document.documentElement.style.removeProperty("--color-accent");
    document.documentElement.style.removeProperty("--color-accent-hover");
    localStorage.removeItem("accent");
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
                <p className="text-sm text-text-tertiary mt-1">Account and application settings.</p>
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
                <p className="text-sm text-text-tertiary mt-1">Manage your subscription.</p>
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
                          const { url } = await res.json();
                          if (url) window.location.href = url;
                        } finally {
                          setBillingLoading(false);
                        }
                      }}
                    >
                      {billingLoading ? "Loading..." : "Upgrade to Pro — $12/mo"}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={billingLoading}
                      onClick={async () => {
                        setBillingLoading(true);
                        try {
                          const res = await fetch("/api/billing/portal", { method: "POST" });
                          const { url } = await res.json();
                          if (url) window.location.href = url;
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
                  <p className="text-sm text-text-secondary">No alerts configured yet.</p>
                  <p className="text-xs text-text-tertiary mt-1">Create an alert to get notified when metrics change.</p>
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

          {tab === "theme" && (
            <div className="space-y-8">
              <div>
                <h1 className="text-xl font-semibold">Theme</h1>
                <p className="text-sm text-text-tertiary mt-1">Customize appearance. Preferences are saved to this device.</p>
              </div>

              {/* Mode */}
              <div>
                <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-3">Mode</h2>
                <div className="flex gap-2">
                  {([
                    { mode: "dark" as const, icon: Moon, label: "Dark" },
                    { mode: "light" as const, icon: Sun, label: "Light" },
                    { mode: "auto" as const, icon: Monitor, label: "System" },
                  ]).map(({ mode, icon: Icon, label }) => (
                    <button
                      key={mode}
                      onClick={() => changeThemeMode(mode)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
                        themeMode === mode
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-border bg-surface-1 text-text-secondary hover:border-border-hover hover:text-text-primary"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Accent color */}
              <div>
                <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-3">Accent color</h2>
                <div className="grid grid-cols-4 gap-2">
                  {ACCENT_PRESETS.map((preset) => {
                    const active = accentName === preset.name;
                    return (
                      <button
                        key={preset.name}
                        onClick={() => preset.name === "Iris" ? resetAccent() : changeAccent(preset)}
                        className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                          active
                            ? "border-current bg-current/10"
                            : "border-border bg-surface-1 hover:border-border-hover"
                        }`}
                        style={active ? { borderColor: preset.color + "66" } : undefined}
                      >
                        <div
                          className="w-4 h-4 rounded-full shrink-0"
                          style={{ backgroundColor: preset.color }}
                        />
                        <span className={active ? "text-text-primary font-medium" : "text-text-secondary"}>
                          {preset.name}
                        </span>
                        {active && (
                          <Check className="w-3 h-3 absolute top-1.5 right-1.5 text-text-tertiary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preview */}
              <div>
                <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-3">Preview</h2>
                <div className="bg-surface-1 border border-border rounded-lg p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-accent" />
                    <span className="text-sm text-text-primary">Active indicator</span>
                  </div>
                  <button className="px-4 py-2 text-sm text-surface-0 bg-accent rounded-md hover:bg-accent-hover transition-colors font-medium">
                    Button
                  </button>
                  <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden w-48">
                    <div className="h-full bg-accent/60 rounded-full" style={{ width: "65%" }} />
                  </div>
                  <div className="text-xs text-accent font-medium">Accent text</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
