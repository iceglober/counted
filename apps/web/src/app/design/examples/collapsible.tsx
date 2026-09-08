"use client";
import { useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@counted/ui/components/collapsible";
export default function CollapsibleExample({
  variant = "closed",
}: {
  variant?: string;
}) {
  const [open, setOpen] = useState(variant === "open");
  return (
    <Collapsible
      disabled={variant === "disabled"}
      open={open}
      onOpenChange={setOpen}
      className="flex w-full max-w-sm flex-col gap-7"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium">Record metadata</p>
        <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
          {open ? "Hide" : "Show"}
          <IconChevronDown data-icon="inline-end" />
        </CollapsibleTrigger>
      </div>
      <p className="text-xs text-muted-foreground">
        Optional detail stays a single action away.
      </p>
      <CollapsibleContent>
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 text-xs leading-relaxed sm:gap-x-6 sm:gap-y-[18px] [&_dt]:text-muted-foreground [&_dd]:[overflow-wrap:anywhere] border-t pt-5">
          <dt>Identifier</dt>
          <dd>rec_acme_web</dd>
          <dt>Created</dt>
          <dd>Sep 4, 2026</dd>
          <dt>Environment</dt>
          <dd>Production</dd>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
