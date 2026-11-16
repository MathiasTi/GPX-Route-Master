import React, { useId } from 'react';

interface BrandLogoProps {
  size?: number;
  variant?: 'badge' | 'mark';
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 28,
  variant = 'badge',
  className = ''
}) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `gpx-bg-${uid}`;
  const routeId = `gpx-route-${uid}`;

  if (variant === 'mark') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={routeId} x1="18" y1="74" x2="74" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0EA5E9" />
            <stop offset="55%" stopColor="#4F46E5" />
            <stop offset="100%" stopColor="#EA580C" />
          </linearGradient>
        </defs>
        <path
          d="M16 74 L41 28 L56 54 L69 35 L85 74"
          className="stroke-slate-800 dark:stroke-slate-100"
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M21 75 C33 75, 35 58, 46 56 C57 54, 60 41, 69 35"
          stroke={`url(#${routeId})`}
          strokeWidth="6.5"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="21" cy="75" r="5" fill="#0EA5E9" />
        <circle cx="69" cy="35" r="5.5" fill="#EA580C" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0F172A" />
          <stop offset="100%" stopColor="#1E293B" />
        </linearGradient>
        <linearGradient id={routeId} x1="20" y1="74" x2="76" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="55%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#F97316" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="96" height="96" rx="22" fill={`url(#${bgId})`} stroke="#334155" strokeWidth="2.5" />
      <path d="M18 72 L42 30 L56 54 L68 37 L83 72 Z" fill="#1E293B" />
      <path d="M42 30 L56 54 L49 60 L37 41 Z" fill="#334155" />
      <path
        d="M18 72 L42 30 L56 54 L68 37 L83 72"
        stroke="#F1F5F9"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 73 C34 73, 35 58, 46 56 C57 54, 59 42, 68 36"
        stroke={`url(#${routeId})`}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="22" cy="73" r="4.8" fill="#38BDF8" stroke="#0F172A" strokeWidth="1.5" />
      <circle cx="68" cy="36" r="5.2" fill="#F97316" stroke="#0F172A" strokeWidth="1.5" />
    </svg>
  );
};
