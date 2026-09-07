"use client";
import { useId, useState } from "react";
import { IconArrowUpRight, IconCircleCheck } from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@counted/ui/components/alert-dialog";
import { Badge } from "@counted/ui/components/badge";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";
import { toast } from "@counted/ui/components/toast";
const environments = [
  { value: "Production", label: "Production" },
  { value: "Staging", label: "Staging" },
];
export default function ReviewFlowExample() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [name, setName] = useState("acme-web");
  const [environment, setEnvironment] = useState("Production");
  const [saved, setSaved] = useState(false);
  const [committed, setCommitted] = useState({
    name: "acme-web",
    environment: "Production",
  });
  return (
    <div className="w-full border bg-background p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <Badge variant="outline" className="mb-4">
            {saved ? "Complete" : "Ready to edit"}
          </Badge>
          <h3 className="text-lg font-semibold">
            {saved ? committed.name : "One focused task."}
          </h3>
          <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            {saved
              ? `Saved in ${committed.environment}. Open the dialog to make another change.`
              : "A clear sequence: edit a record, review the change, and confirm."}
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (value) {
              setName(committed.name);
              setEnvironment(committed.environment);
            }
          }}
        >
          <DialogTrigger render={<Button />}>
            <span>{saved ? "Edit again" : "Start example"}</span>
            <IconArrowUpRight data-icon="inline-end" />
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit record</DialogTitle>
              <DialogDescription>
                Review your changes before applying them.
              </DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-8"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) setReview(true);
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={id}>Record name</FieldLabel>
                  <Input
                    id={id}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={40}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={id + "-env"}>Environment</FieldLabel>
                  <Select
                    items={environments}
                    value={environment}
                    onValueChange={(v) => v && setEnvironment(v)}
                  >
                    <SelectTrigger id={id + "-env"} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {environments.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button type="submit">Review changes</Button>
              </DialogFooter>
            </form>
            <AlertDialog open={review} onOpenChange={setReview}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Ready to save?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Apply these changes to the example record.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 text-xs leading-relaxed sm:gap-x-6 sm:gap-y-[18px] [&_dt]:text-muted-foreground [&_dd]:[overflow-wrap:anywhere]">
                  <dt>Name</dt>
                  <dd>{name}</dd>
                  <dt>Environment</dt>
                  <dd>{environment}</dd>
                </dl>
                <AlertDialogFooter>
                  <AlertDialogCancel>Back to edit</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setReview(false);
                      setOpen(false);
                      setCommitted({ name: name.trim(), environment });
                      setSaved(true);
                      toast.add({
                        title: "Record saved",
                        description: `${name} · ${environment}`,
                        type: "success",
                      });
                    }}
                  >
                    Confirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogContent>
        </Dialog>
      </div>
      {saved && (
        <p
          className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <IconCircleCheck className="size-4" />
          Changes are saved locally in this preview.
        </p>
      )}
    </div>
  );
}
