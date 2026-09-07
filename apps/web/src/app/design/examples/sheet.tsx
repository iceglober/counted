"use client";
import { Button } from "@counted/ui/components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@counted/ui/components/sheet";
import { Badge } from "@counted/ui/components/badge";
import { Separator } from "@counted/ui/components/separator";
export default function SheetExample({
  variant = "right",
}: {
  variant?: string;
}) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>
        Inspect record
      </SheetTrigger>
      <SheetContent side={variant as "top" | "bottom" | "left" | "right"}>
        <SheetHeader>
          <SheetTitle>acme-web</SheetTitle>
          <SheetDescription>
            Record details, close to the collection.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-8 px-6">
          <Badge variant="success" className="w-fit">
            Active
          </Badge>
          <Separator />
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 text-xs leading-relaxed sm:gap-x-6 sm:gap-y-[18px] [&_dt]:text-muted-foreground [&_dd]:[overflow-wrap:anywhere]">
            <dt>Environment</dt>
            <dd>Production</dd>
            <dt>Identifier</dt>
            <dd>rec_acme_web</dd>
            <dt>Created</dt>
            <dd>September 4, 2026</dd>
          </dl>
        </div>
        <SheetFooter>
          <SheetClose render={<Button variant="outline" />}>
            Close details
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
