import type { ReactNode } from "react";
import { SetupKeyProvider } from "../../../components/setup-key";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <SetupKeyProvider>{children}</SetupKeyProvider>;
}
