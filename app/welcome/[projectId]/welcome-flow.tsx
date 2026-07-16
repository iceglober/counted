"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";

const TEMPLATES = [
  { template: "default" as const, title: "Product metrics", desc: "Traffic, events, breakdowns" },
  { template: "agent" as const, title: "Agent eval", desc: "Tool use, outcomes, file edits" },
  { template: "blank" as const, title: "Blank", desc: "Start from scratch" },
];

export function WelcomeFlow({
  projectId,
  initialName,
  eventCount,
}: {
  projectId: string;
  initialName: string;
  eventCount: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"name" | "dashboard">("name");
  const [name, setName] = useState(initialName === "My App" ? "" : initialName);
  const [busy, setBusy] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/v0/projects/${projectId}`, {
        method: "PATCH",
        body: { name: name.trim() || "My App" },
      });
      setStep("dashboard");
    } catch {
      /* api() surfaced the error */
    } finally {
      setBusy(false);
    }
  }

  async function createDashboard(template: "default" | "agent" | "blank") {
    setBusy(true);
    try {
      const dashboard = await api<{ id: string }>("/api/v0/dashboards", {
        method: "POST",
        body: { projectId, slug: `dash-${Date.now()}`, template },
      });
      router.push(`/dashboards?dashboard=${dashboard.id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-accent mb-1">
        <Check className="w-4 h-4" />
        {eventCount > 0
          ? `${eventCount} event${eventCount !== 1 ? "s" : ""} received — you're live.`
          : "Project is live. Events appear as your app runs."}
      </div>

      {step === "name" ? (
        <>
          <h1 className="text-xl font-semibold">Name your project</h1>
          <p className="text-sm text-text-secondary mt-1 mb-4">
            What should we call it?
          </p>
          <form onSubmit={saveName} className="flex flex-col gap-2">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My App"
            />
            {name.trim() === "" && (
              <p className="text-xs text-text-tertiary">
                We&apos;ll call it &ldquo;My App&rdquo; — you can rename it anytime.
              </p>
            )}
            <Button type="submit" disabled={busy}>Continue</Button>
          </form>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Add your first dashboard</h1>
          <p className="text-sm text-text-secondary mt-1 mb-4">
            Pick a starting point. You can change everything later.
          </p>
          <div className="flex flex-col gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.template}
                onClick={() => createDashboard(t.template)}
                disabled={busy}
                className="text-left px-4 py-3 bg-surface-1 border border-border rounded-lg hover:border-accent/40 transition-colors disabled:opacity-50"
              >
                <div className="text-sm text-text-primary">{t.title}</div>
                <div className="text-xs text-text-tertiary">{t.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
