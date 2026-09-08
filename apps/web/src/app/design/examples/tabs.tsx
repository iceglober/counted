"use client";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@counted/ui/components/tabs";
export default function TabsExample({
  variant = "default",
}: {
  variant?: string;
}) {
  return (
    <Tabs
      defaultValue="overview"
      orientation={variant === "vertical" ? "vertical" : "horizontal"}
      className="w-full max-w-md"
    >
      <TabsList
        variant={variant === "line" ? "line" : "default"}
        aria-label="Record views"
      >
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="details" disabled={variant === "disabled-tab"}>
          Details
        </TabsTrigger>
      </TabsList>
      {[
        [
          "overview",
          "Everything in one place.",
          "A concise summary of the selected record.",
        ],
        [
          "activity",
          "The latest changes.",
          "This record was updated September 4, 2026.",
        ],
        [
          "details",
          "The finer details.",
          "Created in Production. Status: active.",
        ],
      ].map(([value, title, description]) => (
        <TabsContent key={value} value={value!} className="min-w-0 p-4">
          <p className="font-medium">{title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </TabsContent>
      ))}
    </Tabs>
  );
}
