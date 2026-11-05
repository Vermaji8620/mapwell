'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export interface SeriesItem {
  name: string;
  color: string;
  values: number[];
}

export interface GroupedBarChartProps {
  categories: string[];
  series: SeriesItem[];
  height?: number;
  format?: (v: number) => string;
}

function GroupedBarChartComponent({
  categories,
  series,
  height = 250,
  format = (v: number) => `${v.toFixed(0)}%`
}: GroupedBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevDataKeyRef = useRef<string>('');
  const dataKey = JSON.stringify({ categories, series, height });

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
    if (!containerRef.current || series.length === 0 || categories.length === 0) return;
    const container = containerRef.current;

    // Preserve existing graph if data has not changed
    if (prevDataKeyRef.current === dataKey && container.querySelector('svg')) {
      return;
    }
    prevDataKeyRef.current = dataKey;

    container.innerHTML = '';

    const W = container.clientWidth || 550;
    const H = height;
    const m = { t: 14, r: 12, b: 30, l: 44 };

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('class', 'overflow-visible');

    const x0 = d3.scaleBand()
      .domain(categories)
      .range([m.l, W - m.r])
      .padding(0.22);

    const x1 = d3.scaleBand()
      .domain(series.map((s, idx) => `s_${idx}_${s.name}`))
      .range([0, x0.bandwidth()])
      .padding(0.12);

    const allValues = series.flatMap(s => s.values);
    const maxVal = d3.max(allValues) || 20;
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.15])
      .nice()
      .range([H - m.b, m.t]);

    // Horizontal gridlines
    svg.append('g')
      .attr('class', 'gridl')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3.axisLeft(y)
          .ticks(4)
          .tickSize(-(W - m.l - m.r))
          .tickFormat(() => '')
      )
      .call(g => {
        g.select('.domain').remove();
        g.selectAll('line')
          .attr('stroke', 'var(--line, rgba(255,255,255,0.08))')
          .attr('stroke-dasharray', '3 4');
      });

    // Left Y Axis
    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3.axisLeft(y)
          .ticks(4)
          .tickFormat(d => format(+d))
          .tickSize(0)
      )
      .call(g => {
        g.select('.domain').remove();
        g.selectAll('text')
          .attr('fill', 'var(--faint, rgba(255,255,255,0.45))')
          .attr('font-size', '10.5px')
          .attr('font-family', 'var(--font-m, monospace)');
      });

    // Bottom X Axis
    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(
        d3.axisBottom(x0)
          .tickSize(0)
          .tickPadding(8)
      )
      .call(g => {
        g.select('.domain').remove();
        g.selectAll('text')
          .attr('fill', 'var(--muted, rgba(255,255,255,0.65))')
          .attr('font-size', '11px')
          .attr('font-weight', '600');
      });

    // Bars
    series.forEach((s, si) => {
      const sKey = `s_${si}_${s.name}`;
      const rects = svg.append('g')
        .selectAll('rect')
        .data(s.values)
        .join('rect')
        .attr('x', (_, i) => (x0(categories[i]) || 0) + (x1(sKey) || 0))
        .attr('width', x1.bandwidth())
        .attr('rx', Math.min(2.5, x1.bandwidth() / 3))
        .attr('fill', s.color)
        .attr('y', y(0))
        .attr('height', 0)
        .attr('cursor', 'pointer');

      rects.transition()
        .duration(850)
        .delay((_, i) => i * 70 + si * 100)
        .ease(d3.easeCubicOut)
        .attr('y', d => y(d))
        .attr('height', d => Math.max(0, y(0) - y(d)));

      rects.on('pointerenter', (event, d) => {
        const i = s.values.indexOf(d);
        const rect = container.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - rect.left + 10,
          y: event.clientY - rect.top - 15,
          category: categories[i] || '',
          tractName: s.name,
          val: format(d),
          color: s.color
        });
      })
      .on('pointermove', (event) => {
        const rect = container.getBoundingClientRect();
        setTooltip(prev => ({
          ...prev,
          x: event.clientX - rect.left + 10,
          y: event.clientY - rect.top - 15
        }));
      })
      .on('pointerleave', () => {
        setTooltip(prev => ({ ...prev, visible: false }));
      });
    });

  }, [categories, series, height, format]);

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full chart" />

      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-1.5 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left animate-in fade-in duration-100"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="text-[10.5px] font-bold text-[var(--muted)]">{tooltip.category}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tooltip.color }} />
            <span className="text-[12px] font-bold text-[var(--text)]">{tooltip.tractName}</span>
            <span className="text-[12px] font-bold text-[var(--cyan)] num ml-2">{tooltip.val}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export const GroupedBarChart = React.memo(GroupedBarChartComponent);
