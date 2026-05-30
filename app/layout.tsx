import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Counted",
  description: "Privacy-focused app analytics with composable dashboards",
};

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
