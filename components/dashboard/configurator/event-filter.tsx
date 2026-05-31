"use client";

import { Dropdown } from "@/components/dropdown";

type EventInfo = { name: string; count: number };

type Props = {
  value: string;
  events: EventInfo[];
  onChange: (value: string) => void;
};

export function EventFilter({ value, events, onChange }: Props) {
  return (
    <Dropdown
      value={value}
      options={[
        { value: "", label: "All events" },
        ...events.map((e) => ({
          value: e.name,
          label: e.name,
          detail: String(e.count),
        })),
      ]}
      onChange={onChange}
    />
  );
}
