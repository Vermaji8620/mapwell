'use client';

import React from 'react';

export interface DumbbellItem {
  key: string;
  label: string;
  direction: 'higher' | 'lower'; // 'higher' is better or 'lower' is better
  nationalVal: number;
  stateVal: number;
  stateAbbr: string;
  countyVal: number | null;
  countyName: string | null;
  format: (v: number) => string;
  minVal: number;
  maxVal: number;
  isActive?: boolean;
  onSelect?: () => void;
}

interface DumbbellPlotProps {
  items: DumbbellItem[];
}

export function DumbbellPlot({ items }: DumbbellPlotProps) {
  return (
    <div className="space-y-5">
      {items.map((item) => {
        const range = Math.max(0.001, item.maxVal - item.minVal);
        const clampPos = (val: number) =>
          Math.max(0, Math.min(100, ((val - item.minVal) / range) * 100));

        const natPos = clampPos(item.nationalVal);
        const statePos = clampPos(item.stateVal);
        const countyPos = item.countyVal != null ? clampPos(item.countyVal) : null;

        const barLeft = Math.min(natPos, statePos);
        const barWidth = Math.abs(natPos - statePos);

        return (
          <div
            key={item.key}
            onClick={item.onSelect}
            className={`p-3.5 rounded-xl border transition-all ${
              item.isActive
                ? 'bg-[var(--glow)]/40 border-[var(--cyan)] shadow-sm'
                : 'bg-[var(--surface-solid)] border-[var(--line)] hover:border-[var(--line-strong)] cursor-pointer'
            }`}
          >
            {/* Header: Label and interpretation */}
            <div className="flex items-center justify-between text-[12.5px] mb-2.5">
              <span className={`font-bold ${item.isActive ? 'text-[var(--cyan)]' : 'text-[var(--text)]'}`}>
                {item.label}
              </span>
              <span className="text-[11px] font-semibold text-[var(--faint)]">
                {item.direction === 'higher' ? 'Higher is better' : 'Lower is better'}
              </span>
            </div>

            {/* Dumbbell Track */}
            <div className="relative h-7 flex items-center">
              {/* Background Full Track */}
              <div className="absolute inset-x-0 h-1.5 bg-[var(--surface-2)] rounded-full" />

              {/* Connecting Gradient Bar between National and State */}
              <div
                className="absolute h-1.5 rounded-full bg-gradient-to-r from-[var(--teal)] to-[var(--violet)] transition-all duration-700"
                style={{
                  left: `${barLeft}%`,
                  width: `${Math.max(2, barWidth)}%`
                }}
              />

              {/* National Marker Dot */}
              <div
                className="absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[var(--faint)] border-2 border-[var(--surface-solid)] shadow-md transition-all duration-700"
                style={{ left: `${natPos}%` }}
                title={`National: ${item.format(item.nationalVal)}`}
              />

              {/* State Marker Dot */}
              <div
                className="absolute -translate-x-1/2 w-4 h-4 rounded-full bg-[var(--violet)] border-2 border-[var(--surface-solid)] shadow-md transition-all duration-700 z-10"
                style={{ left: `${statePos}%` }}
                title={`${item.stateAbbr}: ${item.format(item.stateVal)}`}
              />

              {/* Active County Marker Dot (glowing cyan) */}
              {countyPos != null && (
                <div
                  className="absolute -translate-x-1/2 w-4.5 h-4.5 rounded-full bg-[var(--cyan)] border-2 border-[var(--surface-solid)] ring-2 ring-[var(--cyan)]/40 shadow-lg transition-all duration-700 z-20"
                  style={{ left: `${countyPos}%` }}
                  title={`${item.countyName || 'County'}: ${item.format(item.countyVal!)}`}
                />
              )}
            </div>

            {/* Readout Values Footer */}
            <div className="flex items-center gap-4 text-[11.5px] text-[var(--muted)] pt-1 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--faint)]" />
                <span>National:</span>
                <b className="num text-[var(--text)]">{item.format(item.nationalVal)}</b>
              </span>

              <span className="flex items-center gap-1.5 text-[var(--violet)]">
                <span className="w-2 h-2 rounded-full bg-[var(--violet)]" />
                <span>{item.stateAbbr}:</span>
                <b className="num font-bold">{item.format(item.stateVal)}</b>
              </span>

              {item.countyVal != null && (
                <span className="flex items-center gap-1.5 text-[var(--cyan)] font-bold">
                  <span className="w-2 h-2 rounded-full bg-[var(--cyan)]" />
                  <span>{item.countyName || 'County'}:</span>
                  <b className="num">{item.format(item.countyVal)}</b>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
