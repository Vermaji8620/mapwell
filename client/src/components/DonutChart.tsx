'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutDatum[];
  size?: number;
  center?: string;
  centerLabel?: string;
  unit?: string;
}

const DEFAULT_PALETTE = ['#37C8CF', '#8B5CF6', '#10B981', '#F43F5E', '#F59E0B', '#5FA8FF'];

export function DonutChart({
  data,
  size = 210,
  center,
  centerLabel = 'enrolled',
  unit = ''
}: DonutChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    label: string;
    value: string;
    share: string;
    color: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    label: '',
    value: '',
    share: '',
    color: ''
  });

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || size;
    const S = Math.min(width, size);
    const H = S;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .attr('class', 'overflow-visible');

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2},${H / 2})`);

    const total = d3.sum(data, d => d.value) || 1;

    const pie = d3.pie<DonutDatum>()
      .value(d => d.value)
      .sort(null)
      .padAngle(0.025);

    const innerRadius = S * 0.38;
    const outerRadius = S * 0.47;

    const arc = d3.arc<d3.PieArcDatum<DonutDatum>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .cornerRadius(2);

    const arcHover = d3.arc<d3.PieArcDatum<DonutDatum>>()
      .innerRadius(innerRadius - 2)
      .outerRadius(outerRadius + 4)
      .cornerRadius(2);

    const paths = g.selectAll('path.donut-arc')
      .data(pie(data))
      .enter()
      .append('path')
      .attr('class', 'donut-arc cursor-pointer transition-transform duration-200')
      .attr('fill', (d, i) => d.data.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length])
      .attr('stroke', 'var(--surface-solid, #0B1120)')
      .attr('stroke-width', 1.5);

    // Smooth entry transition
    paths.transition()
      .duration(900)
      .delay((_, i) => i * 80)
      .ease(d3.easeCubicOut)
      .attrTween('d', function (d) {
        const interpolate = d3.interpolate({ startAngle: d.startAngle, endAngle: d.startAngle }, d);
        return function (t) {
          return arc(interpolate(t)) || '';
        };
      });

    // Tooltip & hover effects
    paths
      .on('pointerenter', function (event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('d', arcHover as any)
          .attr('opacity', 1);

        const rect = container.getBoundingClientRect();
        const sharePct = ((d.data.value / total) * 100).toFixed(1);

        setTooltip({
          visible: true,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 12,
          label: d.data.label,
          value: `${d.data.value.toLocaleString()}${unit ? ' ' + unit : ''}`,
          share: `${sharePct}%`,
          color: d.data.color || DEFAULT_PALETTE[d.index % DEFAULT_PALETTE.length]
        });
      })
      .on('pointermove', function (event) {
        const rect = container.getBoundingClientRect();
        setTooltip(prev => ({
          ...prev,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 12
        }));
      })
      .on('pointerleave', function () {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('d', arc as any)
          .attr('opacity', 0.95);

        setTooltip(prev => ({ ...prev, visible: false }));
      });

    // Center Display
    if (center) {
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.05em')
        .attr('class', 'fill-[var(--text)] font-display font-bold num select-none')
        .style('font-size', `${Math.max(16, S * 0.12)}px`)
        .text(center);

      if (centerLabel) {
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '1.65em')
          .attr('class', 'fill-[var(--muted)] text-[11px] font-medium select-none')
          .text(centerLabel);
      }
    }
  }, [data, size, center, centerLabel, unit]);

  return (
    <div className="relative flex justify-center items-center w-full min-h-[210px]">
      <div ref={containerRef} className="w-full flex justify-center" />

      {tooltip.visible && (
        <div
          className="absolute z-30 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-xl text-[12px] -translate-x-1/2 -translate-y-full"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: tooltip.color }}
            />
            <span className="font-bold text-[var(--text)]">{tooltip.label}</span>
          </div>
          <div className="flex justify-between gap-4 text-[11px] text-[var(--muted)]">
            <span>Enrolled:</span>
            <strong className="text-[var(--text)] num">{tooltip.value}</strong>
          </div>
          <div className="flex justify-between gap-4 text-[11px] text-[var(--muted)]">
            <span>Share:</span>
            <strong className="text-[var(--cyan)] num">{tooltip.share}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
