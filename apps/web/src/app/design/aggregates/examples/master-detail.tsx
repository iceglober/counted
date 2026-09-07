"use client";
import { useState } from "react";
import { IconArrowUpRight, IconFiles, IconSearch } from "@tabler/icons-react";
import { Badge } from "@counted/ui/components/badge";
import { Button } from "@counted/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@counted/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@counted/ui/components/input-group";
import { Separator } from "@counted/ui/components/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@counted/ui/components/tabs";

const records = [
  {
    name: "acme-web",
    description: "The main application",
    environment: "Production",
    status: "Active",
    readings: "12,840",
    created: "September 4, 2026",
  },
  {
    name: "acme-api",
    description: "The shared API",
    environment: "Production",
    status: "Active",
    readings: "8,256",
    created: "September 2, 2026",
  },
  {
    name: "acme-docs",
    description: "Documentation site",
    environment: "Staging",
    status: "Draft",
    readings: "240",
    created: "September 1, 2026",
  },
];

export default function MasterDetailExample() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>("acme-web");
  const record = records.find((r) => r.name === selected);
  const visible = records.filter((r) => r.name.includes(query.toLowerCase()));
  return (
    <div className="grid min-h-[390px] w-full grid-cols-1 border bg-background sm:grid-cols-[minmax(220px,0.85fr)_minmax(0,1.3fr)]">
      <div className="flex min-w-0 flex-col border-b sm:border-r sm:border-b-0">
        <div className="p-5">
          <p className="mb-3 text-xs text-muted-foreground">
            Collection / {records.length} records
          </p>
          <InputGroup>
            <InputGroupInput
              aria-label="Search collection records"
              placeholder="Search records…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <Separator />
        <div aria-label="Records" className="flex-1">
          {visible.map((item) => (
            <button
              key={item.name}
              type="button"
              className="flex w-full items-center gap-3 border-b px-5 py-[18px] text-left hover:bg-muted aria-pressed:bg-muted relative aria-pressed:before:absolute aria-pressed:before:inset-y-0 aria-pressed:before:left-0 aria-pressed:before:w-0.5 aria-pressed:before:bg-primary-ink"
              aria-pressed={selected === item.name}
              onClick={() => setSelected(item.name)}
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.name}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              </div>
              <IconArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {!visible.length && (
            <p className="p-5 text-xs leading-6 text-muted-foreground">
              No records match “{query}”. Try another name.
            </p>
          )}
        </div>
        <div className="p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={!selected}
            onClick={() => setSelected(null)}
          >
            Clear selection
          </Button>
        </div>
      </div>
      <div className="min-h-[260px] min-w-0 p-5 sm:p-7" aria-live="polite">
        {record ? (
          <div className="flex flex-col gap-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">{record.name}</h3>
              <Badge
                variant={record.status === "Active" ? "success" : "secondary"}
              >
                {record.status}
              </Badge>
            </div>
            <Tabs defaultValue="overview" key={record.name}>
              <TabsList variant="line">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="pt-7">
                <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 text-xs leading-relaxed sm:gap-x-6 sm:gap-y-[18px] [&_dt]:text-muted-foreground [&_dd]:[overflow-wrap:anywhere]">
                  <dt>Environment</dt>
                  <dd>{record.environment}</dd>
                  <dt>Readings</dt>
                  <dd className="tabular-nums">{record.readings}</dd>
                  <dt>Created</dt>
                  <dd>{record.created}</dd>
                  <dt>Identifier</dt>
                  <dd className="font-mono text-xs">
                    rec_{record.name.replaceAll("-", "_")}
                  </dd>
                </dl>
              </TabsContent>
              <TabsContent value="activity" className="pt-7">
                <div className="flex flex-col gap-5 text-xs">
                  <p>
                    <span className="block font-medium">Record updated</span>
                    <span className="mt-1 block text-muted-foreground">
                      September 5, 2026 · 09:42
                    </span>
                  </p>
                  <Separator />
                  <p>
                    <span className="block font-medium">Record created</span>
                    <span className="mt-1 block text-muted-foreground">
                      {record.created}
                    </span>
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <Empty className="h-full p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconFiles />
              </EmptyMedia>
              <EmptyTitle>Select a record</EmptyTitle>
              <EmptyDescription>
                Choose a record from the collection to see its details here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
