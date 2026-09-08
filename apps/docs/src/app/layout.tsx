import type { Metadata } from "next";
import "@scalar/api-reference-react/style.css";
import "./globals.css";
import { publicUrls } from "../lib/deployment";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata { return {
  metadataBase: new URL(publicUrls().docs),
  title: "Counted API reference",
  description:
    "Explore the Counted API: workspaces, projects, dashboards, insights, monitors, and analytics queries.",
  alternates: { canonical: "/" },
}; }
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
