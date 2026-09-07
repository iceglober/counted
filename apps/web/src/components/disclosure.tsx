"use client";
import { IconChevronDown } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@counted/ui/components/collapsible";
export function Disclosure({
  summary,
  open = false,
  children,
}: {
  summary: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={open} className="min-w-0 border-t pt-3">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="max-w-full justify-between gap-3 whitespace-normal"
          />
        }
      >
        {summary}
        <IconChevronDown />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-5 pt-5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
