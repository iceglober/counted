import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import {
  Field as UIField,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@counted/ui/components/field";

export const FieldGroup = ({
  legend,
  children,
}: {
  legend: ReactNode;
  children: ReactNode;
}) => (
  <FieldSet className="mt-7 gap-5">
    <FieldLegend className="mb-5 w-full border-t pt-5">{legend}</FieldLegend>
    {children}
  </FieldSet>
);
export const Fields = ({ children }: { children: ReactNode }) => (
  <div className="grid min-w-0 grid-cols-1 gap-5 @min-[560px]/form:grid-cols-2">
    {children}
  </div>
);
export const Field = ({
  label,
  htmlFor,
  hint,
  span,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  span?: "narrow" | "full";
  children: ReactNode;
}) => (
  <UIField className={span === "full" ? "col-span-full" : "min-w-0"}>
    <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
    {Children.map(children, (child) =>
      hint !== undefined &&
      isValidElement<{ id?: string; "aria-describedby"?: string }>(child) &&
      child.props.id === htmlFor
        ? cloneElement(child, {
            "aria-describedby": [
              child.props["aria-describedby"],
              `${htmlFor}-hint`,
            ]
              .filter(Boolean)
              .join(" "),
          })
        : child,
    )}
    {hint !== undefined && (
      <FieldDescription id={`${htmlFor}-hint`}>{hint}</FieldDescription>
    )}
  </UIField>
);
export const FormActions = ({
  note,
  children,
}: {
  note?: ReactNode;
  children: ReactNode;
}) => (
  <div className="mt-6 grid gap-3">
    <div className="flex flex-wrap items-center gap-3">{children}</div>
    {note !== undefined && (
      <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
    )}
  </div>
);
