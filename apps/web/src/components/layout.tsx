import Link from "next/link";
import { Children, type ReactNode } from "react";
import { Button } from "@counted/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@counted/ui/components/card";
import { Empty } from "./notice";
export { RouteTabs as Tabs } from "./route-tabs";
export { Disclosure } from "./disclosure";
export type { Tab } from "./route-tabs";

export const PageHeader = ({
  eyebrow,
  title,
  purpose,
  actions,
  plain = false,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  purpose?: ReactNode;
  actions?: ReactNode;
  plain?: boolean;
}) => (
  <header className="mb-8 flex flex-wrap items-start justify-between gap-5 border-b pb-7">
    <div className="min-w-0 flex-1 basis-72">
      {eyebrow !== undefined && (
        <div className="mb-3 text-xs text-muted-foreground">{eyebrow}</div>
      )}
      <h1
        className={`font-heading font-normal break-words ${plain ? "text-xl" : "text-2xl sm:text-3xl"}`}
      >
        {title}
      </h1>
      {purpose !== undefined && (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {purpose}
        </p>
      )}
    </div>
    {actions !== undefined && (
      <div className="flex max-w-full flex-wrap gap-3">{actions}</div>
    )}
  </header>
);
export const Region = ({
  title,
  meta,
  children,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) => (
  <section className="mt-9 min-w-0 space-y-5 first:mt-0">
    {title !== undefined && (
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-xl">
          <span
            aria-hidden="true"
            className="mb-3 block h-0.5 w-6 bg-primary-ink"
          />
          {title}
        </h2>
        {meta !== undefined && (
          <span className="text-xs text-muted-foreground">{meta}</span>
        )}
      </div>
    )}
    {children}
  </section>
);
export const Panel = ({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) => (
  <Card className="@container/form">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>
        {title}
      </CardTitle>
      {hint !== undefined && <CardDescription>{hint}</CardDescription>}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);
export const MasterDetail = ({
  list,
  children,
}: {
  list: ReactNode;
  children: ReactNode;
}) => (
  <div className="@container/detail border">
    <div className="grid grid-cols-1 @min-[760px]/detail:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0 border-b @min-[760px]/detail:border-r @min-[760px]/detail:border-b-0">
        {list}
      </div>
      <div className="min-w-0 space-y-6 p-5 @min-[760px]/detail:p-7">
        {children}
      </div>
    </div>
  </div>
);
export const MasterList = ({
  count,
  note,
  children,
}: {
  count: ReactNode;
  note?: ReactNode;
  children: ReactNode;
}) => (
  <>
    <div className="flex flex-wrap justify-between gap-2 border-b bg-muted px-4 py-3 text-xs text-muted-foreground">
      <span>{count}</span>
      {note !== undefined && <span>{note}</span>}
    </div>
    {children}
  </>
);
export const MasterRow = ({
  href,
  current,
  title,
  meta,
}: {
  href: string;
  current: boolean;
  title: ReactNode;
  meta?: ReactNode;
}) => (
  <Button
    render={<Link href={href} scroll={false} />}
    nativeButton={false}
    variant="ghost"
    aria-current={current ? "page" : undefined}
    className="h-auto min-h-16 w-full flex-col items-start gap-2 border-b border-b-border px-4 py-4 text-left whitespace-normal aria-[current=page]:bg-accent aria-[current=page]:text-primary-ink"
  >
    <span className="max-w-full break-words">{title}</span>
    {meta !== undefined && (
      <span className="flex max-w-full flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
        {meta}
      </span>
    )}
  </Button>
);
export const DetailEmpty = ({ children }: { children: ReactNode }) => (
  <Empty>{children}</Empty>
);
export const TwoColumn = ({ children }: { children: ReactNode }) => (
  <div className="@container/columns">
    <div className="grid grid-cols-1 gap-8 @min-[900px]/columns:grid-cols-2">
      {Children.map(children, (child) => (
        <div className="min-w-0">{child}</div>
      ))}
    </div>
  </div>
);
export const KeyValues = ({
  rows,
}: {
  rows: readonly { label: ReactNode; value: ReactNode }[];
}) => (
  <dl className="grid gap-4">
    {rows.map((row, i) => (
      <div
        key={i}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5 text-sm"
      >
        <dt className="text-muted-foreground">{row.label}</dt>
        <dd className="min-w-0 break-words">{row.value}</dd>
      </div>
    ))}
  </dl>
);
export const CenteredPage = ({ children }: { children: ReactNode }) => (
  <main className="app-content mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-7 px-5 py-12">
    <Link href="/" className="font-heading text-xl text-foreground">
      counted
    </Link>
    {children}
  </main>
);
