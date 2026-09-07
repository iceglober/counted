import type { Metadata } from "next";
import { ShowcaseShell } from "./shell";
import "./showcase.css";

export const metadata: Metadata = {
  title: { default: "Design system — Counted UI", template: "%s — Counted UI" },
};

export default function DesignLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ShowcaseShell>{children}</ShowcaseShell>;
}
