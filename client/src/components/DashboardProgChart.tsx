'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';

export interface ProgItem {
  key: string;
  label: string;
  value: number;
}

interface DashboardProgChartProps {
  programs: ProgItem[];
}

export function DashboardProgChart({ programs }: DashboardProgChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !programs.length) return;

    d3.select(el).selectAll('*').remove();

    const W = el.clientWidth || 320;
    const rowH = 38;
    const lw = Math.min(130, W * 0.44);
    const H = programs.length * rowH + 6;

    const svg = d3
      .select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', W)
      .attr('height', H)
      .style('display', 'block')
      .attr('class', 'chart');

    const x = d3.scaleLinear().domain([0, 100]).range([0, W - lw - 54]);

    const row = svg
      .selectAll('g.r')
      .data(programs)
      .join('g')
      .attr('class', 'r')
      .attr('transform', (_, i) => `translate(0, ${i * rowH})`);

    // Left label
    row
      .append('text')
      .attr('class', 'lbl')
      .attr('x', 0)
      .attr('y', rowH / 2 + 4)
      .attr('fill', 'var(--text)')
      .attr('font-size', '12.5px')
      .attr('font-weight', '500')
      .attr('font-family', 'var(--font-u)')
      .text((d) => (d.label.length > 24 ? d.label.slice(0, 23) + '…' : d.label));

    // Background track rect
    row
      .append('rect')
      .attr('x', lw)
      .attr('y', rowH / 2 - 3)
      .attr('height', 6)
      .attr('rx', 1.5)
      .attr('fill', 'var(--surface-2)')
      .attr('width', Math.max(0, W - lw - 54));

    // Animated bar fill
    const bar = row
      .append('rect')
      .attr('x', lw)
      .attr('y', rowH / 2 - 3)
      .attr('height', 6)
      .attr('rx', 1.5)
      .attr('fill', 'var(--cyan)')
      .attr('width', 0);

    bar
      .transition()
      .duration(900)
      .delay((_, i) => i * 60)
      .ease(d3.easeCubicOut)
      .attr('width', (d) => Math.max(0, x(d.value)));

    // Right value readout
    row
      .append('text')
      .attr('class', 'val num')
      .attr('x', W)
      .attr('text-anchor', 'end')
      .attr('y', rowH / 2 + 4)
      .attr('fill', 'var(--text)')
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .attr('font-family', 'var(--font-d)')
      .text((d) => `${Math.round(d.value)}%`);
  }, [programs]);

  return <div ref={containerRef} id="d-prog" style={{ width: '100%', minHeight: '196px' }} />;
}
