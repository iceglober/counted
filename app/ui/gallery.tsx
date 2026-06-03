"use client";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectLabel, SelectGroup } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster, toast } from "@/components/ui/sonner";
import { MetricCard } from "@/components/dashboard/metric-card";
import { AreaChart } from "@/components/dashboard/area-chart";
import { Breakdown } from "@/components/dashboard/breakdown";
import { Funnel } from "@/components/dashboard/funnel";
import { Retention } from "@/components/dashboard/retention";

const TS = { labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], values: [120, 180, 150, 240, 310, 270, 360] };
const METRIC = { value: "12,481", trend: 12, sparkline: [10, 14, 12, 18, 16, 22, 28] };
const BARS = [
  { label: "chrome", value: 820 },
  { label: "safari", value: 410 },
  { label: "firefox", value: 180 },
  { label: "edge", value: 90 },
];
const FUNNEL = [
  { label: "page_view", value: 1000, rate: 100 },
  { label: "signup", value: 420, rate: 42 },
  { label: "activate", value: 184, rate: 44 },
];
const RET = {
  periods: ["W0", "W1", "W2", "W3"],
  cohorts: [
    { label: "Jan 1", size: 320, retention: [100, 62, 48, 40] },
    { label: "Jan 8", size: 280, retention: [100, 55, 41] },
    { label: "Jan 15", size: 410, retention: [100, 68] },
  ],
};
import { Plus, ArrowRight, Trash2, Pencil, Scaling, Share2, GripVertical, Star, Settings, Check } from "lucide-react";

const ACCENTS = [
  { name: "Iris", hex: "#7C6CF7", fg: "#FFFFFF", rec: true },
  { name: "Indigo", hex: "#5B6CFF", fg: "#FFFFFF" },
  { name: "Lime", hex: "#C6F24E", fg: "#08090D" },
  { name: "Fuchsia", hex: "#EC5FA8", fg: "#FFFFFF" },
  { name: "Amber (old)", hex: "#D4A853", fg: "#08090D" },
];

/**
 * Living gallery of the Counted component library. Each primitive gets a
 * <Section>; specimens render every variant/size/state so the look, feel, and
 * behaviour are reviewable in one place as the library grows.
 */
export function Gallery() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border px-12 py-8">
        <h1 className="font-display text-2xl tracking-tight">Counted UI</h1>
        <p className="text-sm text-text-secondary mt-1">
          Component library — shadcn architecture, themed with Counted tokens. Iris accent = primary action.
        </p>
      </header>
      <div className="px-12 py-10 max-w-6xl columns-1 gap-10 lg:columns-2">
        <Section title="Share image (OG)" note="The Open Graph / Twitter card shown when a Counted link is shared. Generated dynamically — see app/opengraph-image.tsx. Twitter uses the same image.">
          <div className="py-6 flex flex-col gap-3">
            <p className="text-xs text-text-tertiary">/opengraph-image · 1200×630</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/opengraph-image"
              alt="Counted Open Graph preview"
              width={600}
              height={315}
              className="rounded-lg border border-border w-full max-w-[600px]"
            />
            <a href="/opengraph-image" className="text-xs text-accent hover:text-accent-hover transition-colors">
              Open full size →
            </a>
          </div>
        </Section>
        <Section title="Accent" note="The primary color. Iris is the new default (applied live above/below). Compare against alternatives — say the word to switch.">
          {ACCENTS.map((a) => (
            <div key={a.name} className="flex items-center gap-6 py-4">
              <div className="w-24 shrink-0 text-xs uppercase tracking-wider text-text-tertiary">
                {a.name}
                {a.rec && <span className="ml-1 text-accent">●</span>}
              </div>
              <div className="flex items-center gap-4">
                <div className="size-9 rounded-md" style={{ backgroundColor: a.hex }} />
                <button
                  className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
                  style={{ backgroundColor: a.hex, color: a.fg }}
                >
                  Primary
                </button>
                <span className="text-sm font-medium" style={{ color: a.hex }}>
                  Accent text
                </span>
                <span className="font-mono text-xs text-text-tertiary">{a.hex}</span>
              </div>
            </div>
          ))}
        </Section>

        <Section title="Icon button" note="The app's primary action pattern. Rests muted, lifts to the accent on hover, with an accent tooltip that follows the cursor. Hover one to see it.">
          <Row label="Toolbar">
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-1">
              <IconButton icon={<GripVertical />} label="Drag to reorder" />
              <IconButton icon={<Scaling />} label="Resize" />
              <IconButton icon={<Pencil />} label="Configure" />
              <IconButton icon={<Share2 />} label="Share" />
              <IconButton icon={<Trash2 />} label="Remove" tone="danger" />
            </div>
          </Row>
          <Row label="Standalone">
            <IconButton icon={<Plus />} label="Add insight" />
            <IconButton icon={<Settings />} label="Settings" />
            <IconButton icon={<Star />} label="Set as default" />
          </Row>
        </Section>

        <Section title="Button" note="6 variants × 4 sizes. asChild for link buttons. Press nudge + focus ring built in.">
          <Row label="Variants">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </Row>
          <Row label="Sizes">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add"><Plus /></Button>
          </Row>
          <Row label="With icon">
            <Button><Plus />New insight</Button>
            <Button variant="secondary">Continue<ArrowRight /></Button>
            <Button variant="ghost"><Trash2 />Delete</Button>
          </Row>
          <Row label="States">
            <Button>Default</Button>
            <Button disabled>Disabled</Button>
            <Button disabled>Sending…</Button>
          </Row>
          <Row label="Full width">
            <div className="w-80">
              <Button className="w-full">Send magic link</Button>
            </div>
          </Row>
        </Section>

        <Section title="Input & Field" note="Native input themed to tokens; Field wraps label + control + hint/error.">
          <Row label="Input">
            <div className="w-72"><Input placeholder="you@company.com" /></div>
          </Row>
          <Row label="Field">
            <div className="w-72">
              <Field label="Project name" hint="Shown in your dashboard list.">
                <Input placeholder="My App" />
              </Field>
            </div>
          </Row>
          <Row label="Error">
            <div className="w-72">
              <Field label="Email" error="That email looks invalid.">
                <Input defaultValue="nope@" />
              </Field>
            </div>
          </Row>
        </Section>

        <Section title="Card" note="Surface-1 container. Header / Title / Description / Content / Footer.">
          <Row label="Example">
            <Card className="w-80">
              <CardHeader>
                <CardTitle>Product metrics</CardTitle>
                <CardDescription>Traffic, events, and breakdowns for the last 30 days.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-text-secondary">12 insights · shared</CardContent>
              <CardFooter className="gap-2">
                <Button size="sm">Open</Button>
                <Button size="sm" variant="secondary">Duplicate</Button>
              </CardFooter>
            </Card>
          </Row>
        </Section>

        <Section title="Badge" note="Quiet semantic chips for tags, keys, and statuses.">
          <Row label="Variants">
            <Badge>ck_live</Badge>
            <Badge variant="secondary">plan: pro</Badge>
            <Badge variant="outline">variant</Badge>
            <Badge variant="success"><Check />Connected</Badge>
            <Badge variant="error">Failed</Badge>
          </Row>
        </Section>

        <Section title="Separator" note="Hairline divider (horizontal or vertical).">
          <Row label="Horizontal">
            <div className="w-72">
              <div className="text-sm text-text-secondary">Account</div>
              <Separator className="my-3" />
              <div className="text-sm text-text-secondary">Billing</div>
            </div>
          </Row>
          <Row label="Vertical">
            <div className="flex h-5 items-center gap-3 text-sm text-text-secondary">
              <span>Docs</span>
              <Separator orientation="vertical" />
              <span>API</span>
              <Separator orientation="vertical" />
              <span>Status</span>
            </div>
          </Row>
        </Section>

        <Section title="Select" note="Radix select — keyboard + typeahead, accent check on the chosen item.">
          <Row label="Measure">
            <div className="w-56">
              <Select defaultValue="count">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Aggregation</SelectLabel>
                    <SelectItem value="count">Count</SelectItem>
                    <SelectItem value="unique_sessions">Unique sessions</SelectItem>
                    <SelectItem value="unique_users">Unique users</SelectItem>
                    <SelectItem value="sum">Sum</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </Row>
        </Section>

        <Section title="Dropdown menu" note="Context menus — dashboard/insight actions, with a destructive item.">
          <Row label="Dashboard">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm"><Settings />Dashboard</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Dashboard</DropdownMenuLabel>
                <DropdownMenuItem><Share2 />Share publicly</DropdownMenuItem>
                <DropdownMenuItem><Star />Set as default</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive"><Trash2 />Delete dashboard</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
        </Section>

        <Section title="Tooltip" note="The cursor-following accent tooltip — on any trigger, not just icons.">
          <Row label="Hover">
            <Tooltip label="Client key — safe to commit">
              <Badge>ck_B1D7…</Badge>
            </Tooltip>
            <Tooltip label="This can't be undone" tone="danger">
              <span className="text-sm text-text-secondary underline decoration-dotted">danger</span>
            </Tooltip>
          </Row>
        </Section>

        <Section title="Dialog" note="Modal overlay (backdrop blur) — the insight configurator pattern.">
          <Row label="Open">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm"><Pencil />Configure insight</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Configure insight</DialogTitle>
                  <DialogDescription>Pick what to measure and how to group it.</DialogDescription>
                </DialogHeader>
                <Field label="Title"><Input defaultValue="Signups by plan" /></Field>
                <DialogFooter>
                  <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
                  <DialogClose asChild><Button size="sm">Done</Button></DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Row>
        </Section>

        <Section title="Popover" note="Floating panel — the card size picker.">
          <Row label="Open">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="sm"><Scaling />Resize</Button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-1">
                {["Small", "Medium", "Full width"].map((s, i) => (
                  <button
                    key={s}
                    className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-surface-3 ${i === 1 ? "text-accent" : "text-text-secondary hover:text-text-primary"}`}
                  >
                    {s}
                    {i === 1 && <Check className="size-3.5" />}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </Row>
        </Section>

        <Section title="Toggle group" note="Segmented control — the insight type-picker.">
          <Row label="Insight type">
            <ToggleGroup type="single" defaultValue="breakdown">
              <ToggleGroupItem value="metric">Metric</ToggleGroupItem>
              <ToggleGroupItem value="timeseries">Time series</ToggleGroupItem>
              <ToggleGroupItem value="breakdown">Breakdown</ToggleGroupItem>
              <ToggleGroupItem value="funnel">Funnel</ToggleGroupItem>
              <ToggleGroupItem value="retention">Retention</ToggleGroupItem>
            </ToggleGroup>
          </Row>
        </Section>

        <Section title="Tabs" note="Section switcher — settings.">
          <Row label="Settings">
            <Tabs defaultValue="account" className="w-full">
              <TabsList>
                <TabsTrigger value="account">Account</TabsTrigger>
                <TabsTrigger value="alerts">Alerts</TabsTrigger>
                <TabsTrigger value="billing">Billing</TabsTrigger>
              </TabsList>
              <TabsContent value="account" className="text-sm text-text-secondary">Your profile and email.</TabsContent>
              <TabsContent value="alerts" className="text-sm text-text-secondary">Threshold alerts and channels.</TabsContent>
              <TabsContent value="billing" className="text-sm text-text-secondary">Plan and usage.</TabsContent>
            </Tabs>
          </Row>
        </Section>

        <Section title="Switch" note="On = iris track. Toggles for alerts and channels.">
          <Row label="Alerts">
            <div className="flex items-center gap-3">
              <Switch defaultChecked id="sw1" />
              <label htmlFor="sw1" className="text-sm text-text-secondary">Email alerts</label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="sw2" />
              <label htmlFor="sw2" className="text-sm text-text-secondary">Slack</label>
            </div>
          </Row>
        </Section>

        <Section title="Table" note="Borderless rows, hairline header, hover lift (Tufte: alignment over gridlines).">
          <Row label="Events">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[["page_view", "12,481", "2m ago"], ["signup", "318", "9m ago"], ["cta_activate", "1,204", "just now"]].map((r) => (
                  <TableRow key={r[0]}>
                    <TableCell className="font-mono text-text-primary">{r[0]}</TableCell>
                    <TableCell className="text-right tabular-nums">{r[1]}</TableCell>
                    <TableCell className="text-right">{r[2]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Row>
        </Section>

        <Section title="Skeleton" note="Loading placeholders — reserve layout so content doesn't jump.">
          <Row label="Card">
            <div className="w-72 space-y-3 rounded-lg border border-border bg-surface-1 p-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-2 w-5/6" />
            </div>
          </Row>
        </Section>

        <Section title="Toast" note="Sonner, themed to tokens. Click to fire one.">
          <Row label="Fire">
            <Button size="sm" variant="secondary" onClick={() => toast("Key copied to clipboard")}>Default</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.success("Dashboard shared")}>Success</Button>
            <Button size="sm" variant="secondary" onClick={() => toast.error("Couldn't save — try again")}>Error</Button>
          </Row>
        </Section>
      </div>

      <div className="px-12 pb-20 max-w-5xl">
        <h2 className="font-display text-lg tracking-tight">Charts</h2>
        <p className="text-xs text-text-tertiary mt-0.5 mb-5">
          Joyful by default — lines draw in, bars grow from the left, the metric counts up, retention cells pop as a wave. Reload to replay.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MetricCard title="Total events" data={METRIC} />
          <div className="h-52"><AreaChart title="Events over time" data={TS} /></div>
          <Breakdown title="Top browsers" items={BARS} />
          <Funnel title="Activation funnel" steps={FUNNEL} />
          <div className="md:col-span-2"><Retention title="Weekly retention" data={RET} /></div>
        </div>
      </div>
      <Toaster />
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 break-inside-avoid">
      <h2 className="font-display text-lg tracking-tight">{title}</h2>
      {note && <p className="text-xs text-text-tertiary mt-0.5 mb-4">{note}</p>}
      <div className="rounded-lg border border-border bg-surface-1 px-6 divide-y divide-border">
        {children}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 py-4">
      <div className="w-24 shrink-0 text-xs uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
