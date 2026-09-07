"use client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@counted/ui/components/accordion";
export default function AccordionExample({
  variant = "single",
}: {
  variant?: string;
}) {
  return (
    <Accordion
      className="w-full max-w-lg"
      defaultValue={["composition"]}
      multiple={variant === "multiple"}
      disabled={variant === "disabled"}
    >
      <AccordionItem value="composition">
        <AccordionTrigger>
          How do these components fit together?
        </AccordionTrigger>
        <AccordionContent>
          Each primitive has one clear job. Compose them to build a form, a
          detail panel, or a complete workspace.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="theme">
        <AccordionTrigger>How does Counted apply its theme?</AccordionTrigger>
        <AccordionContent>
          Every surface and control uses Counted’s warm paper, ink, and blue
          palette through shared semantic theme tokens.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="ownership">
        <AccordionTrigger>Where does the source live?</AccordionTrigger>
        <AccordionContent>
          In the shared @counted/ui package, ready to inspect and adapt.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
