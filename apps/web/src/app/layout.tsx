import type { ReactNode } from "react";

export const metadata = {
  title: "Counted",
  description: "Privacy-first product analytics.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
