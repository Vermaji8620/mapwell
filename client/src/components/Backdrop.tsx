'use client';

import React from 'react';

export function Backdrop() {
  return (
    <div id="backdrop" className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {/* Radial glow orbs */}
      <div
        className="absolute rounded-full filter blur-[90px] opacity-25 w-[620px] height-[620px] -left-40 -top-48"
        style={{ background: 'radial-gradient(circle, var(--violet), transparent 65%)' }}
      />
      <div
        className="absolute rounded-full filter blur-[90px] opacity-20 w-[720px] height-[720px] -right-60 -bottom-72"
        style={{ background: 'radial-gradient(circle, var(--cyan), transparent 65%)' }}
      />
      {/* Background SVG grid */}
      <svg className="absolute inset-0 w-full h-full opacity-40">
        <defs>
          <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--grid)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-pattern)" />
      </svg>
    </div>
  );
}
