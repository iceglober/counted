import Link from "next/link";
import { Button } from "@counted/ui/components/button";
export const ActionLink = ({
  href,
  children,
  variant = "default",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "outline";
}) => (
  <Button nativeButton={false} render={<Link href={href} />} variant={variant}>
    {children}
  </Button>
);
