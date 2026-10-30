'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface LorenzCurveProps {
  pairs: [number, number][]; // [cumPopShare, cumBurdenShare]
  height?: number;
}

export function LorenzCurve({ pairs, height = 240 }: LorenzCurveProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || pairs.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 360;
    const margin = { top: 12, right: 14, bottom: 28, left: 42 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('class', 'overflow-visible');

    const defs = svg.append('defs');
    const gid = `lorenz-grad-${Math.random().toString(36).substring(2, 7)}`;
    const gr = defs.append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 1);
    gr.append('stop').attr('offset', '0%').attr('stop-color', '#F43F5E').attr('stop-opacity', 0.4);
    gr.append('stop').attr('offset', '100%').attr('stop-color', '#8B5CF6').attr('stop-opacity', 0.1);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, 1]).range([0, chartW]);
    const y = d3.scaleLinear().domain([0, 1]).range([chartH, 0]);

    // Gridlines
    g.append('g')
      .selectAll('line.grid-line')
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
      .text(d => `${Math.round(d * 100)}%`);

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
      .text(d => `${Math.round(d * 100)}%`);

    // 45-degree Equality Baseline (dashed)
    g.append('line')
      .attr('x1', x(0))
      .attr('y1', y(0))
      .attr('x2', x(1))
      .attr('y2', y(1))
      .attr('stroke', 'var(--line-strong, rgba(255,255,255,0.25))')
      .attr('stroke-dasharray', '4 4')
      .attr('stroke-width', 1.2);

    // Area under concentration curve
    const area = d3.area<[number, number]>()
      .x(d => x(d[0]))
      .y0(d => y(d[0])) // relative to 45 degree line
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(pairs)
      .attr('d', area)
      .attr('fill', `url(#${gid})`);

    // Lorenz line curve
    const line = d3.line<[number, number]>()
      .x(d => x(d[0]))
      .y(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(pairs)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', '#F43F5E')
      .attr('stroke-width', 2.2);

  }, [pairs, height]);

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
