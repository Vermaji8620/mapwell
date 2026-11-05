'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export interface QualityIndicatorItem {
  label: string;
  value: number;
  desc?: string;
}

interface QualityBarChartProps {
  indicators: QualityIndicatorItem[];
}

export function QualityBarChart({ indicators }: QualityBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(400);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        setWidth(Math.max(200, containerRef.current.clientWidth));
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const rowH = 30;
  const lw = Math.min(170, width * 0.42);
  const H = indicators.length * rowH + 6;
  const availableBarWidth = Math.max(10, width - lw - 64);
  const xScale = d3.scaleLinear().domain([0, 100]).range([0, availableBarWidth]);

  return (
    <div ref={containerRef} className="chart w-full select-none" style={{ minHeight: `${H}px` }}>
      <svg
        viewBox={`0 0 ${width} ${H}`}
        width={width}
        height={H}
        className="w-full h-auto block"
      >
        {indicators.map((d, i) => {
          const barW = Math.max(0, xScale(d.value));
          const labelText = d.label.length > 24 ? d.label.slice(0, 23) + '.' : d.label;
          return (
            <g className="r" transform={`translate(0, ${i * rowH})`} key={d.label}>
              <text className="lbl" x={0} y={rowH / 2 + 4}>
                {labelText}
              </text>
              <rect
                x={lw}
                y={rowH / 2 - 3}
                height={6}
                rx={1}
                fill="var(--surface-2)"
                width={availableBarWidth}
              />
              <rect
                className="b"
                x={lw}
                y={rowH / 2 - 3}
                height={6}
                rx={1}
                fill="var(--cyan)"
                width={barW}
                style={{ transition: 'width 0.9s cubic-bezier(0.33, 1, 0.68, 1)' }}
              />
              <text className="val" x={width} textAnchor="end" y={rowH / 2 + 4}>
                {d.value.toFixed(1)}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
