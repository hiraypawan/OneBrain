/**
 * MindMark — the OneBrain sigil: one head, two halves.
 * Left: organic human curves. Right: AI circuit traces and nodes.
 * A single shared droplet at the center: person and machine, one memory.
 * Static SVG (no animation budget); inherits surrounding text color.
 */
export function MindMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
    >
      {/* human half — flowing */}
      <path
        d="M14.5 3.5C9 3.5 4.8 7.6 4.8 13.2c0 2.4.8 4.6 2.2 6.3 1 1.2 1.4 2.8 1.1 4.3l-.4 1.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8.5 12.5c1.8-1.2 4-1.4 5.8-.5M8.8 17.5c1.5 1 3.4 1.1 5 .3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* machine half — traced */}
      <path
        d="M15.5 3.5c5.5 0 9.7 4.1 9.7 9.7 0 2.4-.8 4.6-2.2 6.3-1 1.2-1.4 2.8-1.1 4.3l.4 1.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M18 9h4v4M22 13v4h-3M18.5 18.5h-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="9" r="1.4" fill="currentColor" />
      <circle cx="22" cy="17" r="1.4" fill="currentColor" />
      {/* shared droplet */}
      <path
        d="M15 13.2c1.5 1.9 2.3 3.1 2.3 4.3a2.3 2.3 0 1 1-4.6 0c0-1.2.8-2.4 2.3-4.3Z"
        fill="currentColor"
      />
    </svg>
  );
}
