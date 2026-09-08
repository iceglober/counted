"use client";
import { IconLayoutGrid, IconList, IconTable } from "@tabler/icons-react";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@counted/ui/components/toggle-group";
export default function ToggleGroupExample({
  variant = "single",
}: {
  variant?: string;
}) {
  return (
    <ToggleGroup
      multiple={variant === "multiple"}
      defaultValue={variant === "multiple" ? ["grid", "list"] : ["grid"]}
      variant={variant === "default" ? "default" : "outline"}
      size={variant === "lg" ? "lg" : variant === "sm" ? "sm" : "default"}
      orientation={variant === "vertical" ? "vertical" : "horizontal"}
      aria-label="Collection layouts"
    >
      <ToggleGroupItem value="grid" aria-label="Grid">
        <IconLayoutGrid />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List">
        <IconList />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" aria-label="Table">
        <IconTable />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
