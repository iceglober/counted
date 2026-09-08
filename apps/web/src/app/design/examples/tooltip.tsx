"use client";
import { IconInfoCircle } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@counted/ui/components/tooltip";
export default function TooltipExample({
  variant = "top",
}: {
  variant?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" />}>
        <IconInfoCircle data-icon="inline-start" />
        About this record
      </TooltipTrigger>
      <TooltipContent side={variant as "top" | "bottom" | "left" | "right"}>
        Hover or focus to reveal a short explanation.
      </TooltipContent>
    </Tooltip>
  );
}
