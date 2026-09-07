"use client";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@counted/ui/components/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@counted/ui/components/alert-dialog";

/** Confirmation preserves the enclosing server-action form and its validation. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "default",
  size = "default",
  confirm,
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: "default" | "outline" | "destructive" | "ghost";
  size?: "default" | "sm";
  confirm?: string;
  disabled?: boolean;
}) {
  const status = useFormStatus();
  const [open, setOpen] = useState(false);
  const submitter = useRef<HTMLButtonElement>(null);
  const approved = useRef(false);
  return (
    <>
      <Button
        ref={submitter}
        type="submit"
        variant={variant}
        size={size}
        disabled={status.pending || disabled}
        onClick={(event) => {
          if (!confirm || approved.current) {
            approved.current = false;
            return;
          }
          event.preventDefault();
          if (event.currentTarget.form?.reportValidity()) setOpen(true);
        }}
      >
        {status.pending ? pendingLabel : children}
      </Button>
      {confirm && (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent finalFocus={submitter}>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm this change</AlertDialogTitle>
              <AlertDialogDescription>{confirm}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const button = submitter.current;
                  setOpen(false);
                  approved.current = true;
                  button?.click();
                }}
              >
                {children}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
