"use client";

import { useState } from "react";
import { dashboardSections, type Section, type Widget, type MetricData, type TimeSeriesData, type BreakdownItem } from "@/lib/mock-data";
import { MetricCard } from "./metric-card";
import { AreaChart } from "./area-chart";
import { Breakdown } from "./breakdown";
import { Editor } from "./editor";
import { ChevronDown, ChevronRight, Pencil, Clock } from "@/components/icons";

function WidgetRenderer({ widget }: { widget: Widget }) {
  switch (widget.type) {
    case "metric":
      return <MetricCard title={widget.title} data={widget.data as MetricData} />;
    case "timeseries":
      return <AreaChart title={widget.title} data={widget.data as TimeSeriesData} />;
    case "breakdown":
      return <Breakdown title={widget.title} items={(widget.data as { items: BreakdownItem[] }).items} />;
  }
}

function DashboardSection({ section }: { section: Section }) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 mb-4 group"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
        )}
        <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider group-hover:text-text-primary transition-colors">
          {section.title}
        </h2>
      </button>
      {open && (
        <div className="grid grid-cols-4 gap-4">
          {section.widgets.map((widget) => (
            <div key={widget.id} style={{ gridColumn: `span ${widget.span}` }}>
              <WidgetRenderer widget={widget} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const timeRanges = ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days"];

export function DashboardView() {
  const [editing, setEditing] = useState(false);
  const [timeRange, setTimeRange] = useState("Last 30 days");
  const [timeOpen, setTimeOpen] = useState(false);

  return (
    <div className="flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-0.5">Counted Web</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Time range */}
          <div className="relative">
            <button
              onClick={() => setTimeOpen(!timeOpen)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary bg-surface-1 border border-border rounded-md hover:border-border-hover transition-colors"
            >
              <Clock className="w-3.5 h-3.5" />
              {timeRange}
              <ChevronDown className={`w-3 h-3 transition-transform ${timeOpen ? "rotate-180" : ""}`} />
            </button>
            {timeOpen && (
              <div className="absolute right-0 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg z-50 py-1 min-w-[160px]">
                {timeRanges.map((tr) => (
                  <button
                    key={tr}
                    onClick={() => { setTimeRange(tr); setTimeOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      tr === timeRange
                        ? "text-accent bg-accent/8"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
                    }`}
                  >
                    {tr}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Edit button */}
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary bg-surface-1 border border-border rounded-md hover:border-border-hover hover:text-text-primary transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-8">
        {dashboardSections.map((section) => (
          <DashboardSection key={section.id} section={section} />
        ))}
      </div>

      {/* Editor panel */}
      {editing && <Editor onClose={() => setEditing(false)} />}
    </div>
  );
}
