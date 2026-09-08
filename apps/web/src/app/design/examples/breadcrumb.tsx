"use client";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@counted/ui/components/breadcrumb";
export default function BreadcrumbExample({
  variant = "default",
}: {
  variant?: string;
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/design">Design system</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          {variant === "custom-separator" ? "/" : undefined}
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbLink href="/design/primitives">Primitives</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>
          {variant === "custom-separator" ? "/" : undefined}
        </BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>Breadcrumb</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
