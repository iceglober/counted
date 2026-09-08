"use client";
import { IconCircleCheck, IconAlertCircle } from "@tabler/icons-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@counted/ui/components/alert";
export default function AlertExample({
  variant = "default",
}: {
  variant?: string;
}) {
  const failed = variant === "destructive";
  return (
    <Alert
      className="w-full max-w-sm"
      variant={failed ? "destructive" : "default"}
    >
      {variant !== "without-icon" &&
        (failed ? <IconAlertCircle /> : <IconCircleCheck />)}
      <AlertTitle>
        {failed ? "Unable to load this reading" : "Everything is up to date"}
      </AlertTitle>
      <AlertDescription>
        {failed
          ? "Try again in a moment. Existing records are still available."
          : "The latest changes are reflected in this view."}
      </AlertDescription>
    </Alert>
  );
}
