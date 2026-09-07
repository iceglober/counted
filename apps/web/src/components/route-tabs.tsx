"use client";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@counted/ui/components/tabs";
export type Tab = { href: string; label: string; current: boolean };
export function RouteTabs({
  items,
  label,
}: {
  items: readonly Tab[];
  label: string;
}) {
  const router = useRouter();
  return (
    <Tabs
      value={items.find((item) => item.current)?.href}
      onValueChange={(href) => router.push(href)}
      className="mb-8 min-w-0 border-b"
    >
      <TabsList
        aria-label={label}
        variant="line"
        className="-mb-px w-full justify-start gap-0 px-0 pt-0 pb-1 group-data-horizontal/tabs:h-12 sm:w-fit"
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.href}
            value={item.href}
            className="h-full min-w-0 flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
