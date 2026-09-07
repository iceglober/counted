"use client";
import { Button } from "@counted/ui/components/button";
import { toast } from "@counted/ui/components/toast";
export default function ToastExample({
  variant = "success",
}: {
  variant?: string;
}) {
  const messages: Record<string, [string, string]> = {
    success: ["Changes saved", "Your record is up to date."],
    error: ["Could not save", "Try again in a moment."],
    info: ["A new reading is available", "Refresh the view to see it."],
    warning: ["Review your selection", "Some records are archived."],
    loading: [
      "Preparing your records",
      "This preview shows the loading state.",
    ],
    "with-action": ["Record archived", "You can restore it from the archive."],
  };
  return (
    <Button
      variant="outline"
      onClick={() =>
        toast.add({
          title: messages[variant]![0],
          description: messages[variant]![1],
          type: variant === "with-action" ? undefined : variant,
          actionProps:
            variant === "with-action"
              ? {
                  children: "Undo",
                  onClick: () =>
                    toast.add({ title: "Record restored", type: "success" }),
                }
              : undefined,
        })
      }
    >
      Show{" "}
      {variant === "with-action" ? "toast with action" : variant + " toast"}
    </Button>
  );
}
