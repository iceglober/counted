import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

// Living gallery of the component library. Dev-only — 404s in production so it
// isn't shipped publicly. Flip this guard if you want it as a real /ui design
// system page. Grows one section per component as the library is built out.
export default function UiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
