import type { ReactNode } from "react";

export function ConfigSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs text-text-tertiary uppercase tracking-wider">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
