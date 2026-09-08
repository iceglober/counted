"use client";
import { useId, useState } from "react";
import { IconEye, IconEyeOff, IconSearch } from "@tabler/icons-react";
import { Field, FieldLabel } from "@counted/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@counted/ui/components/input-group";
export default function InputGroupExample({
  variant = "search",
}: {
  variant?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <Field className="w-full max-w-sm">
      <FieldLabel htmlFor={id}>
        {variant === "password"
          ? "Example key"
          : variant === "prefix"
            ? "Path"
            : variant === "suffix"
              ? "Retention"
              : "Search"}
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          type={variant === "password" && !visible ? "password" : "text"}
          placeholder="Find a record…"
          defaultValue={
            variant === "password"
              ? "demo_key_1234"
              : variant === "prefix"
                ? "acme-web"
                : variant === "suffix"
                  ? "30"
                  : ""
          }
        />
        {variant === "search" && (
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
        )}
        {variant === "prefix" && (
          <InputGroupAddon>
            <InputGroupText>counted.dev /</InputGroupText>
          </InputGroupAddon>
        )}
        {variant === "suffix" && (
          <InputGroupAddon align="inline-end">
            <InputGroupText>days</InputGroupText>
          </InputGroupAddon>
        )}
        {variant === "password" && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={visible ? "Hide example key" : "Show example key"}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <IconEyeOff /> : <IconEye />}
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </Field>
  );
}
