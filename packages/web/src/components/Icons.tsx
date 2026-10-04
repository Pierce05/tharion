import type { ReactNode } from 'react';

export type IconName =
  | 'bolt' | 'globe' | 'fx' | 'branch' | 'clock' | 'mail' | 'flag' | 'grid' | 'play'
  | 'rewind' | 'list' | 'rows' | 'inbox' | 'check' | 'sparkle' | 'fork';

const ICONS: Record<IconName, ReactNode> = {
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>),
  fx: <path d="M9 4C7 4 6 5 6 7v3c0 1-1 2-2 2 1 0 2 1 2 2v3c0 2 1 3 3 3M15 4c2 0 3 1 3 3v3c0 1 1 2 2 2-1 0-2 1-2 2v3c0 2-1 3-3 3" />,
  branch: (<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 7v10M18 11c0 4-8 3-12 6" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>),
  flag: <path d="M5 21V4M5 4h12l-2 4 2 4H5" />,
  grid: (<><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></>),
  play: <path d="M7 4l13 8-13 8z" />,
  rewind: <path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2" />,
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  rows: (<><rect x="4" y="4" width="16" height="6" /><rect x="4" y="14" width="16" height="6" /></>),
  inbox: <path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5" />,
  check: <path d="M5 12l5 5 9-10" />,
  sparkle: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  fork: (<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10M18 9c0 5-12 2-12 6" /></>),
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={`i ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}