type Props = { className?: string };

export function TallyMark({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={className}>
      <line x1="5" y1="5" x2="5" y2="19" />
      <line x1="9" y1="5" x2="9" y2="19" />
      <line x1="13" y1="5" x2="13" y2="19" />
      <line x1="17" y1="5" x2="17" y2="19" />
      <line x1="3" y1="16" x2="19" y2="7" />
    </svg>
  );
}

export function ChevronDown({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function ChevronRight({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

export function ArrowUpRight({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 11L11 5M11 5H6M11 5v5" />
    </svg>
  );
}

export function ArrowDownRight({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 5l6 6M11 11H6M11 11V6" />
    </svg>
  );
}

export function Plus({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function X({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function Settings({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}

export function Pencil({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11.5 1.5l3 3L5 14H2v-3z" />
    </svg>
  );
}

export function BarChart({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <path d="M4 14V8M8 14V4M12 14V6" />
    </svg>
  );
}

export function Clock({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l2.5 2.5" />
    </svg>
  );
}

export function ExternalLink({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 9v4H3V4h4M8 8l5-5M10 3h3v3" />
    </svg>
  );
}

export function Hash({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <path d="M5 1l-2 14M13 1l-2 14M1 5h14M1 11h14" />
    </svg>
  );
}
