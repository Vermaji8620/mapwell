'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  color?: string;
  radius?: number;
  highlight?: boolean;
}

interface ScatterPlotProps {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
  onPointClick?: (point: ScatterPoint) => void;
}

export function ScatterPlot({
  points,
  xLabel = 'Social Vulnerability Index',
  yLabel = 'Indicator Rate',
  height = 280,
  onPointClick
}: ScatterPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    label: string;
    xVal: string;
    yVal: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    label: '',
    xVal: '',
    yVal: ''
  });

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 550;
    const margin = { top: 20, right: 24, bottom: 36, left: 44 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xExt = d3.extent(points, d => d.x) as [number, number];
    const yExt = d3.extent(points, d => d.y) as [number, number];

    const x = d3.scaleLinear().domain([Math.max(0, (xExt[0] || 0) * 0.9), Math.min(1, (xExt[1] || 1) * 1.05)]).nice().range([0, chartW]);
    const y = d3.scaleLinear().domain([(yExt[0] || 0) * 0.9, (yExt[1] || 10) * 1.08]).nice().range([chartH, 0]);

    // Gridlines
    g.append('g')
      .selectAll('line.grid-y')
      .data(y.ticks(4))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', chartW)
      .attr('y1', d => y(d))
      .attr('y2', d => y(d))
      .attr('stroke', 'var(--line, rgba(255,255,255,0.08))')
      .attr('stroke-dasharray', '3 3');

    // Axes
    g.append('g')
      .selectAll('text.y-lbl')
      .data(y.ticks(4))
      .enter()
      .append('text')
      .attr('x', -8)
      .attr('y', d => y(d) + 3.5)
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--faint, rgba(255,255,255,0.45))')
      .attr('font-size', '10px')
      .attr('font-family', 'var(--font-m, monospace)')
      .text(d => `${d.toFixed(1)}%`);

    g.append('g')
      .attr('transform', `translate(0,${chartH})`)
      .selectAll('text.x-lbl')
      .data(x.ticks(5))
      .enter()
      .append('text')
      .attr('x', d => x(d))
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--faint, rgba(255,255,255,0.45))')
      .attr('font-size', '10px')
      .attr('font-family', 'var(--font-m, monospace)')
      .text(d => d.toFixed(1));

    // Linear regression trendline & R2 calculation
    const n = points.length;
    const mx = d3.mean(points, d => d.x) || 0;
    const my = d3.mean(points, d => d.y) || 0;
    const sxx = d3.sum(points, d => (d.x - mx) ** 2);
    const syy = d3.sum(points, d => (d.y - my) ** 2);
    const sxy = d3.sum(points, d => (d.x - mx) * (d.y - my));

    const slope = sxx !== 0 ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const r2 = (sxx * syy > 0) ? (sxy ** 2) / (sxx * syy) : 0;

    // Draw Trendline
    const xRange = x.domain();
    g.append('line')
      .attr('x1', x(xRange[0]))
      .attr('y1', y(slope * xRange[0] + intercept))
      .attr('x2', x(xRange[1]))
      .attr('y2', y(slope * xRange[1] + intercept))
      .attr('stroke', 'var(--cyan, #37C8CF)')
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.85);

    // R2 correlation label in top right
    svg.append('text')
      .attr('x', width - margin.right)
      .attr('y', margin.top - 4)
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--cyan, #37C8CF)')
      .attr('font-size', '11.5px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'var(--font-m, monospace)')
      .text(`r² = ${r2.toFixed(2)}`);

    // Render Scatter Circles
    g.append('g')
      .selectAll('circle.dot')
      .data(points)
      .enter()
      .append('circle')
      .attr('cx', d => x(d.x))
      .attr('cy', d => y(d.y))
      .attr('r', d => d.highlight ? 6 : (d.radius || 3.5))
      .attr('fill', d => d.color || '#8B5CF6')
      .attr('fill-opacity', 0.8)
      .attr('stroke', d => d.highlight ? '#ffffff' : 'rgba(255, 255, 255, 0.25)')
      .attr('stroke-width', d => d.highlight ? 2.2 : 0.8)
      .attr('class', 'cursor-pointer hover:scale-125 transition-transform duration-150')
      .on('pointerenter', (event, d) => {
        const b = container.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - b.left + 10,
          y: event.clientY - b.top - 10,
          label: d.label,
          xVal: `SVI: ${d.x.toFixed(2)}`,
          yVal: `${yLabel}: ${d.y.toFixed(1)}%`
        });
      })
      .on('pointermove', (event) => {
        const b = container.getBoundingClientRect();
        setTooltip(prev => ({
          ...prev,
          x: event.clientX - b.left + 10,
          y: event.clientY - b.top - 10
        }));
      })
      .on('pointerleave', () => setTooltip(prev => ({ ...prev, visible: false })))
      .on('click', (event, d) => {
        if (onPointClick) onPointClick(d);
      });

  }, [points, xLabel, yLabel, height, onPointClick]);

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left animate-in fade-in"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="text-[11.5px] font-bold text-[var(--text)]">{tooltip.label}</div>
          <div className="text-[11px] text-[var(--cyan)] font-mono mt-0.5">{tooltip.xVal} • {tooltip.yVal}</div>
        </div>
      )}
    </div>
  );
}
