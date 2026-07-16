"use client";

import { useState, useEffect } from "react";
import { Check, Copy, Zap, BarChart3, ArrowRight } from "lucide-react";

type Props = {
  projectKey: string;
  projectId: string;
  host: string;
  initialEventCount?: number;
  onInsightCreated: () => void;
};

const STEPS = [
  { id: "install", label: "Install SDK" },
  { id: "event", label: "Send first event" },
  { id: "insight", label: "Create an insight" },
];

export function Onboarding({ projectKey, projectId, host, initialEventCount = 0, onInsightCreated }: Props) {
  const [copied, setCopied] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(initialEventCount);
  // If events are already flowing, skip the install step.
  const [step, setStep] = useState(initialEventCount > 0 ? 1 : 0);

  // Poll for events
  useEffect(() => {
    if (step >= 2) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/v0/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            query: { measure: "count" },
            timeRange: { type: "relative", value: 1, unit: "hours" },
          }),
        });
        if (res.ok) {
          const { data } = await res.json();
          const count = Number(data?.[0]?.value ?? 0);
          setEventCount(count);
          if (count > 0 && step < 1) setStep(1);
        }
      } catch {}
    }, 3000);

    return () => clearInterval(interval);
  }, [projectId, step]);

  async function copySnippet() {
    await navigator.clipboard.writeText(
      `import { Analytics } from "@counted/sdk";\n\nconst analytics = new Analytics({\n  projectKey: "${projectKey}",\n});\n\nanalytics.track("page_view", { path: "/" });`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function sendTestEvent() {
    setTestSending(true);
    setTestError(null);
    try {
      const res = await fetch(`${host}/api/v0/event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Project-Key": projectKey,
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionId: `onboarding-${Date.now()}`,
          eventName: "test_event",
          systemProps: { sdkVersion: "onboarding/1", isDebug: true, osName: null, osVersion: null, locale: null, appVersion: null, deviceModel: null },
          props: { source: "onboarding" },
        }),
      });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {}
        setTestError(`Couldn't send test event: ${message}`);
        return;
      }
      // Don't fake the count — let the 3s poll confirm the event actually landed.
      setTestSent(true);
    } catch (err) {
      setTestError(`Couldn't send test event: ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setTestSending(false);
    }
  }

  async function createFirstInsight() {
    onInsightCreated();
    setStep(2);
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
              i < step
                ? "bg-accent text-surface-0"
                : i === step
                  ? "bg-accent/20 text-accent border border-accent/40"
                  : "bg-surface-2 text-text-tertiary"
            }`}>
              {i < step ? <Check className="w-3 h-3" /> : i + 1}
            </div>
            <span className={`text-xs transition-colors ${
              i <= step ? "text-text-primary" : "text-text-tertiary"
            }`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px mx-1 ${i < step ? "bg-accent" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Install */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Install the SDK</h2>
            <p className="text-sm text-text-secondary mt-1">Add Counted to your app in 3 lines.</p>
          </div>

          <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-2">
              <span className="text-xs text-text-tertiary font-mono">npm install @counted/sdk</span>
              <button
                onClick={() => { navigator.clipboard.writeText("npm install @counted/sdk"); }}
                className="text-text-tertiary hover:text-text-primary transition-colors"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
            <div className="relative">
              <pre className="px-4 py-4 text-sm font-mono text-text-secondary overflow-x-auto">
{`import { Analytics } from "@counted/sdk";

const analytics = new Analytics({
  projectKey: "${projectKey}",
});

analytics.track("page_view", { path: "/" });`}
              </pre>
              <button
                onClick={copySnippet}
                className="absolute top-2 right-2 px-2 py-1 text-xs bg-surface-2 border border-border rounded text-text-tertiary hover:text-text-primary transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">or test it right now:</span>
            <button
              onClick={sendTestEvent}
              disabled={testSending || testSent}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-surface-0 bg-accent rounded-md hover:bg-accent-hover transition-colors font-medium disabled:opacity-50"
            >
              <Zap className="w-3 h-3" />
              {testSending ? "Sending..." : testSent ? "Sent!" : "Send a test event"}
            </button>
          </div>

          {testError && (
            <div className="px-3 py-2 bg-error/10 border border-error/20 rounded-md text-sm text-error">
              {testError}
            </div>
          )}

          {eventCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-accent/10 border border-accent/20 rounded-md text-sm text-accent">
              <Check className="w-4 h-4" />
              {eventCount} event{eventCount !== 1 ? "s" : ""} received
            </div>
          )}
        </div>
      )}

      {/* Step 1: Events received */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center">
              <Check className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Events are flowing</h2>
              <p className="text-sm text-text-secondary">{eventCount} event{eventCount !== 1 ? "s" : ""} received.</p>
            </div>
          </div>

          <button
            onClick={createFirstInsight}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-surface-0 bg-accent rounded-md hover:bg-accent-hover transition-colors font-medium"
          >
            <BarChart3 className="w-4 h-4" />
            Create your first insight
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Step 2: Done */}
      {step === 2 && (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center">
            <Check className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">You're all set</h2>
            <p className="text-sm text-text-secondary">Add more insights with the + button.</p>
          </div>
        </div>
      )}

      {/* Project key reference */}
      <div className="mt-8 pt-6 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">Your project key</span>
          <code className="text-xs font-mono text-text-secondary bg-surface-2 px-2 py-0.5 rounded select-all">{projectKey}</code>
        </div>
      </div>
    </div>
  );
}
