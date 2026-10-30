'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

interface SeriesItem {
  name: string;
  color: string;
  values: number[];
}

interface GroupedBarChartProps {
  categories: string[];
  series: SeriesItem[];
  height?: number;
}

export function GroupedBarChart({
  categories,
  series,
  height = 250
}: GroupedBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    category: string;
    tractName: string;
    val: string;
    color: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    category: '',
    tractName: '',
    val: '',
    color: ''
  });

  useEffect(() => {
    if (!containerRef.current || series.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 600;
    const margin = { top: 16, right: 12, bottom: 32, left: 44 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const allValues = series.flatMap(s => s.values);
    const maxVal = Math.max(...allValues, 10);
    const yMax = Math.ceil((maxVal * 1.15) / 5) * 5; // Nice round ceiling

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('class', 'overflow-visible');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // X0 scale for categories
    const x0 = d3.scaleBand()
      .domain(categories)
      .range([0, chartW])
      .padding(0.24);

    // X1 scale for tracts within each category
    const x1 = d3.scaleBand()
      .domain(series.map(s => s.name))
      .range([0, x0.bandwidth()])
      .padding(0.12);

    // Y scale
    const y = d3.scaleLinear()
      .domain([0, yMax])
      .range([chartH, 0]);

    // Horizontal gridlines
    const yTicks = y.ticks(4);
    g.append('g')
      .selectAll('line.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'grid-line')
      .attr('x1', 0)
      .attr('x2', chartW)
      .attr('y1', d => y(d))
      .attr('y2', d => y(d))
      .attr('stroke', 'var(--line, rgba(255,255,255,0.08))')
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-width', 1);

    // Y Axis Labels
    g.append('g')
      .selectAll('text.y-label')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('class', 'y-label')
      .attr('x', -8)
      .attr('y', d => y(d) + 3.5)
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--faint, rgba(255,255,255,0.45))')
      .attr('font-size', '10.5px')
      .attr('font-weight', '500')
      .attr('font-family', 'var(--font-m, monospace)')
      .text(d => `${d}%`);

    // X Axis Category Labels
    g.append('g')
      .attr('transform', `translate(0,${chartH})`)
      .selectAll('text.x-label')
      .data(categories)
      .enter()
      .append('text')
      .attr('class', 'x-label')
      .attr('x', d => (x0(d) || 0) + x0.bandwidth() / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--muted, rgba(255,255,255,0.65))')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text(d => d);

    // Render Grouped Rectangles
    categories.forEach((cat, catIdx) => {
      const catGroup = g.append('g')
        .attr('transform', `translate(${x0(cat)},0)`);

      series.forEach((s) => {
        const val = s.values[catIdx] ?? 0;
        const barH = chartH - y(val);
        const barW = x1.bandwidth();
        const barX = x1(s.name) || 0;

        catGroup.append('rect')
          .attr('x', barX)
          .attr('y', y(val))
          .attr('width', barW)
          .attr('height', barH)
          .attr('rx', Math.min(3, barW / 3))
          .attr('fill', s.color)
          .attr('class', 'transition-opacity duration-150 cursor-pointer hover:opacity-85')
          .on('pointerenter', (event) => {
            const rect = container.getBoundingClientRect();
            setTooltip({
              visible: true,
              x: event.clientX - rect.left + 10,
              y: event.clientY - rect.top - 10,
              category: cat,
              tractName: s.name,
              val: `${val.toFixed(1)}%`,
              color: s.color
            });
          })
          .on('pointermove', (event) => {
            const rect = container.getBoundingClientRect();
            setTooltip(prev => ({
              ...prev,
              x: event.clientX - rect.left + 10,
              y: event.clientY - rect.top - 10
            }));
          })
          .on('pointerleave', () => {
            setTooltip(prev => ({ ...prev, visible: false }));
          });
      });
    });

  }, [categories, series, height]);

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating Hover Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left animate-in fade-in duration-150"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="text-[11px] font-bold text-[var(--muted)]">{tooltip.category}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tooltip.color }} />
            <span className="text-[12px] font-bold text-[var(--text)]">{tooltip.tractName}</span>
            <span className="text-[12px] font-bold text-[var(--cyan)] num ml-2">{tooltip.val}</span>
          </div>
        </div>
      )}
    </div>
  );
}
