"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  initialValue,
  resolveSchema,
  variantIndex,
  variantLabel,
  type ApiDocument,
  type Json,
  type Schema,
} from "@counted/openapi/model";
import { Button } from "@counted/ui/components/button";
import { Checkbox } from "@counted/ui/components/checkbox";
import { Input } from "@counted/ui/components/input";
import { Textarea } from "@counted/ui/components/textarea";
import { Label } from "@counted/ui/components/label";
import { Badge } from "@counted/ui/components/badge";
import { SelectControl } from "../select-control";

export function JsonEditor({
  label,
  value,
  onChange,
  onInvalid,
}: {
  label: string;
  value: Json | undefined;
  onChange: (value: Json) => void;
  onInvalid: (error: string | undefined) => void;
}) {
  const id = useId();
  const [text, setText] = useState(JSON.stringify(value, null, 2) ?? "");
  const [error, setError] = useState<string>();
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={text}
        spellCheck={false}
        autoComplete="off"
        className="min-h-60 font-mono text-xs leading-6"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          try {
            const parsed: Json = JSON.parse(next);
            onChange(parsed);
            setError(undefined);
            onInvalid(undefined);
          } catch {
            const message = "Enter valid JSON before sending the request.";
            setError(message);
            onInvalid(message);
          }
        }}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Controls follow JSON Schema; omitted, null, false, and zero remain distinct. */
export function SchemaField({
  document,
  schema: source,
  value,
  onChange,
  label,
  required = true,
  depth = 0,
}: {
  document: ApiDocument;
  schema: Schema;
  value: Json | undefined;
  onChange: (value: Json | undefined) => void;
  label: string;
  required?: boolean;
  depth?: number;
}) {
  const id = useId();
  const schema = resolveSchema(document, source);
  const enabled = value !== undefined;
  const variants =
    schema.oneOf ??
    schema.anyOf ??
    (Array.isArray(schema.type)
      ? schema.type.map((type) => ({ ...schema, type }))
      : undefined);
  const object = schema.type === "object" || !!schema.properties;
  const array = schema.type === "array";
  const group = !!variants || object || array;
  const description = schema.description;
  let control;
  if (!enabled) control = null;
  else if (schema.const !== undefined)
    control = (
      <Badge variant="secondary" className="max-w-full break-all">
        {JSON.stringify(schema.const)}
      </Badge>
    );
  else if (
    depth > 10 ||
    (object && !Object.keys(schema.properties ?? {}).length) ||
    (!schema.type && !group && !schema.enum)
  ) {
    // Open-ended JSON is deliberately kept lossless, including arbitrary keys.
    control = <JsonLeaf id={id} value={value} onChange={onChange} />;
  } else if (schema.enum) {
    control = (
      <SelectControl
        id={id}
        value={String(
          schema.enum.findIndex(
            (item) => JSON.stringify(item) === JSON.stringify(value),
          ),
        )}
        items={schema.enum.map((item, index) => ({
          value: String(index),
          label: typeof item === "string" ? item : JSON.stringify(item),
        }))}
        onValueChange={(next) => onChange(schema.enum![Number(next)])}
      />
    );
  } else if (variants) {
    const selected = variantIndex(document, variants, value);
    control = (
      <div className="grid min-w-0 gap-4">
        <SelectControl
          id={id}
          aria-label={`${label} type`}
          value={String(selected)}
          items={variants.map((item, index) => ({
            value: String(index),
            label: variantLabel(document, item, index),
          }))}
          onValueChange={(next) =>
            onChange(initialValue(document, variants[Number(next)]!))
          }
        />
        <SchemaField
          key={selected}
          document={document}
          schema={variants[selected]!}
          value={value}
          onChange={onChange}
          label={variantLabel(document, variants[selected]!, selected)}
          depth={depth + 1}
        />
      </div>
    );
  } else if (object) {
    const fields =
      value && typeof value === "object" && !Array.isArray(value) ? value : {};
    control = (
      <div className="grid min-w-0 gap-5 border-l-2 border-border/60 pl-4 sm:pl-5">
        {Object.entries(schema.properties ?? {}).map(([name, field]) => (
          <SchemaField
            key={name}
            document={document}
            schema={field}
            value={fields[name]}
            label={name}
            required={schema.required?.includes(name) ?? false}
            depth={depth + 1}
            onChange={(next) => {
              const updated = { ...fields };
              if (next === undefined) delete updated[name];
              else updated[name] = next;
              onChange(updated);
            }}
          />
        ))}
      </div>
    );
  } else if (array) {
    const items = Array.isArray(value) ? value : [];
    control = (
      <div className="grid min-w-0 gap-3">
        {items.map((item, index) => (
          <div
            key={index}
            className="min-w-0 space-y-3 border bg-muted/20 p-3 sm:p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Item {index + 1}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={items.length <= (schema.minItems ?? 0)}
                aria-label={`Remove ${label} item ${index + 1}`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
            <SchemaField
              document={document}
              schema={schema.items ?? {}}
              value={item}
              label={`${label} ${index + 1}`}
              depth={depth + 1}
              onChange={(next) =>
                onChange(
                  items.map((entry, i) =>
                    i === index ? (next ?? null) : entry,
                  ),
                )
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={
            schema.maxItems !== undefined && items.length >= schema.maxItems
          }
          onClick={() =>
            onChange([...items, initialValue(document, schema.items ?? {})])
          }
        >
          Add item
        </Button>
        {schema.maxItems !== undefined && (
          <p className="text-xs text-muted-foreground">
            Up to {schema.maxItems} items.
          </p>
        )}
      </div>
    );
  } else if (schema.type === "boolean") {
    control = (
      <SelectControl
        id={id}
        value={String(value)}
        items={[
          { value: "true", label: "True" },
          { value: "false", label: "False" },
        ]}
        onValueChange={(next) => onChange(next === "true")}
      />
    );
  } else if (schema.type === "null")
    control = <Badge variant="secondary">null</Badge>;
  else
    control = (
      <Input
        id={id}
        type="text"
        inputMode={
          schema.type === "number" || schema.type === "integer"
            ? "decimal"
            : undefined
        }
        autoComplete="off"
        spellCheck={false}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
        aria-describedby={description ? `${id}-description` : undefined}
        onChange={(event) => {
          const text = event.target.value;
          if (schema.type === "number" || schema.type === "integer")
            onChange(
              text.trim() !== "" && Number.isFinite(Number(text))
                ? Number(text)
                : text,
            );
          else onChange(text);
        }}
      />
    );
  return (
    <div
      className="grid min-w-0 gap-2"
      role={group ? "group" : undefined}
      aria-labelledby={group ? `${id}-label` : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {required ? (
          <Label
            id={`${id}-label`}
            htmlFor={group ? undefined : id}
            className="break-all"
          >
            {label}
          </Label>
        ) : (
          <Label
            id={`${id}-label`}
            className="flex min-w-0 items-center gap-2 break-all"
          >
            <Checkbox
              checked={enabled}
              onCheckedChange={(checked) =>
                onChange(checked ? initialValue(document, schema) : undefined)
              }
            />
            {label}
          </Label>
        )}
        {!required && (
          <span className="text-xs text-muted-foreground">optional</span>
        )}
      </div>
      {description && (
        <p
          id={`${id}-description`}
          className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
        >
          {description}
        </p>
      )}
      {control}
    </div>
  );
}

function JsonLeaf({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Json | undefined;
  onChange: (value: Json) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2) ?? "{}");
  const lastValue = useRef(value);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Reused array rows can receive another value after an item is removed.
    if (value !== lastValue.current) {
      lastValue.current = value;
      setText(JSON.stringify(value, null, 2) ?? "{}");
      input.current?.setCustomValidity("");
    }
  }, [value]);
  // Keep an incomplete draft visible while native form validity blocks sending.
  return (
    <Textarea
      id={id}
      ref={input}
      className="min-h-28 font-mono text-xs"
      spellCheck={false}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        try {
          const parsed: Json = JSON.parse(next);
          lastValue.current = parsed;
          onChange(parsed);
          event.target.setCustomValidity("");
        } catch {
          event.target.setCustomValidity("Enter valid JSON.");
        }
      }}
    />
  );
}
