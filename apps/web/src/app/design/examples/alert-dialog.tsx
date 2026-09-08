"use client";
import { IconArchive } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@counted/ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@counted/ui/components/alert-dialog";
import { toast } from "@counted/ui/components/toast";
export default function AlertDialogExample({
  variant = "default",
}: {
  variant?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        Archive record
      </AlertDialogTrigger>
      <AlertDialogContent size={variant === "small" ? "sm" : "default"}>
        <AlertDialogHeader>
          {variant === "with-icon" && (
            <AlertDialogMedia>
              <IconArchive />
            </AlertDialogMedia>
          )}
          <AlertDialogTitle>Archive this record?</AlertDialogTitle>
          <AlertDialogDescription>
            acme-web will leave the active collection. You can restore it from
            the archive later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep record</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              toast.add({ title: "Record archived", type: "success" });
            }}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
