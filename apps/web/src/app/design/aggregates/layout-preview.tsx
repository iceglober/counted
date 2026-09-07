"use client";

import { useId, useState } from "react";
import { Label } from "@counted/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";
import { Preview } from "../preview";

const widths = [
  { value: "fluid", label: "Available width" },
  { value: "390", label: "Phone · 390px" },
  { value: "768", label: "Tablet · 768px" },
];

export function LayoutPreview({
  children,
  code,
  label,
}: {
  children: React.ReactNode;
  code: string;
  label: string;
}) {
  const id = useId();
  const [width, setWidth] = useState("fluid");
  return (
    <Preview
      label={label}
      code={code}
      roomy
      controls={
        <div className="variant-control">
          <Label htmlFor={id}>Width</Label>
          <Select
            items={widths}
            value={width}
            onValueChange={(v) => v && setWidth(v)}
          >
            <SelectTrigger
              id={id}
              aria-label={`${label} preview width`}
              className="w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {widths.map((item) => (
                  <SelectItem value={item.value} key={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      }
    >
      <div
        className="w-full min-w-0"
        style={{ maxWidth: width === "fluid" ? "100%" : `${width}px` }}
      >
        {children}
      </div>
    </Preview>
  );
}
