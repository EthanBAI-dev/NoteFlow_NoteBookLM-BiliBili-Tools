import { useId } from 'react';
import type { SVGProps } from 'react';

export function LayersIcon(props: SVGProps<SVGSVGElement>) {
  const clipId = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="4" y="0" width="16" height="16" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <path d="M16 22l-6-4-6 4V5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5z" />
      </g>
      <path d="M16 18l-6-4-6 4V5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5z" />
    </svg>
  );
}
