'use client';

import React from 'react';
import Link from 'next/link';
import { Compass, MapPin, LayoutDashboard } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="max-w-xl w-full text-center relative">
        {/* Glow backdrop */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.15),transparent_70%)] pointer-events-none" />

        {/* 404 Visual Icon */}
        <div className="relative inline-flex items-center justify-center w-24 h-24 mb-6 rounded-3xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-2xl shadow-cyan-500/20">
          <Compass className="w-12 h-12 animate-pulse" />
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center">
            <MapPin className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* HTTP 404 Badge & Heading */}
        <div className="text-[12px] font-bold tracking-widest text-cyan-400 uppercase mb-2">
          HTTP 404 Error
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-3">
          Page Not Found
        </h1>
        <p className="text-[14px] text-[var(--muted,#94a3b8)] max-w-md mx-auto mb-8 leading-relaxed">
          The requested page does not exist. It may have been relocated or entered incorrectly.
        </p>

        {/* Only Return to Dashboard action */}
        <div className="flex items-center justify-center">
          <Link
            href="/"
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-[14px] flex items-center justify-center gap-2.5 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer hover:shadow-cyan-500/30 active:scale-[0.99]"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Return to Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
