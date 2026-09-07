"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Button } from "@counted/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@counted/ui/components/dialog";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { failureOf, sentenceFor, type Failure } from "../lib/failure";

const CreationContext = createContext({
  close: () => {},
  setBusy: (_busy: boolean) => {},
});

/** A secret-producing action must finish before its dialog can be dismissed. */
export function CreationPending() {
  const { pending } = useFormStatus();
  const { setBusy } = useContext(CreationContext);
  useEffect(() => {
    setBusy(pending);
    return () => setBusy(false);
  }, [pending, setBusy]);
  return null;
}

/** One frame for creation. Closing unmounts the draft; failed saves keep it intact. */
export function CreationDialog({
  title,
  trigger = title,
  children,
  wide = false,
}: {
  title: string;
  trigger?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogTrigger render={<Button />}>{trigger}</DialogTrigger>
      <DialogContent
        className={`app-content @container/form p-5 sm:p-7 ${wide ? "max-w-xl sm:max-w-xl" : ""}`}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
        </DialogHeader>
        <CreationContext.Provider
          value={{ close: () => setOpen(false), setBusy }}
        >
          {open && children}
        </CreationContext.Provider>
      </DialogContent>
    </Dialog>
  );
}

export type CreationStep = {
  label: string;
  content: ReactNode;
  ready?: boolean;
};

/** Steps stay mounted so back/forward never drops entered values. */
export function CreationForm({
  action,
  submitLabel,
  pendingLabel = "Creating…",
  children,
  steps,
  successHref,
}: {
  action: (form: FormData) => Promise<Failure | null>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  steps?: readonly CreationStep[];
  successHref?: string;
}) {
  const { close, setBusy } = useContext(CreationContext);
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const last = !steps || step === steps.length - 1;
  useEffect(() => {
    if (previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [step]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = event.currentTarget;
    if (steps) {
      const panels = Array.from(
        form.querySelectorAll<HTMLElement>("[data-creation-step]"),
      );
      const indices = last ? panels.map((_, index) => index) : [step];
      for (const index of indices) {
        const invalid = panels[index]?.querySelector<HTMLInputElement>(
          "input:invalid, textarea:invalid, select:invalid",
        );
        if (invalid) {
          setStep(index);
          requestAnimationFrame(() => invalid.reportValidity());
          return;
        }
      }
      if (steps[step]?.ready === false) return;
      if (!last) {
        setStep(step + 1);
        return;
      }
    }
    locked.current = true;
    setPending(true);
    setBusy(true);
    setFailure(null);
    try {
      const result = await action(new FormData(form));
      if (result) setFailure(result);
      else {
        close();
        if (successHref) router.push(successHref);
      }
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      locked.current = false;
      setPending(false);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate={!!steps} aria-busy={pending}>
      {steps && (
        <div className="mb-6 space-y-4">
          <ol
            aria-label="Progress"
            className="grid grid-flow-col auto-cols-fr gap-2"
          >
            {steps.map((one, index) => (
              <li
                key={one.label}
                aria-current={index === step ? "step" : undefined}
                className={`border-t-2 pt-2 text-xs ${index <= step ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}
              >
                <span className="sr-only tabular-nums sm:not-sr-only sm:mr-1.5">
                  {index + 1}
                </span>
                {one.label}
              </li>
            ))}
          </ol>
          <h3 ref={heading} tabIndex={-1} className="sr-only">
            {steps[step]?.label}
          </h3>
        </div>
      )}
      <fieldset
        disabled={pending}
        className={steps ? "min-w-0" : "min-w-0 space-y-5"}
      >
        {children}
        {steps?.map((one, index) => (
          <div
            key={one.label}
            hidden={index !== step}
            data-creation-step={index}
          >
            {one.content}
          </div>
        ))}
      </fieldset>
      {failure && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>{sentenceFor(failure)}</AlertDescription>
        </Alert>
      )}
      <div className="mt-7 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t pt-5">
        <Button
          type="button"
          variant="ghost"
          className="px-2"
          disabled={pending}
          onClick={() => (step > 0 ? setStep(step - 1) : close())}
        >
          {step > 0 ? "Back" : "Cancel"}
        </Button>
        <Button
          key={last ? "save" : `next-${step}`}
          type="submit"
          className="h-auto min-h-10 min-w-0 justify-self-end whitespace-normal px-3 py-2 text-center"
          disabled={pending || steps?.[step]?.ready === false}
        >
          {pending ? pendingLabel : last ? submitLabel : "Continue"}
        </Button>
      </div>
    </form>
  );
}
