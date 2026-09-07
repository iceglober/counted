"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  IconLayoutDashboard,
  IconFolders,
  IconBell,
  IconUsers,
  IconSettings,
  IconTerminal2,
  IconMenu2,
  IconLogout,
} from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@counted/ui/components/sheet";
import { SelectControl } from "./select-control";
import type { ContractOutputs } from "../lib/client";
type Workspace = ContractOutputs["account"]["me"]["workspaces"][number];
export type Section =
  "dashboards" | "monitors" | "projects" | "members" | "settings" | "api-explorer";
const sections = [
  { key: "dashboards", label: "Dashboards", icon: IconLayoutDashboard },
  { key: "projects", label: "Projects", icon: IconFolders },
  { key: "monitors", label: "Monitors", icon: IconBell },
  { key: "members", label: "Members", icon: IconUsers },
  { key: "api-explorer", label: "API Explorer", icon: IconTerminal2 },
  { key: "settings", label: "Settings", icon: IconSettings },
] as const;
export function Sidebar({
  workspaces,
  workspaceId,
  section,
  email,
}: {
  workspaces: readonly Workspace[];
  workspaceId: string;
  section: Section;
  email: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out failed");
      window.location.assign("/sign-in");
    } catch {
      setSignOutFailed(true);
      setSigningOut(false);
    }
  };
  const current = workspaces.find((workspace) => workspace.id === workspaceId);
  const contents = (
    <>
      <div className="px-4 pb-6">
        <p className="mb-2 text-xs text-muted-foreground">Workspace</p>
        <SelectControl
          aria-label="Current workspace"
          items={workspaces.map((workspace) => ({
            value: workspace.id,
            label: workspace.name,
          }))}
          value={workspaceId}
          onValueChange={(value) => {
            setOpen(false);
            router.push(`/w/${value}/${section}`);
          }}
        />
        <p className="mt-2 text-xs capitalize text-muted-foreground">
          {current?.role}
        </p>
        <Link href="/welcome?again=1" onClick={() => setOpen(false)} className="mt-3 inline-block text-xs text-primary-ink underline underline-offset-4">Create workspace</Link>
      </div>
      <nav aria-label="Console" className="grid gap-1 px-3">
        {sections.map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            nativeButton={false}
            render={
              <Link
                href={`/w/${workspaceId}/${key}`}
                onClick={() => setOpen(false)}
              />
            }
            variant="ghost"
            aria-current={key === section ? "page" : undefined}
            className="h-11 w-full justify-start gap-3 px-3 aria-[current=page]:bg-accent aria-[current=page]:text-primary-ink"
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </nav>
      <div className="mt-auto space-y-4 px-4 pt-8">
        <p className="break-all text-xs text-muted-foreground">{email}</p>
        <Button nativeButton={false} render={<Link href="/account" onClick={() => setOpen(false)} />} variant="ghost" className="w-full justify-start">Account settings</Button>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          <IconLogout />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
        {signOutFailed && (
          <Alert variant="destructive">
            <AlertDescription>
              Couldn’t sign out. Please try again.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh min-w-0 flex-col border-r bg-muted/30 py-6 lg:flex">
        <Link
          href={`/w/${workspaceId}/dashboards`}
          className="mb-8 px-7 font-heading text-xl"
        >
          counted
        </Link>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1">
          {contents}
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-4 border-b bg-background px-5 lg:hidden">
        <Link
          href={`/w/${workspaceId}/dashboards`}
          className="font-heading text-lg"
        >
          counted
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={<Button variant="ghost" size="icon-lg" />}
            aria-label="Open navigation"
          >
            <IconMenu2 />
          </SheetTrigger>
          <SheetContent side="left" className="max-w-80">
            <SheetHeader className="px-6 pr-14">
              <SheetTitle>Counted</SheetTitle>
              <SheetDescription>Your workspace and account.</SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
              {contents}
            </div>
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
