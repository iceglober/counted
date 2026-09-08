"use client";
import { useId } from "react";
import { Button } from "@counted/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@counted/ui/components/popover";
import { Field, FieldGroup, FieldLabel } from "@counted/ui/components/field";
import { Switch } from "@counted/ui/components/switch";
export default function PopoverExample({
  variant = "bottom",
}: {
  variant?: string;
}) {
  const id = useId();
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        View options
      </PopoverTrigger>
      <PopoverContent side={variant as "top" | "bottom" | "left" | "right"}>
        <PopoverHeader>
          <PopoverTitle>Visible columns</PopoverTitle>
          <PopoverDescription>
            Choose what appears in the collection.
          </PopoverDescription>
        </PopoverHeader>
        <FieldGroup className="gap-5">
          <Field orientation="horizontal">
            <FieldLabel htmlFor={id}>Environment</FieldLabel>
            <Switch id={id} defaultChecked />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor={id + "-2"}>Created date</FieldLabel>
            <Switch id={id + "-2"} />
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
