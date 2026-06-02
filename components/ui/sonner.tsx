"use client";

import { Toaster as Sonner, toast } from "sonner";

// Toasts themed via CSS vars pointing at our tokens, so they track light/dark
// automatically. Mount <Toaster/> once in the app layout; call toast() anywhere.
function Toaster(props: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "group font-sans",
          description: "text-text-secondary",
          actionButton: "bg-accent text-accent-foreground",
          cancelButton: "bg-surface-3 text-text-secondary",
        },
      }}
      style={
        {
          "--normal-bg": "var(--color-surface-2)",
          "--normal-text": "var(--color-text-primary)",
          "--normal-border": "var(--color-border)",
          "--success-bg": "var(--color-surface-2)",
          "--success-text": "var(--color-success)",
          "--success-border": "var(--color-border)",
          "--error-bg": "var(--color-surface-2)",
          "--error-text": "var(--color-error)",
          "--error-border": "var(--color-border)",
          "--border-radius": "0.5rem",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, toast };
