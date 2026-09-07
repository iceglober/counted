"use client";
import { useState } from "react";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@counted/ui/components/button-group";
export default function ButtonGroupExample({
  variant = "horizontal",
}: {
  variant?: string;
}) {
  const [zoom, setZoom] = useState(100);
  return (
    <div className="flex w-full max-w-sm flex-col gap-7">
      <p className="mb-3 text-xs text-muted-foreground">One shared boundary</p>
      <ButtonGroup
        orientation={variant === "vertical" ? "vertical" : "horizontal"}
        aria-label="Zoom controls"
      >
        <Button
          variant="outline"
          size="icon"
          disabled={zoom <= 50}
          aria-label="Zoom out"
          onClick={() => setZoom(zoom - 10)}
        >
          <IconMinus />
        </Button>
        {variant === "with-text" && (
          <ButtonGroupText className="min-w-20 justify-center tabular-nums">
            {zoom}%
          </ButtonGroupText>
        )}
        <Button
          variant="outline"
          size="icon"
          disabled={zoom >= 150}
          aria-label="Zoom in"
          onClick={() => setZoom(zoom + 10)}
        >
          <IconPlus />
        </Button>
      </ButtonGroup>
      <p className="text-xs text-muted-foreground" role="status">
        Zoom: {zoom}%
      </p>
    </div>
  );
}
