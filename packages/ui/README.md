# @counted/ui

Counted's shared component library. The source is owned here, generated with
shadcn/ui, and composed over Base UI. Product-domain components do not belong in
this package. Complete composition examples live in the web showcase.

## Foundation

Counted's **Plain Charter** theme adapts the generated
[Sera preset](https://ui.shadcn.com/create?preset=b7qmDPHCIC).

| Choice               | Value                                           |
| -------------------- | ----------------------------------------------- |
| Component foundation | shadcn Sera / Base UI                           |
| Surfaces / ink       | Warm paper / near-black                         |
| Accent               | Heritage blue links, deep blue action fills     |
| Body / heading       | System sans / Charter with book-serif fallbacks |
| Code                 | System monospace                                |
| Icons                | Tabler                                          |
| Appearance           | Light, square edges, no shadows                 |

`src/styles/globals.css` owns Counted's semantic tokens and Tailwind v4 mapping.
`primary` is the deep action fill; `primary-ink` is heritage blue for links and
fine indicators. The shadcn `accent` token is a highlighted surface, so it uses
the pale blue tint. `input` is the stronger control border, while `border` is a
decorative separator. Success, warning, and destructive pairs carry status.

Typography uses the established local Charter/system stacks, with no Google font
requests. Labels and actions use sentence case. Controls stay still; transient
dialogs and popovers have a 120ms entrance, disabled under reduced motion. Focus
uses a 2px outline with a 2px offset so it remains distinct beside filled controls.

The preset is scaffolding, not the final theme. Do not overwrite the owned tokens
or component refinements when updating from the registry.

## Use

Import the stylesheet once at the application entry. Tailwind must scan the UI
workspace for generated class names:

```css
@import "@counted/ui/styles.css";
@source "../../../../packages/ui/src";
```

Use explicit component exports:

```tsx
import { Button } from "@counted/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@counted/ui/components/field";
import { Input } from "@counted/ui/components/input";

<FieldGroup>
  <Field>
    <FieldLabel htmlFor="record-name">Record name</FieldLabel>
    <Input id="record-name" />
  </Field>
</FieldGroup>
<Button>Save changes</Button>
```

Wrap the app in `TooltipProvider` when using tooltips, `Toaster` when using the
shared toast manager. The current theme is light-only. Components must not write
cookies or collect identity.

Base UI uses `render` for trigger composition:

```tsx
<DialogTrigger render={<Button variant="outline" />}>Edit</DialogTrigger>
```

Use complete component anatomy, connected labels and descriptions, and built-in
variants. Keep per-instance classes focused on layout. Add shared visual changes
in the owned component source or theme instead of overriding every usage.

## Add and update components

The app and UI package have matching `components.json` files. Package imports
(`#components/*`, `#lib/*`) resolve inside the UI package. Workspace exports
resolve the app's imports. Run the CLI from `apps/web`; it routes shared files
into `packages/ui`:

```sh
bunx --bun shadcn@latest info --json
bunx --bun shadcn@latest docs button --json
bunx --bun shadcn@latest add button --dry-run
bunx --bun shadcn@latest add button --diff
```

Review updates before applying them. Local refinements include dialog viewport
positioning (the popup itself does not scroll), close-button clearance, long-text
containment, chart sizing, explicit combobox action names, and reduced motion.
Preserve these and Counted's typography, strong field borders, flat surfaces,
status tints, and offset focus outlines when updating upstream components.

For a new primitive, add its working example and catalog entry under
`apps/web/src/app/design`. The catalog test requires coverage for every shipped
component. Register its variations in `design/variants.ts` and accept the selected
`variant` in the standalone example. The shared preview control mounts one variation
at a time and resets local example state when the selection changes. The catalog
suite renders every registered variation. The Code tab reads the actual example
source, so snippets stay aligned with the preview.

Select supports multiple values with `<Select multiple>`. Combobox supports searchable
multiple selection with `<Combobox multiple>`, `ComboboxChips`, `ComboboxValue`,
`ComboboxChip`, and `ComboboxChipsInput`. Use `useComboboxAnchor` to align its popup
to the full chip field. Give each removal action a meaningful `removeLabel`.
Both examples are available through the Multi-select option in their preview.

## Showcase and validation

- `/design`: color, type, space, shape, icons, interaction, and usage.
- `/design/primitives`: catalog with a page for each primitive.
- `/design/aggregates`: nine domain-independent examples, including three app layouts.

```sh
bun run typecheck
bun test apps/web/src/app/design apps/web/src/lib/css-entry.test.ts
bun run --cwd apps/web build
```

Application layouts use container queries, so their navigation and panes adapt to
available content width rather than assuming the browser width. Their preview
width control can constrain the example to a phone or tablet width; it never
expands beyond the available space. Layouts grow with content instead of clipping
it or forcing fixed-height scrolling. Navigation sheets retain Base UI focus and
keyboard behavior. The complete standalone source lives with each aggregate.

Chart sizing belongs to `ResponsiveContainer`. Keep a definite height on the
chart, and do not add `max-width: 100%` to Recharts' inner wrappers or SVG: its
measurement wrapper is intentionally zero-width, which would collapse the plot.
Verify the visible SVG dimensions and marks, not only the outer container.

The console and showcase both use this component system. The console's
`app.css` provides document rhythm only; app compositions live in
`apps/web/src/components` and contain the product's forms and contract data.
A source guard prevents native visual controls or a second theme from returning.
The library supplies Counted's theme through standard shadcn semantic tokens and
is portable to other apps.

Guidance: [monorepos](https://ui.shadcn.com/docs/monorepo),
[package imports](https://ui.shadcn.com/docs/package-imports),
[theming](https://ui.shadcn.com/docs/theming), and
[CLI](https://ui.shadcn.com/docs/cli).
