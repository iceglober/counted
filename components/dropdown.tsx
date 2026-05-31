"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

type Option = {
  value: string;
  label: string;
  detail?: string;
};

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export function Dropdown({ value, options, onChange, placeholder = "Select...", className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded-md text-text-primary hover:border-border-hover focus:outline-none focus:border-accent/60 transition-colors"
      >
        <span className={selected ? "text-text-primary" : "text-text-tertiary"}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={`w-3 h-3 text-text-tertiary shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg py-1 max-h-48 overflow-y-auto">
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-tertiary">No options</div>
          )}
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                opt.value === value
                  ? "text-accent bg-accent/8"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
              }`}
            >
              <span>{opt.label}</span>
              {opt.detail && <span className="text-text-tertiary ml-2">{opt.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
