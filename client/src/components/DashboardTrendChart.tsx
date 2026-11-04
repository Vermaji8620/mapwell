'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export interface TrendSeriesItem {
  name: string;
  color: string;
  values: number[];
  dash?: string;
  width?: number;
}

interface DashboardTrendChartProps {
  years: string[];
  series: TrendSeriesItem[];
  height?: number;
  formatValue?: (v: number) => string;
}

const defaultFormatValue = (v: number) => v.toFixed(1) + '%';
let gidCounter = 0;

export function DashboardTrendChart({
  years,
  series,
  height = 300,
  formatValue = defaultFormatValue
}: DashboardTrendChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formatValueRef = useRef(formatValue);
  formatValueRef.current = formatValue;

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    year: string;
    items: { name: string; color: string; val: string }[];
  }>({
    visible: false,
    x: 0,
    y: 0,
    year: '',
    items: []
  });

  const yearsKey = years.join(',');
  const seriesKey = JSON.stringify(
    series.map((s) => ({ n: s.name, c: s.color, v: s.values, d: s.dash }))
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !years.length || !series.length) return;

    d3.select(el).selectAll('*').remove();

    const W = el.clientWidth || 440;
    const H = height;
    const m = { t: 14, r: 16, b: 28, l: 44 };

    const svg = d3
      .select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', W)
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible')
      .attr('class', 'chart');

    const x = d3.scalePoint<string>().domain(years).range([m.l, W - m.r]);

    const allVals = series.flatMap((s) => s.values);
    const minVal = d3.min(allVals) ?? 0;
    const maxVal = d3.max(allVals) ?? 20;

    const y = d3
      .scaleLinear()
      .domain([minVal * 0.92, maxVal * 1.06])
      .nice()
      .range([H - m.b, m.t]);

    // Horizontal grid lines
    svg
      .append('g')
      .attr('class', 'gridl')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-(W - m.l - m.r))
          .tickFormat(() => '')
      )
      .call((g) => {
        g.select('.domain').remove();
        g.selectAll('line')
          .attr('stroke', 'var(--line)')
          .attr('stroke-dasharray', '3 4');
      });

    // Left Y Axis
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((d) => formatValueRef.current(d as number))
          .tickSize(0)
      )
      .call((g) => {
        g.select('.domain').remove();
        g.selectAll('text')
          .attr('fill', 'var(--faint)')
          .attr('font-size', '11px')
          .attr('font-family', 'var(--font-u)');
      });

    // Bottom X Axis
    const every = Math.ceil(years.length / Math.max(3, Math.floor(W / 70)));
    const tickYears = years.filter((_, i) => i % every === 0);

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(
        d3
          .axisBottom(x)
          .tickSize(0)
          .tickPadding(8)
          .tickValues(tickYears)
      )
      .call((g) => {
        g.select('.domain').remove();
        g.selectAll('text')
          .attr('fill', 'var(--muted)')
          .attr('font-size', '11px')
          .attr('font-family', 'var(--font-u)');
      });

    const lineGen = d3
      .line<number>()
      .x((_, i) => x(years[i]) ?? 0)
      .y((d) => y(d))
      .curve(d3.curveMonotoneX);

    const areaGen = d3
      .area<number>()
      .x((_, i) => x(years[i]) ?? 0)
      .y0(H - m.b)
      .y1((d) => y(d))
      .curve(d3.curveMonotoneX);

    // Render Series with Transitions
    series.forEach((s, si) => {
      // Area under the first series
      if (si === 0) {
        const gid = `trend-grad-${++gidCounter}`;
        const defs = svg.append('defs');
        const grad = defs
          .append('linearGradient')
          .attr('id', gid)
          .attr('x1', 0)
          .attr('y1', 0)
          .attr('x2', 0)
          .attr('y2', 1);

        grad.append('stop').attr('offset', '0%').attr('stop-color', s.color).attr('stop-opacity', 0.28);
        grad.append('stop').attr('offset', '100%').attr('stop-color', s.color).attr('stop-opacity', 0.0);

        svg
          .append('path')
          .attr('d', areaGen(s.values) ?? '')
          .attr('fill', `url(#${gid})`)
          .attr('opacity', 0)
          .transition()
          .duration(900)
          .delay(400)
          .attr('opacity', 1);
      }

      // Stroke Line
      const path = svg
        .append('path')
        .attr('d', lineGen(s.values) ?? '')
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', s.width || 2.4)
        .attr('stroke-dasharray', s.dash || null)
        .attr('stroke-linecap', 'round');

      // Animate line stroke draw-in on mount / data change
      if (!s.dash) {
        const node = path.node();
        if (node) {
          const totalLen = node.getTotalLength();
          path
            .attr('stroke-dasharray', `${totalLen} ${totalLen}`)
            .attr('stroke-dashoffset', totalLen)
            .transition()
            .duration(1300)
            .delay(si * 160)
            .ease(d3.easeCubicInOut)
            .attr('stroke-dashoffset', 0);
        }
      }
    });

    // Hover elements: vertical crosshair line & tracking circles
    const crosshair = svg
      .append('line')
      .attr('y1', m.t)
      .attr('y2', H - m.b)
      .attr('stroke', 'var(--line-strong)')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3')
      .attr('opacity', 0)
      .style('pointer-events', 'none');

    const dots = series.map((s) =>
      svg
        .append('circle')
        .attr('r', 4.5)
        .attr('fill', s.color)
        .attr('stroke', 'var(--surface-solid)')
        .attr('stroke-width', 2)
        .attr('opacity', 0)
        .style('pointer-events', 'none')
    );

    // Transparent interactive overlay rect
    svg
      .append('rect')
      .attr('x', m.l)
      .attr('y', m.t)
      .attr('width', W - m.l - m.r)
      .attr('height', H - m.t - m.b)
      .attr('fill', 'transparent')
      .style('cursor', 'default')
      .on('pointermove', function (e) {
        const [mx] = d3.pointer(e);
        const step = x.step();
        const rawIdx = Math.round((mx - m.l) / step);
        const idx = Math.max(0, Math.min(rawIdx, years.length - 1));

        const targetX = x(years[idx]) ?? 0;

        crosshair.attr('x1', targetX).attr('x2', targetX).attr('opacity', 1);

        dots.forEach((dot, si) => {
          const val = series[si]?.values[idx] ?? 0;
          dot.attr('cx', targetX).attr('cy', y(val)).attr('opacity', 1);
        });

        const rect = el.getBoundingClientRect();
        const tooltipItems = series.map((s) => ({
          name: s.name,
          color: s.color,
          val: formatValueRef.current(s.values[idx] ?? 0)
        }));

        setTooltip({
          visible: true,
          x: targetX,
          y: Math.max(10, e.clientY - rect.top - 50),
          year: years[idx],
          items: tooltipItems
        });
      })
      .on('pointerleave', function () {
        crosshair.attr('opacity', 0);
        dots.forEach((dot) => dot.attr('opacity', 0));
        setTooltip((prev) => ({ ...prev, visible: false }));
      });
  }, [yearsKey, seriesKey, height]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: `${height}px`, position: 'relative' }}>
      {tooltip.visible && (
        <div
          style={{
            position: 'absolute',
            left: `${Math.min(tooltip.x + 10, (containerRef.current?.clientWidth || 400) - 160)}px`,
            top: `${tooltip.y}px`,
            background: 'var(--surface-solid)',
            border: '1px solid var(--line-strong)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow)',
            padding: '8px 12px',
            fontSize: '11.5px',
            pointerEvents: 'none',
            zIndex: 40,
            color: 'var(--text)',
            minWidth: '130px',
            userSelect: 'none'
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>{tooltip.year}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {tooltip.items.map((it, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)', fontSize: '11px' }}>
                  <i style={{ width: '7px', height: '7px', borderRadius: '50%', background: it.color, display: 'inline-block' }} />
                  {it.name}
                </span>
                <b className="num" style={{ color: 'var(--text)', fontSize: '11.5px' }}>{it.val}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
