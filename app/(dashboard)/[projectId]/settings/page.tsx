"use client";

import { useState, useEffect } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { applyTheme } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";

type ThemeMode = "dark" | "light" | "auto";

const ACCENT_PRESETS = [
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
  { id: "billing", label: "Billing" },
  { id: "theme", label: "Theme" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState("general");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [accentName, setAccentName] = useState("Amber");
  const [mounted, setMounted] = useState(false);
  const [userEmail, setUserEmail] = useState("—");
  const [plan, setPlan] = useState("free");
  const [billingLoading, setBillingLoading] = useState(false);

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
    setAccentName("Amber");
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
                    <button
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
                      className="px-4 py-2 text-sm text-surface-0 bg-accent rounded-md hover:bg-accent-hover transition-colors font-medium disabled:opacity-50"
                    >
                      {billingLoading ? "Loading..." : "Upgrade to Pro — $12/mo"}
                    </button>
                  ) : (
                    <button
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
                      className="px-4 py-2 text-sm text-text-secondary border border-border rounded-md hover:border-border-hover hover:text-text-primary transition-colors disabled:opacity-50"
                    >
                      {billingLoading ? "Loading..." : "Manage subscription"}
                    </button>
                  )}
                </div>
              </div>
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
                        onClick={() => preset.name === "Amber" ? resetAccent() : changeAccent(preset)}
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
