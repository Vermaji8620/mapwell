'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

interface HistogramChartProps {
  values: number[];
  height?: number;
  binsCount?: number;
  format?: (v: number) => string;
  mark?: number | null;
  markLabel?: string;
  unit?: string;
}

export function HistogramChart({
  values,
  height = 200,
  binsCount = 20,
  format = (v: number) => v.toFixed(1),
  mark = null,
  markLabel = 'Median',
  unit = 'Counties'
}: HistogramChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    range: string;
    count: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
    range: '',
    count: 0
  });

  useEffect(() => {
    if (!containerRef.current || values.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 450;
    const margin = { top: 16, right: 16, bottom: 28, left: 16 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('class', 'overflow-visible');

    const extent = d3.extent(values) as [number, number];
    const xMin = extent[0] ?? 0;
    const xMax = extent[1] ?? 100;
    const x = d3.scaleLinear()
      .domain([xMin, xMax])
      .nice()
      .range([0, chartW]);

    const binner = d3.bin()
      .domain(x.domain() as [number, number])
      .thresholds(x.ticks(binsCount));

    const bins = binner(values);
    const maxBinCount = d3.max(bins, b => b.length) || 1;
    const y = d3.scaleLinear()
      .domain([0, maxBinCount])
      .range([chartH, 0]);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Bottom X Axis
    g.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${chartH})`)
      .call(
        d3.axisBottom(x)
          .ticks(5)
          .tickFormat(d => format(+d))
          .tickSize(0)
          .tickPadding(8)
      )
      .call(axisGroup => {
        axisGroup.select('.domain').remove();
        axisGroup.selectAll('text')
          .attr('fill', 'var(--faint, rgba(255,255,255,0.45))')
          .attr('font-size', '10.5px')
          .attr('font-family', 'var(--font-m, monospace)');
      });

    // Color ramp for bins across the extent
    const colorScale = d3.scaleSequential()
      .domain([xMin, xMax])
      .interpolator(d3.interpolateRgbBasis(['#37C8CF', '#8B5CF6', '#F43F5E']));

    // Render Bars
    bins.forEach((b) => {
      const x0 = b.x0 ?? 0;
      const x1 = b.x1 ?? 0;
      const barX = x(x0);
      const barW = Math.max(1, x(x1) - x(x0) - 1.5);
      const barH = chartH - y(b.length);
      const barMid = (x0 + x1) / 2;

      const rect = g.append('rect')
        .attr('x', barX)
        .attr('width', barW)
        .attr('rx', Math.min(2.5, barW / 3))
        .attr('fill', colorScale(barMid))
        .attr('y', chartH)
        .attr('height', 0)
        .attr('cursor', 'pointer')
        .attr('class', 'transition-opacity duration-150 hover:opacity-80');

      rect.transition()
        .duration(650)
        .ease(d3.easeCubicOut)
        .attr('y', y(b.length))
        .attr('height', barH);

      rect.on('pointerenter', (event) => {
        const cRect = container.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - cRect.left,
          y: event.clientY - cRect.top - 15,
          range: `${format(x0)} – ${format(x1)}`,
          count: b.length
        });
      })
      .on('pointermove', (event) => {
        const cRect = container.getBoundingClientRect();
        setTooltip(prev => ({
          ...prev,
          x: event.clientX - cRect.left,
          y: event.clientY - cRect.top - 15
        }));
      })
      .on('pointerleave', () => {
        setTooltip(prev => ({ ...prev, visible: false }));
      });
    });

    // Reference Marker Line (Mark: Selected County or State Median)
    if (mark != null && !isNaN(mark)) {
      const markX = Math.max(0, Math.min(chartW, x(mark)));
      const markerGroup = g.append('g').attr('transform', `translate(${markX},0)`);

      markerGroup.append('line')
        .attr('y1', -4)
        .attr('y2', chartH)
        .attr('stroke', 'var(--cyan, #37C8CF)')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '3 2');

      markerGroup.append('circle')
        .attr('cy', -4)
        .attr('r', 3.5)
        .attr('fill', 'var(--cyan, #37C8CF)');

      const isRightAligned = markX > chartW - 100;
      markerGroup.append('text')
        .attr('y', -6)
        .attr('x', isRightAligned ? -8 : 8)
        .attr('text-anchor', isRightAligned ? 'end' : 'start')
        .attr('fill', 'var(--cyan, #37C8CF)')
        .attr('font-size', '10.5px')
        .attr('font-weight', '700')
        .attr('font-family', 'var(--font-m, monospace)')
        .text(`${markLabel}: ${format(mark)}`);
    }

  }, [values, height, binsCount, format, mark, markLabel, unit]);

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-1.5 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left text-[11px] animate-in fade-in duration-100"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="font-bold text-[var(--muted)]">{tooltip.range}</div>
          <div className="font-bold text-[var(--cyan)] num mt-0.5">
            {tooltip.count} {unit}
          </div>
        </div>
      )}
    </div>
  );
}
