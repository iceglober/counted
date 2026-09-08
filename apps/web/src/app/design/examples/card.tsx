"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@counted/ui/components/card";
import { Button } from "@counted/ui/components/button";
import { Badge } from "@counted/ui/components/badge";
import { toast } from "@counted/ui/components/toast";
export default function CardExample({
  variant = "default",
}: {
  variant?: string;
}) {
  return (
    <Card
      className="w-full max-w-sm"
      size={variant === "small" ? "sm" : "default"}
    >
      <CardHeader>
        <CardTitle>Collection overview</CardTitle>
        <CardDescription>
          A little context, contained in one place.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-4">
          <span className="font-heading text-2xl tabular-nums">128</span>
          <Badge variant="secondary">12 added</Badge>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Records in this example collection
        </p>
      </CardContent>
      {variant === "with-footer" && (
        <CardFooter>
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              toast.add({
                title: "Overview opened",
                description: "A local preview action.",
              })
            }
          >
            View collection
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
