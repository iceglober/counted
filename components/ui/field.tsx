import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

// Lightweight label + control + hint/error wrapper. The app doesn't use
// react-hook-form, so this is the form unit instead of shadcn's heavier <Form>.
// Error takes precedence over hint (ux-for-ai Ch.5: tell the user what went wrong).
function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : hint ? (
        <p className="text-xs text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

export { Field };
