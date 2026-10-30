'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export interface TrendSeries {
  name: string;
  color: string;
  values: number[];
  dash?: string;
  width?: number;
}

interface TrendLineChartProps {
  years: (string | number)[];
  series: TrendSeries[];
  height?: number;
  unit?: string;
  showArea?: boolean;
}

export function TrendLineChart({
  years,
  series,
  height = 230,
  unit = '%',
  showArea = true
}: TrendLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || series.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 550;
    const margin = { top: 16, right: 20, bottom: 28, left: 44 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const allValues = series.flatMap(s => s.values);
    const yMin = Math.max(0, Math.min(...allValues) * 0.9);
    const yMax = Math.max(...allValues) * 1.08;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%');

    const defs = svg.append('defs');
    const gid = `trend-area-${Math.random().toString(36).substring(2, 7)}`;
    const gr = defs.append('linearGradient').attr('id', gid).attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
    gr.append('stop').attr('offset', '0%').attr('stop-color', series[0]?.color || '#F43F5E').attr('stop-opacity', 0.35);
    gr.append('stop').attr('offset', '100%').attr('stop-color', series[0]?.color || '#F43F5E').attr('stop-opacity', 0.0);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scalePoint()
      .domain(years.map(String))
      .range([0, chartW]);

    const y = d3.scaleLinear()
      .domain([yMin, yMax])
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

    // Left Y Axis Labels
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

    // Bottom X Axis Labels (skip if too many, e.g. 52 weeks)
    const tickInterval = Math.ceil(years.length / Math.max(3, Math.floor(chartW / 65)));
    const tickYears = years.filter((_, i) => i % tickInterval === 0 || i === years.length - 1);

    g.append('g')
      .attr('transform', `translate(0,${chartH})`)
      .selectAll('text.x-lbl')
      .data(tickYears.map(String))
      .enter()
      .append('text')
      .attr('x', d => x(d) || 0)
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--faint, rgba(255,255,255,0.45))')
      .attr('font-size', '10px')
      .attr('font-family', 'var(--font-m, monospace)')
      .text(d => d);

    // Area under primary series (Animated Fade In)
    if (showArea && series.length > 0 && !series[0].dash) {
      const areaGen = d3.area<number>()
        .x((_, i) => x(String(years[i])) || 0)
        .y0(chartH)
        .y1(d => y(d))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(series[0].values)
        .attr('d', areaGen)
        .attr('fill', `url(#${gid})`)
        .attr('opacity', 0)
        .transition()
        .duration(900)
        .delay(300)
        .attr('opacity', 1);
    }

    // Lines with animated stroke draw-in
    series.forEach((s, si) => {
      const lineGen = d3.line<number>()
        .x((_, i) => x(String(years[i])) || 0)
        .y(d => y(d))
        .curve(d3.curveMonotoneX);

      const path = g.append('path')
        .datum(s.values)
        .attr('d', lineGen)
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', s.width || 2.4)
        .attr('stroke-linecap', 'round');

      if (s.dash) {
        path.attr('stroke-dasharray', s.dash);
      } else {
        const node = path.node() as SVGPathElement | null;
        if (node) {
          const totalLength = node.getTotalLength();
          path
            .attr('stroke-dasharray', `${totalLength} ${totalLength}`)
            .attr('stroke-dashoffset', totalLength)
            .transition()
            .duration(1100)
            .delay(si * 140)
            .ease(d3.easeCubicInOut)
            .attr('stroke-dashoffset', 0);
        }
      }
    });

    // Hover overlay & Crosshair
    const crosshair = g.append('line')
      .attr('y1', 0)
      .attr('y2', chartH)
      .attr('stroke', 'var(--line-strong, rgba(255,255,255,0.3))')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '3 3')
      .attr('opacity', 0);

    const circles = series.map(s => {
      return g.append('circle')
        .attr('r', 4.5)
        .attr('fill', s.color)
        .attr('stroke', 'var(--surface-solid, #0A0F1D)')
        .attr('stroke-width', 2)
        .attr('opacity', 0);
    });

    g.append('rect')
      .attr('width', chartW)
      .attr('height', chartH)
      .attr('fill', 'transparent')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event);
        const step = chartW / Math.max(1, years.length - 1);
        const idx = Math.max(0, Math.min(years.length - 1, Math.round(mx / step)));
        const cx = x(String(years[idx])) || 0;

        crosshair
          .attr('x1', cx)
          .attr('x2', cx)
          .attr('opacity', 1);

        circles.forEach((c, si) => {
          const val = series[si].values[idx] ?? 0;
          c.attr('cx', cx)
            .attr('cy', y(val))
            .attr('opacity', 1);
        });

        const containerRect = container.getBoundingClientRect();
        setHoverIndex(idx);
        setTooltipPos({
          x: mx + margin.left,
          y: Math.min(margin.top + 30, chartH / 2)
        });
      })
      .on('pointerleave', () => {
        crosshair.attr('opacity', 0);
        circles.forEach(c => c.attr('opacity', 0));
        setHoverIndex(null);
        setTooltipPos(null);
      });

  }, [years, series, height, unit, showArea]);

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {hoverIndex !== null && tooltipPos && (
        <div
          className="absolute z-20 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left text-[11px] animate-in fade-in duration-100"
          style={{
            left: `${Math.min(tooltipPos.x + 12, (containerRef.current?.clientWidth || 400) - 150)}px`,
            top: `${tooltipPos.y}px`
          }}
        >
          <div className="font-bold text-[var(--muted)] mb-1">{years[hoverIndex]}</div>
          <div className="space-y-1">
            {series.map(s => (
              <div key={s.name} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-[var(--text)] font-medium">{s.name}</span>
                </div>
                <span className="font-bold text-[var(--text)] num">
                  {(s.values[hoverIndex] ?? 0).toFixed(1)}{unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
