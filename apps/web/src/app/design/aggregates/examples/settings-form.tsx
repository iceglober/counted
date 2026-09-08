"use client";
import { useId, useState } from "react";
import { IconCircleCheck } from "@tabler/icons-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@counted/ui/components/alert";
import { Button } from "@counted/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@counted/ui/components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@counted/ui/components/field";
import { Input } from "@counted/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";
import { Separator } from "@counted/ui/components/separator";
import { Switch } from "@counted/ui/components/switch";
import { Textarea } from "@counted/ui/components/textarea";
const environments = [
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
];
export default function SettingsFormExample() {
  const id = useId();
  const [name, setName] = useState("acme-web");
  const [environment, setEnvironment] = useState("production");
  const [description, setDescription] = useState("The main application.");
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  function reset() {
    setName("acme-web");
    setEnvironment("production");
    setDescription("The main application.");
    setVisible(true);
    setError(false);
    setSaved(false);
  }
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Record settings</CardTitle>
        <CardDescription>
          Give this record a name and a place in the collection.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onChange={() => setSaved(false)}
          onSubmit={(e) => {
            e.preventDefault();
            const invalid = !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
            setError(invalid);
            if (invalid)
              e.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
            setSaved(!invalid);
          }}
          className="flex flex-col gap-8"
        >
          <FieldGroup>
            <Field data-invalid={error}>
              <FieldLabel htmlFor={id}>Record name</FieldLabel>
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={error}
                aria-describedby={id + "-help"}
              />
              {error ? (
                <FieldError id={id + "-help"}>
                  Use lowercase letters, numbers, and single hyphens.
                </FieldError>
              ) : (
                <FieldDescription id={id + "-help"}>
                  A short, memorable name for this record.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor={id + "-env"}>Environment</FieldLabel>
              <Select
                items={environments}
                value={environment}
                onValueChange={(v) => {
                  if (v) setEnvironment(v);
                  setSaved(false);
                }}
              >
                <SelectTrigger className="w-full" id={id + "-env"}>
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
            <Field>
              <FieldLabel htmlFor={id + "-description"}>Description</FieldLabel>
              <Textarea
                id={id + "-description"}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={id + "-visible"}>
                  Show in overview
                </FieldLabel>
                <FieldDescription>
                  Include this record in the default collection.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={id + "-visible"}
                checked={visible}
                onCheckedChange={(v) => {
                  setVisible(v);
                  setSaved(false);
                }}
              />
            </Field>
          </FieldGroup>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" type="button" onClick={reset}>
              Reset
            </Button>
            <Button type="submit">Save changes</Button>
          </div>
          {saved && (
            <Alert>
              <IconCircleCheck />
              <AlertTitle>Changes saved</AlertTitle>
              <AlertDescription>
                {name} is ready. These changes stay in the example.
              </AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
