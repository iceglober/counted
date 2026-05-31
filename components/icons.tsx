type Props = { className?: string };

export function CountedLogo({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="1" y="16" width="4" height="6" rx="0.5" />
      <rect x="7" y="12" width="4" height="10" rx="0.5" />
      <rect x="13" y="7" width="4" height="15" rx="0.5" />
      <rect x="19" y="2" width="4" height="20" rx="0.5" />
    </svg>
  );
}
