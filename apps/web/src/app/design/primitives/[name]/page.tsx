import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconArrowUpRight } from "@tabler/icons-react";
import { primitives } from "../../catalog";
import { exampleMap } from "../../example-map";
import { CodeBlock } from "../../preview";
import { VariantPreview } from "../../variant-preview";
import { exampleVariants, variantLabel } from "../../variants";
import { exampleSource } from "../../source";

export const dynamicParams = false;
export function generateStaticParams() {
  return primitives.map(({ id }) => ({ name: id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return {
    title: primitives.find((item) => item.id === name)?.title ?? "Primitive",
  };
}

export default async function PrimitivePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const item = primitives.find((p) => p.id === name);
  if (!item) notFound();
  const Example = exampleMap[item.id];
  const code = await exampleSource(item.id);
  const index = primitives.indexOf(item);
  const next = primitives[(index + 1) % primitives.length]!;
  return (
    <>
      <Link
        href="/design/primitives"
        className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-3.5" />
        All primitives
      </Link>
      <div className="page-heading">
        <div className="eyebrow">Primitives / {item.group}</div>
        <h1>{item.title}</h1>
        <p>{item.description}</p>
      </div>
      <VariantPreview
        label={item.title}
        code={code}
        variants={exampleVariants[item.id].map((value) => ({
          value,
          label: variantLabel(value, item.id),
          example: <Example variant={value} />,
        }))}
      />
      <div className="mt-6 flex flex-wrap justify-between gap-4 text-xs text-muted-foreground">
        <span>Interact with the preview. Tab through its controls.</span>
        <a
          className="inline-flex items-center gap-1 hover:text-foreground"
          href={`https://ui.shadcn.com/docs/components/base/${item.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Documentation
          <IconArrowUpRight className="size-3.5" />
        </a>
      </div>
      <section className="foundation-section">
        <div className="section-heading">
          <h2>Use in your interface</h2>
          <span className="section-number">@counted/ui</span>
        </div>
        <CodeBlock
          code={`import { ${
            item.id === "radio-group"
              ? "RadioGroup, RadioGroupItem"
              : item.id === "kbd"
                ? "Kbd"
                : item.id === "toast"
                  ? "toast"
                  : item.id === "chart"
                    ? "ChartContainer"
                    : item.id
                        .split("-")
                        .map((s) => s[0]!.toUpperCase() + s.slice(1))
                        .join("")
          } } from "@counted/ui/components/${item.id}";`}
        />
        <div className="usage-note">
          <div>
            <h3>Compose the parts</h3>
            <p>
              Use the component’s named parts together. The Code tab contains
              the complete example and its imports.
            </p>
          </div>
          <div>
            <h3>Keep the shared defaults</h3>
            <p>
              Choose built-in variants and sizes. Use layout utilities for
              placement, width, and spacing.
            </p>
          </div>
          <div>
            <h3>Check every state</h3>
            <p>
              Keep visible labels, clear focus, and descriptive feedback. Try
              each variant using the preview control.
            </p>
          </div>
        </div>
      </section>
      <Link
        href={`/design/primitives/${next.id}`}
        className="mt-14 flex items-center justify-between border-t pt-6 text-sm"
      >
        <span className="text-muted-foreground">Next primitive</span>
        <span>{next.title} ↗</span>
      </Link>
    </>
  );
}
