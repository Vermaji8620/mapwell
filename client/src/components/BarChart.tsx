'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarDatum[];
  horizontal?: boolean;
  height?: number;
  unit?: string;
}

export function BarChart({
  data,
  horizontal = false,
  height = 240,
  unit = '%'
}: BarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    label: string;
    val: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    label: '',
    val: ''
  });

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 400;

    if (horizontal) {
      // Horizontal Bars Layout
      const margin = { top: 12, right: 28, bottom: 20, left: 110 };
      const chartW = width - margin.left - margin.right;
      const chartH = height - margin.top - margin.bottom;

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', '100%')
        .attr('height', '100%');

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

      const y = d3.scaleBand()
        .domain(data.map(d => d.label))
        .range([0, chartH])
        .padding(0.24);

      const maxVal = Math.max(...data.map(d => d.value), 5);
      const x = d3.scaleLinear()
        .domain([0, maxVal * 1.15])
        .range([0, chartW]);

      // Y Labels
      g.append('g')
        .selectAll('text.y-lbl')
        .data(data)
        .enter()
        .append('text')
        .attr('x', -8)
        .attr('y', d => (y(d.label) || 0) + y.bandwidth() / 2 + 3.5)
        .attr('text-anchor', 'end')
        .attr('fill', 'var(--text, #ffffff)')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(d => d.label);

      // Bars
      g.selectAll('rect.bar')
        .data(data)
        .enter()
        .append('rect')
        .attr('x', 0)
        .attr('y', d => y(d.label) || 0)
        .attr('width', d => x(d.value))
        .attr('height', y.bandwidth())
        .attr('rx', 4)
        .attr('fill', d => d.color || 'var(--cyan, #37C8CF)')
        .attr('class', 'cursor-pointer hover:opacity-85 transition-opacity')
        .on('pointerenter', (event, d) => {
          const b = container.getBoundingClientRect();
          setTooltip({
            visible: true,
            x: event.clientX - b.left + 10,
            y: event.clientY - b.top - 10,
            label: d.label,
            val: `${d.value.toFixed(1)}${unit}`
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
        .on('pointerleave', () => setTooltip(prev => ({ ...prev, visible: false })));

      // Value label at bar end
      g.selectAll('text.val-lbl')
        .data(data)
        .enter()
        .append('text')
        .attr('x', d => x(d.value) + 6)
        .attr('y', d => (y(d.label) || 0) + y.bandwidth() / 2 + 3.5)
        .attr('fill', 'var(--muted, rgba(255,255,255,0.7))')
        .attr('font-size', '10.5px')
        .attr('font-weight', 'bold')
        .attr('font-family', 'var(--font-m, monospace)')
        .text(d => `${d.value.toFixed(1)}${unit}`);

    } else {
      // Vertical Bars Layout (e.g. Quintiles)
      const margin = { top: 16, right: 14, bottom: 28, left: 44 };
      const chartW = width - margin.left - margin.right;
      const chartH = height - margin.top - margin.bottom;

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', '100%')
        .attr('height', '100%');

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

      const x = d3.scaleBand()
        .domain(data.map(d => d.label))
        .range([0, chartW])
        .padding(0.25);

      const maxVal = Math.max(...data.map(d => d.value), 5);
      const y = d3.scaleLinear()
        .domain([0, maxVal * 1.15])
        .range([chartH, 0]);

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

      // Y axis labels
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
        .text(d => `${d.toFixed(1)}${unit}`);

      // X axis labels
      g.append('g')
        .attr('transform', `translate(0,${chartH})`)
        .selectAll('text.x-lbl')
        .data(data)
        .enter()
        .append('text')
        .attr('x', d => (x(d.label) || 0) + x.bandwidth() / 2)
        .attr('y', 18)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--muted, rgba(255,255,255,0.65))')
        .attr('font-size', '10.5px')
        .attr('font-weight', '600')
        .text(d => d.label);

      // Bars
      g.selectAll('rect.bar')
        .data(data)
        .enter()
        .append('rect')
        .attr('x', d => x(d.label) || 0)
        .attr('y', d => y(d.value))
        .attr('width', x.bandwidth())
        .attr('height', d => chartH - y(d.value))
        .attr('rx', 4)
        .attr('fill', d => d.color || 'var(--cyan, #37C8CF)')
        .attr('class', 'cursor-pointer hover:opacity-85 transition-opacity')
        .on('pointerenter', (event, d) => {
          const b = container.getBoundingClientRect();
          setTooltip({
            visible: true,
            x: event.clientX - b.left + 10,
            y: event.clientY - b.top - 10,
            label: d.label,
            val: `${d.value.toFixed(1)}${unit}`
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
        .on('pointerleave', () => setTooltip(prev => ({ ...prev, visible: false })));
    }

  }, [data, horizontal, height, unit]);

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left animate-in fade-in"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="text-[11px] font-bold text-[var(--muted)]">{tooltip.label}</div>
          <div className="text-[12px] font-bold text-[var(--cyan)] num mt-0.5">{tooltip.val}</div>
        </div>
      )}
    </div>
  );
}
