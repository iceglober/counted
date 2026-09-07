"use client";

import { useState } from "react";
import { IconStar } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { Badge } from "@counted/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@counted/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@counted/ui/components/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@counted/ui/components/tabs";

const workspaces = [
  { value: "acme", label: "Acme" },
  { value: "studio", label: "Studio" },
];
const entries = [
  {
    name: "Website",
    description: "Public pages, collected and organized.",
    count: 12,
    recent: true,
  },
  {
    name: "Application",
    description: "A home for the work in progress.",
    count: 8,
    recent: true,
  },
  {
    name: "Documentation",
    description: "Guides and references worth keeping.",
    count: 4,
    recent: false,
  },
];

export default function TopNavigationShellExample() {
  const [workspace, setWorkspace] = useState("acme");
  const [pinned, setPinned] = useState<string[]>(["Website"]);
  const [view, setView] = useState("all");
  const visible = entries.filter((entry) =>
    view === "pinned"
      ? pinned.includes(entry.name)
      : view === "recent"
        ? entry.recent
        : true,
  );
  return (
    <div
      className="@container/top-shell w-full border bg-background text-sm"
      data-layout="top-navigation-shell"
    >
      <Tabs
        value={view}
        onValueChange={setView}
        className="min-h-[540px] gap-0"
      >
        <header className="border-b">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-5 py-4 @min-[600px]/top-shell:px-8">
            <span className="font-heading text-lg">counted</span>
            <Select
              items={workspaces}
              value={workspace}
              onValueChange={(v) => v && setWorkspace(v)}
            >
              <SelectTrigger
                aria-label="Top navigation workspace"
                className="w-32"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {workspaces.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {/* Reserve the line indicator gutter and overlap the header divider. */}
          <div className="mx-auto -mb-px max-w-4xl px-5 @min-[600px]/top-shell:px-8">
            <TabsList
              variant="line"
              aria-label="Library views"
              className="w-full justify-start gap-2 px-0 pt-0 pb-1 group-data-horizontal/tabs:h-12 @min-[600px]/top-shell:gap-6"
            >
              <TabsTrigger value="all" className="h-full flex-none px-2">
                <span className="@min-[600px]/top-shell:hidden">All</span>
                <span className="hidden @min-[600px]/top-shell:inline">
                  All collections
                </span>
              </TabsTrigger>
              <TabsTrigger value="recent" className="h-full flex-none px-2">
                Recent
              </TabsTrigger>
              <TabsTrigger value="pinned" className="h-full flex-none px-2">
                Pinned
              </TabsTrigger>
            </TabsList>
          </div>
        </header>
        {["all", "recent", "pinned"].map((tab) => (
          <TabsContent
            value={tab}
            key={tab}
            className="mx-auto w-full max-w-4xl px-5 py-7 @min-[600px]/top-shell:px-8 @min-[600px]/top-shell:py-9"
          >
            <p className="mb-2 text-xs text-muted-foreground">
              {workspace === "acme" ? "Acme" : "Studio"} workspace
            </p>
            <h3 className="font-heading text-xl">
              {view === "all"
                ? "Your library"
                : view === "recent"
                  ? "Recently opened"
                  : "Pinned collections"}
            </h3>
            <p className="mt-2 mb-7 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {view === "pinned"
                ? "The collections you want to keep close."
                : "Room to browse, with the essentials always in reach."}
            </p>
            {visible.length ? (
              <div className="grid grid-cols-1 gap-4 @min-[600px]/top-shell:grid-cols-2">
                {visible.map((entry) => (
                  <Card size="sm" key={entry.name} className="h-full">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="pt-2">{entry.name}</CardTitle>
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          aria-label={`${pinned.includes(entry.name) ? "Unpin" : "Pin"} ${entry.name}`}
                          aria-pressed={pinned.includes(entry.name)}
                          onClick={() =>
                            setPinned((current) =>
                              current.includes(entry.name)
                                ? current.filter((name) => name !== entry.name)
                                : [...current, entry.name],
                            )
                          }
                        >
                          <IconStar
                            className={
                              pinned.includes(entry.name)
                                ? "fill-primary-ink text-primary-ink"
                                : "text-muted-foreground"
                            }
                          />
                        </Button>
                      </div>
                      <CardDescription>{entry.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Badge variant="outline">{entry.count} records</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>No pinned collections</EmptyTitle>
                  <EmptyDescription>
                    Pin a collection from your library to keep it here.
                  </EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={() => setView("all")}>
                  Browse collections
                </Button>
              </Empty>
            )}
          </TabsContent>
        ))}
        <footer className="mt-auto border-t">
          <div className="mx-auto flex max-w-4xl flex-wrap justify-between gap-2 px-5 py-4 text-xs text-muted-foreground @min-[600px]/top-shell:px-8">
            <span>{entries.length} collections</span>
            <span>{pinned.length} pinned</span>
          </div>
        </footer>
      </Tabs>
    </div>
  );
}
