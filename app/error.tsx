"use client";

import { CountedLogo } from "@/components/icons";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <CountedLogo className="w-8 h-8 text-accent mx-auto mb-6" />
        <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-text-secondary mb-6">An unexpected error occurred.</p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm text-surface-0 bg-accent rounded-md hover:bg-accent-hover transition-colors font-medium"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
