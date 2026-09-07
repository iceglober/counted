"use client";

import type { ReactNode } from "react";
import { IconDots } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@counted/ui/components/dialog";

/** Keep list rows scannable while retaining the existing server-action forms. */
export function RowActions({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={label}
      >
        <IconDots aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="app-content @container/form">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
