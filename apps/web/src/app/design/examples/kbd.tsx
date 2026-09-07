"use client";
import { Kbd, KbdGroup } from "@counted/ui/components/kbd";
export default function KbdExample({
  variant = "single",
}: {
  variant?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-5 text-sm">
      <span>
        {variant === "single" ? "Move between controls" : "Open command menu"}
      </span>
      {variant === "single" ? (
        <Kbd>Tab</Kbd>
      ) : (
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      )}
    </div>
  );
}
