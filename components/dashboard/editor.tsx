"use client";

import { useState } from "react";
import { dashboardSections } from "@/lib/mock-data";
import { X, Plus, ChevronDown, ChevronRight, BarChart, Hash } from "@/components/icons";

const widgetTypes = [
  { type: "metric", label: "Metric", desc: "Single number with trend" },
  { type: "timeseries", label: "Time series", desc: "Line chart over time" },
  { type: "breakdown", label: "Breakdown", desc: "Bar chart by property" },
] as const;

export function Editor({ onClose }: { onClose: () => void }) {
  const [sections, setSections] = useState(
    dashboardSections.map((s) => ({ ...s, expanded: true })),
  );
  const [addingTo, setAddingTo] = useState<string | null>(null);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-surface-0/60 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 w-96 bg-surface-1 border-l border-border z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">Edit Dashboard</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {sections.map((section) => (
            <div key={section.id} className="border border-border rounded-lg">
              <button
                onClick={() =>
                  setSections((prev) =>
                    prev.map((s) =>
                      s.id === section.id ? { ...s, expanded: !s.expanded } : s,
                    ),
                  )
                }
                className="w-full flex items-center justify-between px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  {section.expanded ? (
                    <ChevronDown className="w-3 h-3 text-text-tertiary" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-text-tertiary" />
                  )}
                  <span className="font-medium">{section.title}</span>
                  <span className="text-text-tertiary text-xs">
                    {section.widgets.length} widgets
                  </span>
                </div>
              </button>

              {section.expanded && (
                <div className="px-4 pb-3 space-y-1.5">
                  {section.widgets.map((widget) => (
                    <div
                      key={widget.id}
                      className="flex items-center justify-between px-3 py-2 bg-surface-2 rounded-md text-xs"
                    >
                      <div className="flex items-center gap-2">
                        {widget.type === "timeseries" ? (
                          <BarChart className="w-3 h-3 text-text-tertiary" />
                        ) : (
                          <Hash className="w-3 h-3 text-text-tertiary" />
                        )}
                        <span className="text-text-primary">{widget.title}</span>
                      </div>
                      <span className="text-text-tertiary">
                        {widget.span === 4 ? "full" : `${widget.span}/4`}
                      </span>
                    </div>
                  ))}

                  {/* Add widget */}
                  {addingTo === section.id ? (
                    <div className="pt-2 space-y-1.5">
                      {widgetTypes.map((wt) => (
                        <button
                          key={wt.type}
                          onClick={() => setAddingTo(null)}
                          className="w-full text-left px-3 py-2 bg-surface-2 rounded-md text-xs hover:bg-surface-3 transition-colors"
                        >
                          <span className="text-text-primary">{wt.label}</span>
                          <span className="text-text-tertiary ml-2">{wt.desc}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingTo(section.id)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-tertiary hover:text-accent transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add widget
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Add section */}
          <button className="flex items-center gap-2 px-4 py-3 text-sm text-text-tertiary hover:text-accent transition-colors w-full border border-dashed border-border rounded-lg hover:border-accent/40">
            <Plus className="w-4 h-4" />
            Add section
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-text-secondary bg-surface-2 rounded-md hover:bg-surface-3 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-surface-0 bg-accent rounded-md hover:bg-accent-hover transition-colors font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}
