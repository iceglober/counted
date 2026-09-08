"use client";
import { useId, useState } from "react";
import { Badge } from "@counted/ui/components/badge";
import { Button } from "@counted/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@counted/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@counted/ui/components/field";
import { Input } from "@counted/ui/components/input";
import { Separator } from "@counted/ui/components/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@counted/ui/components/tabs";
import { toast } from "@counted/ui/components/toast";
export default function RecordTabsExample() {
  const id = useId();
  const [name, setName] = useState("acme-web");
  const [draft, setDraft] = useState(name);
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{name}</CardTitle>
          <Badge variant="success">Active</Badge>
        </div>
        <CardDescription>A record with three related views.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="min-h-52 pt-8">
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 text-xs leading-relaxed sm:gap-x-6 sm:gap-y-[18px] [&_dt]:text-muted-foreground [&_dd]:[overflow-wrap:anywhere] max-w-lg">
              <dt>Name</dt>
              <dd>{name}</dd>
              <dt>Environment</dt>
              <dd>Production</dd>
              <dt>Created</dt>
              <dd>September 4, 2026</dd>
              <dt>Status</dt>
              <dd>Accepting new readings</dd>
            </dl>
          </TabsContent>
          <TabsContent value="activity" className="min-h-52 pt-8">
            <div className="flex max-w-lg flex-col gap-5 text-xs">
              <div className="flex flex-wrap justify-between gap-3">
                <span>Record configuration updated</span>
                <time className="text-muted-foreground">Today · 09:42</time>
              </div>
              <Separator />
              <div className="flex flex-wrap justify-between gap-3">
                <span>First reading received</span>
                <time className="text-muted-foreground">Yesterday · 14:18</time>
              </div>
              <Separator />
              <div className="flex flex-wrap justify-between gap-3">
                <span>Record created</span>
                <time className="text-muted-foreground">Yesterday · 14:12</time>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="details" className="min-h-52 pt-8">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) {
                  setName(draft.trim());
                  toast.add({ title: "Record name updated", type: "success" });
                }
              }}
              className="flex max-w-sm flex-col gap-6"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={id}>Display name</FieldLabel>
                  <Input
                    id={id}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    required
                    maxLength={40}
                  />
                </Field>
              </FieldGroup>
              <Button type="submit" className="w-fit">
                Save name
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
