export function Brand({ className = "" }: { className?: string }) {
  return (
    <svg
      role="img"
      aria-label="Kanbo"
      viewBox="0 0 160 40"
      fill="none"
      className={`h-10 w-40 ${className}`}
    >
      <rect x="4" y="6" width="10" height="28" rx="3" fill="#78350F" />
      <rect x="18" y="12" width="10" height="22" rx="3" fill="#9A3412" />
      <rect x="32" y="18" width="10" height="16" rx="3" fill="#D97706" />
      <text
        x="50"
        y="27"
        className="fill-foreground font-sans"
        fontWeight="800"
        fontSize="22"
        letterSpacing="-0.5px"
      >
        Kanbo
      </text>
      <circle cx="122" cy="14" r="3.5" fill="#B45309" />
    </svg>
  );
}
