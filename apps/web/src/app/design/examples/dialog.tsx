"use client";
import { useId, useState } from "react";
import { Button } from "@counted/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@counted/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@counted/ui/components/field";
import { Input } from "@counted/ui/components/input";
import { toast } from "@counted/ui/components/toast";
export default function DialogExample({
  variant = "form",
}: {
  variant?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        Edit record
      </DialogTrigger>
      <DialogContent showCloseButton={variant !== "without-close-button"}>
        <DialogHeader>
          <DialogTitle>Edit record</DialogTitle>
          <DialogDescription>
            Make a small change to this example record.
          </DialogDescription>
        </DialogHeader>
        {variant === "information" ? (
          <>
            <p className="text-sm leading-relaxed">
              This record belongs to the Production environment. It was created
              September 4, 2026.
            </p>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Close details
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setOpen(false);
              toast.add({ title: "Record updated", type: "success" });
            }}
            className="flex flex-col gap-8"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={id}>Display name</FieldLabel>
                <Input id={id} name="name" defaultValue="acme-web" required />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
