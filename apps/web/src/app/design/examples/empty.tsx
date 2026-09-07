"use client";
import { useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@counted/ui/components/empty";
export default function EmptyExample({
  variant = "with-action",
}: {
  variant?: string;
}) {
  const [cleared, setCleared] = useState(false);
  return (
    <Empty>
      <EmptyHeader>
        {variant !== "without-icon" && (
          <EmptyMedia variant="icon">
            <IconSearch />
          </EmptyMedia>
        )}
        <EmptyTitle>
          {cleared ? "Ready to explore" : "No matching records"}
        </EmptyTitle>
        <EmptyDescription>
          {cleared
            ? "Filters are cleared. Your collection can now show all records."
            : "Try a broader search, or clear your filters to see the full collection."}
        </EmptyDescription>
      </EmptyHeader>
      {variant !== "without-action" && (
        <EmptyContent>
          <Button variant="outline" onClick={() => setCleared(!cleared)}>
            {cleared ? "Reset example" : "Clear filters"}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
