import Link from "next/link";
import {
  IconArrowUpRight,
  IconChartBar,
  IconCheck,
  IconCircleCheck,
  IconComponents,
  IconCopy,
  IconLayoutGrid,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { Badge } from "@counted/ui/components/badge";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { Field, FieldLabel } from "@counted/ui/components/field";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@counted/ui/components/progress";
import { CodeBlock } from "./preview";
import { primitives } from "./catalog";

function SectionHeading({ title, number }: { title: string; number: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      <span className="section-number">{number}</span>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <>
      <div id="overview" className="page-heading">
        <div className="eyebrow">01 / The foundation</div>
        <h1>
          A shared language.
          <br />
          Room to build.
        </h1>
        <p>
          The foundations and components behind Counted. Considered defaults,
          useful interactions, and small parts that work beautifully together.
        </p>
      </div>
      <div className="system-hero">
        <div className="system-hero-type">
          <div className="flex items-center justify-between gap-4 font-mono text-xs opacity-75">
            <span>COUNTED UI</span>
            <span>PLAIN CHARTER</span>
          </div>
          <h2>
            Clear in purpose.
            <br />
            Precise in detail.
          </h2>
          <div className="flex items-center gap-3 text-xs opacity-85">
            <span className="size-1.5 rounded-full bg-current" />
            Warm paper · Blue ink
          </div>
        </div>
        <div className="system-hero-preview">
          <div className="flex items-center justify-between gap-4">
            <span className="font-heading text-lg">A small collection</span>
            <Badge variant="outline">Preview</Badge>
          </div>
          <Field>
            <FieldLabel htmlFor="hero-record">Record name</FieldLabel>
            <Input id="hero-record" defaultValue="acme-web" />
          </Field>
          <Progress value={72}>
            <ProgressLabel>Ready to explore</ProgressLabel>
            <ProgressValue />
          </Progress>
          <Button
            render={<Link href="/design/primitives" />}
            nativeButton={false}
          >
            Explore primitives
            <IconArrowUpRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
      <dl className="system-facts">
        <div>
          <dt>Components</dt>
          <dd>{primitives.length} shared primitives</dd>
        </div>
        <div>
          <dt>Body / heading</dt>
          <dd>System sans / Charter</dd>
        </div>
        <div>
          <dt>Behavior</dt>
          <dd>Base UI</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>Owned, composable React</dd>
        </div>
      </dl>

      <section id="color" className="foundation-section">
        <SectionHeading title="Color with a purpose" number="01" />
        <p className="section-description">
          Warm paper and near-black ink set the page. Heritage blue marks links,
          focus, and section starts; its deeper step fills primary actions.
        </p>
        <div className="swatch-grid">
          {[
            ["Background", "background"],
            ["Muted", "muted"],
            ["Border", "border"],
            ["Primary", "primary"],
            ["Foreground", "foreground"],
          ].map(([label, token]) => (
            <div className="swatch" key={token}>
              <div
                className="swatch-color"
                style={{ background: `var(--${token})` }}
              />
              <div className="swatch-label">
                {label}
                <code>--{token}</code>
              </div>
            </div>
          ))}
        </div>
        <div className="usage-note">
          <div>
            <h3>Surfaces</h3>
            <p>
              Background, card, and popover establish the canvas. Muted surfaces
              group supporting content.
            </p>
          </div>
          <div>
            <h3>Actions</h3>
            <p>
              Deep blue fills primary actions. Links use heritage blue. Hover
              lightens the blue, while outline and ghost actions stay quiet.
            </p>
          </div>
          <div>
            <h3>Feedback</h3>
            <p>
              Destructive signals an error or consequential action. Text and
              icons carry meaning alongside color.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Badge variant="success">
            <IconCheck data-icon="inline-start" />
            Active
          </Badge>
          <Badge variant="warning">Pending</Badge>
          <Badge variant="outline">Archived</Badge>
          <Badge variant="destructive">Failed</Badge>
        </div>
      </section>

      <section id="typography" className="foundation-section">
        <SectionHeading title="Two voices, one rhythm" number="02" />
        <p className="section-description">
          Charter gives headings their book-serif voice. The system sans-serif
          stack keeps controls familiar, with system monospace for code and
          precise values.
        </p>
        <div className="type-specimen">
          <div>
            <p className="demo-label">Charter / Heading</p>
            <div className="type-letter font-heading">Aa</div>
            <p className="font-heading text-xl">The details add up.</p>
            <p className="type-sample mt-6 text-muted-foreground">
              ABCDEFGHIJKLMNOPQRSTUVWXYZ
              <br />
              abcdefghijklmnopqrstuvwxyz · 0123456789
            </p>
          </div>
          <div>
            <p className="demo-label">System sans / Body</p>
            <div className="type-letter">Aa</div>
            <p className="max-w-64 text-sm leading-7">
              Good interfaces make room for the content. The type should make
              every word easy to find and read.
            </p>
            <p className="type-sample mt-6 font-mono text-muted-foreground">
              rec_acme_web · 12,840
            </p>
          </div>
        </div>
        <div className="mt-7 flex flex-col gap-5">
          {[
            ["Display", "44 / 48", "font-heading text-3xl"],
            ["Section", "28 / 34", "font-heading text-xl"],
            ["Body", "15 / 23", "text-sm"],
            ["Label", "13 / 18", "text-xs font-medium"],
          ].map(([name, size, style]) => (
            <div
              key={name}
              className="flex flex-wrap items-baseline justify-between gap-4 border-b pb-5"
            >
              <span className={style}>
                {name === "Display"
                  ? "Made to compose."
                  : name === "Section"
                    ? "A clear point of view."
                    : name === "Body"
                      ? "A useful sentence, given enough space to breathe."
                      : "Small details matter"}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {size}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section id="space" className="foundation-section">
        <SectionHeading title="Space is part of the system" number="03" />
        <p className="section-description">
          Six spacing steps express six relationships, from an icon beside its
          label to the start of a new region. Square edges and fine rules keep
          the structure clear.
        </p>
        <div className="token-table">
          <div className="token-panel">
            <p className="demo-label">Spacing / px</p>
            {[4, 8, 12, 20, 36, 56].map((n, i) => (
              <div className="space-row" key={n}>
                <span>{n}</span>
                <i style={{ width: n * 2 }} />
                <code>--s-{i + 1}</code>
              </div>
            ))}
          </div>
          <div className="token-panel">
            <p className="demo-label">Edges & surfaces</p>
            <div className="flex items-center gap-8 py-7">
              <div className="size-20 border bg-background" />
              <div className="size-20 border border-input bg-muted" />
            </div>
            <p className="text-sm leading-7 text-muted-foreground">
              Hairline rules divide regions. Stronger borders identify controls.
              Overlays use a border and backdrop, with square corners and no
              shadow.
            </p>
            <p className="mt-5 font-mono text-xs text-muted-foreground">
              Border / 1px · Control / 40px
            </p>
          </div>
        </div>
      </section>

      <section id="icons" className="foundation-section">
        <SectionHeading title="A consistent line" number="04" />
        <p className="section-description">
          Tabler icons bring a shared stroke and proportion. Pair them with
          clear labels; standalone icon controls always have an accessible name.
        </p>
        <div className="icon-grid">
          {[
            [IconSearch, "Search"],
            [IconLayoutGrid, "Layout"],
            [IconChartBar, "Chart"],
            [IconComponents, "Compose"],
            [IconSettings, "Settings"],
            [IconCopy, "Copy"],
            [IconCircleCheck, "Complete"],
            [IconX, "Close"],
          ].map(([Icon, label]) => {
            const Glyph = Icon as typeof IconSearch;
            return (
              <div className="icon-cell" key={String(label)}>
                <Glyph className="size-5" stroke={1.5} />
                <span>{String(label)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section id="interaction" className="foundation-section">
        <SectionHeading title="Made for interaction" number="05" />
        <p className="section-description">
          Keyboard navigation, focus management, and dismissal come from Base
          UI. Preview real controls, including disabled, empty, error, and
          selected states.
        </p>
        <div className="usage-note">
          <div>
            <h3>Visible focus</h3>
            <p>
              Press Tab to move through controls. Use arrow keys in menus, tabs,
              selects, and radio groups.
            </p>
          </div>
          <div>
            <h3>Considered overlays</h3>
            <p>
              Dialogs return focus when dismissed. Their content has room to
              fit, with no unnecessary internal scrolling.
            </p>
          </div>
          <div>
            <h3>Still by default</h3>
            <p>
              Controls and page content stay still. A brief entrance is reserved
              for overlays and disappears with reduced motion enabled.
            </p>
          </div>
        </div>
      </section>

      <section id="getting-started" className="foundation-section">
        <SectionHeading title="Start with the shared pieces" number="06" />
        <p className="section-description">
          Import the theme once, then compose primitives through explicit
          package paths. Aggregate examples show complete interactions using
          those same parts.
        </p>
        <CodeBlock
          code={
            'import "@counted/ui/styles.css";\nimport { Button } from "@counted/ui/components/button";\nimport { Field, FieldLabel } from "@counted/ui/components/field";\nimport { Input } from "@counted/ui/components/input";\n\n<Field>\n  <FieldLabel htmlFor="record-name">Record name</FieldLabel>\n  <Input id="record-name" placeholder="acme-web" />\n</Field>\n<Button>Save changes</Button>'
          }
        />
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            nativeButton={false}
            render={<Link href="/design/primitives" />}
          >
            Explore primitives
            <IconArrowUpRight data-icon="inline-end" />
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/design/aggregates" />}
          >
            See them together
            <IconArrowUpRight data-icon="inline-end" />
          </Button>
        </div>
      </section>
    </>
  );
}
