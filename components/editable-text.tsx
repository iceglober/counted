"use client";

import { useState, useRef, useEffect } from "react";

type Props = {
  value: string;
  onCommit: (value: string) => void;
  onEditingChange?: (editing: boolean) => void;
  className?: string;
  autoFocus?: boolean;
};

export function EditableText({ value, onCommit, onEditingChange, className, autoFocus }: Props) {
  const [editing, _setEditing] = useState(autoFocus ?? false);
  function setEditing(v: boolean) { _setEditing(v); onEditingChange?.(v); }
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const trimmed = draft.trim() || value;
    setDraft(trimmed);
    setEditing(false);
    if (trimmed !== value) onCommit(trimmed);
  }

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-pointer hover:text-accent transition-colors ${className ?? ""}`}
      >
        {value}
      </span>
    );
  }

  return (
    <input
      ref={ref}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
      className={`bg-transparent border-b border-accent/40 outline-none ${className ?? ""}`}
    />
  );
}
