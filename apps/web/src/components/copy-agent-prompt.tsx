"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { Textarea } from "@counted/ui/components/textarea";

export function CopyAgentPrompt({ prompt }: { prompt: string }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const fallback = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state === "failed") fallback.current?.focus();
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    setState("copying");
    try {
      await navigator.clipboard.writeText(prompt);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return <>
    <Button variant="outline" onClick={copy} disabled={state === "copying"}>
      {state === "copied" ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />}
      Copy Agent Prompt
    </Button>
    <span role="status" className="sr-only">{state === "copied" ? "Agent prompt copied. Paste it into your coding agent." : ""}</span>
    {state === "failed" && <div className="basis-full space-y-2">
      <p className="text-sm text-muted-foreground" role="status">Clipboard access is unavailable. Copy the selected prompt below and paste it into your coding agent.</p>
      <Textarea ref={fallback} aria-label="Agent prompt" value={prompt} readOnly rows={8}
        onFocus={event => event.currentTarget.select()} className="h-48 [field-sizing:fixed] font-mono text-xs" />
    </div>}
  </>;
}
