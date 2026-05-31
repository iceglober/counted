import Link from "next/link";
import { CountedLogo } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <CountedLogo className="w-8 h-8 text-accent mx-auto mb-6" />
        <h1 className="text-4xl font-semibold tabular-nums mb-2">404</h1>
        <p className="text-sm text-text-secondary mb-6">This page doesn't exist.</p>
        <Link
          href="/"
          className="text-sm text-accent hover:text-accent-hover transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
