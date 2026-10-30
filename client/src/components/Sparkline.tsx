'use client';

import React from 'react';
import * as d3 from 'd3';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({
  values,
  width = 80,
  height = 24,
  color = 'var(--rose)'
}: SparklineProps) {
  if (!values || values.length < 2) return null;

  const x = d3.scaleLinear()
    .domain([0, values.length - 1])
    .range([2, width - 2]);

  const yExtent = d3.extent(values) as [number, number];
  const yMin = yExtent[0] ?? 0;
  const yMax = yExtent[1] ?? 10;
  const yRange = yMax === yMin ? [0, 10] : [yMin, yMax];

  const y = d3.scaleLinear()
    .domain(yRange)
    .range([height - 3, 3]);

  const line = d3.line<number>()
    .x((_, i) => x(i))
    .y(d => y(d))
    .curve(d3.curveMonotoneX);

  const d = line(values) || '';
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible inline-block align-middle">
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}
