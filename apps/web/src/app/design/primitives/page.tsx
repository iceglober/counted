import Link from "next/link";
import { IconArrowUpRight } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { Badge } from "@counted/ui/components/badge";
import { Input } from "@counted/ui/components/input";
import { Field, FieldLabel } from "@counted/ui/components/field";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@counted/ui/components/tabs";
import { Checkbox } from "@counted/ui/components/checkbox";
import DialogExample from "../examples/dialog";
import { primitiveGroups, primitives } from "../catalog";

export const metadata = { title: "Primitives" };

export default function PrimitivesPage() {
  const featured = [
    {
      id: "button",
      content: (
        <div className="demo-row">
          <Button>Primary</Button>
        </div>
      ),
    },
    {
      id: "input",
      content: (
        <Field className="max-w-64">
          <FieldLabel htmlFor="catalog-name">Record name</FieldLabel>
          <Input id="catalog-name" defaultValue="acme-web" />
        </Field>
      ),
    },
    {
      id: "tabs",
      content: (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-3 text-muted-foreground">
            A summary of the collection.
          </TabsContent>
          <TabsContent value="activity" className="pt-3 text-muted-foreground">
            The latest changes.
          </TabsContent>
        </Tabs>
      ),
    },
    {
      id: "badge",
      content: (
        <div className="demo-row">
          <Badge variant="success">Active</Badge>
        </div>
      ),
    },
    {
      id: "checkbox",
      content: (
        <div className="flex flex-col gap-5">
          <Field orientation="horizontal">
            <Checkbox id="catalog-checked" defaultChecked />
            <FieldLabel htmlFor="catalog-checked">
              Include active records
            </FieldLabel>
          </Field>
        </div>
      ),
    },
    { id: "dialog", content: <DialogExample /> },
  ];
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">02 / The building blocks</div>
        <h1>Primitives.</h1>
        <p>
          {primitives.length} components. One shared language. Explore their
          anatomy, choose a variant, and try one example at a time.
        </p>
      </div>
      <div className="catalog-grid">
        {featured.map(({ id, content }) => {
          const item = primitives.find((p) => p.id === id)!;
          return (
            <article className="catalog-card" key={id}>
              <div className="catalog-card-preview">{content}</div>
              <Link
                href={`/design/primitives/${id}`}
                className="catalog-card-label"
              >
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
                <IconArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </article>
          );
        })}
      </div>
      <section className="foundation-section">
        <div className="section-heading">
          <h2>The complete collection</h2>
          <span className="section-number">{primitives.length} PRIMITIVES</span>
        </div>
        <div className="primitive-directory">
          {primitiveGroups.map((group) => (
            <div className="directory-group" key={group.name}>
              <h3 className="catalog-section-label">{group.name}</h3>
              {group.items.map(([id, title]) => (
                <Link key={id} href={`/design/primitives/${id}`}>
                  {title}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
