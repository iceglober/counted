import Link from "next/link";
import { aggregates } from "../catalog";
import { Preview } from "../preview";
import { exampleSource } from "../source";
import MasterDetail from "./examples/master-detail";
import DataWorkspace from "./examples/data-workspace";
import SettingsForm from "./examples/settings-form";
import CollectionTable from "./examples/collection-table";
import RecordTabs from "./examples/record-tabs";
import ReviewFlow from "./examples/review-flow";
import SidebarShell from "./examples/sidebar-shell";
import TopNavigationShell from "./examples/top-navigation-shell";
import EditorShell from "./examples/editor-shell";
import { LayoutPreview } from "./layout-preview";

export const metadata = { title: "Primitive aggregates" };
const examples = {
  "sidebar-shell": SidebarShell,
  "top-navigation-shell": TopNavigationShell,
  "editor-shell": EditorShell,
  "master-detail": MasterDetail,
  "data-workspace": DataWorkspace,
  "settings-form": SettingsForm,
  "collection-table": CollectionTable,
  "record-tabs": RecordTabs,
  "review-flow": ReviewFlow,
};

export default async function AggregatesPage() {
  const sources = await Promise.all(
    aggregates.map((item) => exampleSource(item.id, true)),
  );
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">03 / Better together</div>
        <h1>
          Small parts.
          <br />
          Complete experiences.
        </h1>
        <p>
          Application frames and working compositions, built from the same
          primitives. Start with the shape of an app, then explore its smaller
          interactions. Every example adapts to the space it has.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 border-y py-6 sm:grid-cols-2">
        {aggregates.map((item, i) => (
          <a
            key={item.id}
            href={`#agg-${item.id}-page`}
            className="flex items-center gap-3 text-xs hover:text-primary-ink"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
            {item.title}
            <span className="ml-auto text-muted-foreground">↗</span>
          </a>
        ))}
      </div>
      {aggregates.map((item, index) => {
        const Example = examples[item.id];
        const ExamplePreview = "layout" in item ? LayoutPreview : Preview;
        return (
          <section
            id={`agg-${item.id}-page`}
            key={item.id}
            className="aggregate-section"
          >
            <div className="section-heading">
              <h2>{item.title}</h2>
              <span className="section-number">
                {String(index + 1).padStart(2, "0")} /{" "}
                {String(aggregates.length).padStart(2, "0")}
              </span>
            </div>
            <p className="section-description">{item.description}</p>
            <div
              className="aggregate-components"
              aria-label="Primitives in this composition"
            >
              {item.components.map((id) => (
                <Link key={id} href={`/design/primitives/${id}`}>
                  {id}
                </Link>
              ))}
            </div>
            <ExamplePreview label={item.title} code={sources[index]!} roomy>
              <Example />
            </ExamplePreview>
          </section>
        );
      })}
    </>
  );
}
