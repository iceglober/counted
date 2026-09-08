"use client";

import { useId, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { Badge } from "@counted/ui/components/badge";
import { Field, FieldGroup, FieldLabel } from "@counted/ui/components/field";
import { Input } from "@counted/ui/components/input";
import { Textarea } from "@counted/ui/components/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@counted/ui/components/sheet";

const initialSections = [
  {
    id: "introduction",
    title: "A place to begin",
    body: "Good work starts with a little clarity. Keep the essentials close and give each idea room to develop.",
  },
  {
    id: "organization",
    title: "Make room for the work",
    body: "Group related material into collections. Use short, familiar names so the next step is easy to find.",
  },
  {
    id: "review",
    title: "Leave things ready",
    body: "Review what changed, add the context someone else will need, and save your progress.",
  },
];
type Section = (typeof initialSections)[number];

function SectionProperties({
  section,
  onChange,
}: {
  section: Section;
  onChange: (patch: Partial<Section>) => void;
}) {
  const id = useId();
  return (
    <FieldGroup className="gap-5">
      <Field>
        <FieldLabel htmlFor={`${id}-title`}>Section title</FieldLabel>
        <Input
          id={`${id}-title`}
          value={section.title}
          maxLength={80}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-body`}>Body</FieldLabel>
        <Textarea
          id={`${id}-body`}
          className="min-h-40"
          value={section.body}
          maxLength={800}
          onChange={(e) => onChange({ body: e.target.value })}
        />
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Edits appear in the document as you type.
      </p>
    </FieldGroup>
  );
}

export default function EditorShellExample() {
  const [sections, setSections] = useState(initialSections);
  const [selected, setSelected] = useState("introduction");
  const [inspector, setInspector] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const section = sections.find((item) => item.id === selected)!;
  function edit(patch: Partial<Section>) {
    setSections((current) =>
      current.map((item) =>
        item.id === selected ? { ...item, ...patch } : item,
      ),
    );
    setDirty(true);
    setSaved(false);
  }
  return (
    <div
      className="@container/editor w-full border bg-background text-sm"
      data-layout="editor-shell"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">
            Documents / Guide
          </p>
          <h3 className="font-heading text-lg">Getting started</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            aria-label={inspector ? "Hide properties" : "Show properties"}
            aria-expanded={inspector}
            className="hidden @min-[760px]/editor:inline-flex"
            onClick={() => setInspector((current) => !current)}
          >
            <IconAdjustmentsHorizontal />
          </Button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="@min-[760px]/editor:hidden"
                />
              }
              aria-label="Open section properties"
            >
              <IconAdjustmentsHorizontal />
            </SheetTrigger>
            <SheetContent className="w-full max-w-sm data-[side=right]:w-full">
              <SheetHeader className="px-6 pr-14">
                <SheetTitle>Section properties</SheetTitle>
                <SheetDescription>Edit the selected section.</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 overflow-y-auto px-6 pb-6">
                <SectionProperties section={section} onChange={edit} />
              </div>
            </SheetContent>
          </Sheet>
          <Button
            className="h-11"
            disabled={!dirty}
            onClick={() => {
              setDirty(false);
              setSaved(true);
            }}
          >
            Save
          </Button>
        </div>
      </header>
      <div
        className={`grid min-h-[480px] grid-cols-1 ${inspector ? "@min-[760px]/editor:grid-cols-[minmax(0,1fr)_240px]" : ""}`}
      >
        <section
          aria-label="Document canvas"
          className="min-w-0 bg-muted/40 p-4 @min-[480px]/editor:p-7"
        >
          <div className="mx-auto max-w-2xl border bg-background p-3 @min-[480px]/editor:p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 px-3 pt-2">
              <Badge variant="outline">Draft</Badge>
              <span className="text-xs text-muted-foreground">3 sections</span>
            </div>
            <div className="grid gap-3">
              {sections.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  aria-label={`Select section: ${item.title || "Untitled"}`}
                  aria-pressed={item.id === selected}
                  onClick={() => setSelected(item.id)}
                  className="h-auto w-full flex-col items-start gap-3 border border-transparent px-3 py-4 text-left font-normal whitespace-normal aria-pressed:border-primary-ink aria-pressed:bg-accent/40"
                >
                  <span className="max-w-full font-heading text-lg break-words">
                    {item.title || "Untitled section"}
                  </span>
                  <span className="max-w-full text-sm leading-relaxed break-words text-muted-foreground">
                    {item.body || "Add content in section properties."}
                  </span>
                </Button>
              ))}
            </div>
            <p className="mt-5 px-3 pb-2 text-xs leading-relaxed text-muted-foreground">
              Select a section, then open its properties to edit.
            </p>
          </div>
        </section>
        {inspector && (
          <aside
            aria-label="Section properties"
            className="hidden min-w-0 border-l @min-[760px]/editor:block"
          >
            <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
              <h4 className="font-medium">Properties</h4>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label="Close properties panel"
                onClick={() => setInspector(false)}
              >
                <IconX />
              </Button>
            </div>
            <div className="p-5">
              <SectionProperties section={section} onChange={edit} />
            </div>
          </aside>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
        <span role="status">
          {dirty
            ? "Unsaved changes"
            : saved
              ? "Document saved"
              : "All changes saved"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty && !saved}
          onClick={() => {
            setSections(initialSections);
            setDirty(false);
            setSaved(false);
          }}
        >
          <IconArrowLeft />
          Reset example
        </Button>
      </footer>
    </div>
  );
}
