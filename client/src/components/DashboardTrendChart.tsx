'use client';

import React, { useRef, useEffect } from 'react';
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
  metricKey?: string;
}

const defaultFormatValue = (v: number) => v.toFixed(1) + '%';
let _gid = 0;

function resolveColor(c: string): string {
  if (!c) return '#0090C2';
  if (c.startsWith('var(')) {
    const varName = c.slice(4, -1).trim();
    if (typeof window !== 'undefined') {
      try {
        const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (val) return val;
      } catch (err) {}
    }
    if (varName === '--cyan') return '#0090C2';
    if (varName === '--teal') return '#079A7E';
    if (varName === '--violet') return '#6A55E8';
    if (varName === '--rose') return '#E0336A';
    if (varName === '--amber') return '#C9810A';
  }
  return c;
}

function showTip(html: string, e: MouseEvent) {
  let t = document.getElementById('tooltip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'tooltip';
    document.body.appendChild(t);
  }
  t.innerHTML = html;
  t.style.opacity = '1';
  t.style.display = 'block';
  t.style.position = 'fixed';
  t.style.zIndex = '300';
  t.style.pointerEvents = 'none';
  moveTip(e);
}

function moveTip(e: MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t) return;
  const x = Math.min(window.innerWidth - 270, e.clientX + 14);
  const y = Math.min(window.innerHeight - 120, e.clientY + 14);
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}

function hideTip() {
  const t = document.getElementById('tooltip');
  if (t) {
    t.style.opacity = '0';
    t.style.display = 'none';
  }
}

export function DashboardTrendChart({
  years,
  series,
  height = 300,
  formatValue = defaultFormatValue,
  metricKey
}: DashboardTrendChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formatValueRef = useRef(formatValue);
  formatValueRef.current = formatValue;
  const lastRenderedKeyRef = useRef<string>('');

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !years.length || !series.length) return;

    // Check if valid numerical values exist in all series
    const hasValues = series.every(
      (s) => Array.isArray(s.values) && s.values.length > 0 && s.values.every((v) => typeof v === 'number' && !isNaN(v))
    );
    if (!hasValues) return;

    // Deduplicate re-draws on page startup / refresh: only draw once per unique metricKey
    const activeKey =
      metricKey ||
      `${years[0]}_${years[years.length - 1]}_${series.map((s) => s.name).join('_')}_${series[0]?.values?.[series[0].values.length - 1] ?? 0}`;

    if (lastRenderedKeyRef.current === activeKey) {
      return;
    }
    lastRenderedKeyRef.current = activeKey;

    // Clear previous drawing completely: re-draw clean lines with authentic left-to-right drawing animation
    d3.select(el).selectAll('*').remove();

    const W = Math.max(200, el.clientWidth || 440);
    const H = height;
    const m = { t: 14, r: 14, b: 28, l: 44 };
    const f = (v: number) => formatValueRef.current(v);

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
    const all = series.flatMap((s) => s.values);
    const minVal = d3.min(all) ?? 0;
    const maxVal = d3.max(all) ?? 20;

    const y = d3
      .scaleLinear()
      .domain([minVal * 0.92, maxVal * 1.06])
      .nice()
      .range([H - m.b, m.t]);

    // Horizontal gridlines: 4 ticks, stroke: var(--line), stroke-dasharray: 3 4, .domain removed
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

    // Left Y Axis: 4 ticks, formatted, .domain removed
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((d) => f(d as number))
          .tickSize(0)
      )
      .call((g) => {
        g.select('.domain').remove();
        g.selectAll('text')
          .attr('fill', 'var(--faint)')
          .attr('font-size', '11px')
          .attr('font-family', 'var(--font-u)');
      });

    // Bottom X Axis: tickSize 0, tickPadding 8, .domain removed
    const every = Math.ceil(years.length / Math.max(3, Math.floor(W / 70)));
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(
        d3
          .axisBottom(x)
          .tickSize(0)
          .tickPadding(8)
          .tickValues(years.filter((_, i) => i % every === 0))
      )
      .call((g) => {
        g.select('.domain').remove();
        g.selectAll('text')
          .attr('fill', 'var(--muted)')
          .attr('font-size', '11px')
          .attr('font-family', 'var(--font-u)');
      });

    // Natural monotone curves: d3.curveMonotoneX
    const line = d3
      .line<number>()
      .x((_, i) => x(years[i]) ?? 0)
      .y((d) => y(d))
      .curve(d3.curveMonotoneX);

    const area = d3
      .area<number>()
      .x((_, i) => x(years[i]) ?? 0)
      .y0(H - m.b)
      .y1((d) => y(d))
      .curve(d3.curveMonotoneX);

    // Render Series with left-to-right drawing animation and area fill matching prototype
    series.forEach((s, si) => {
      const colorVal = resolveColor(s.color);

      // Area gradient fill under County line (series 0)
      if (si === 0) {
        const gid = 'a' + ++_gid;
        const gr = svg
          .append('defs')
          .append('linearGradient')
          .attr('id', gid)
          .attr('x1', 0)
          .attr('y1', 0)
          .attr('x2', 0)
          .attr('y2', 1);

        gr.append('stop')
          .attr('offset', '0%')
          .attr('stop-color', colorVal)
          .attr('stop-opacity', 0.3);

        gr.append('stop')
          .attr('offset', '100%')
          .attr('stop-color', colorVal)
          .attr('stop-opacity', 0);

        svg
          .append('path')
          .attr('class', 'area-path')
          .attr('d', area(s.values) ?? '')
          .attr('fill', `url(#${gid})`)
          .attr('opacity', 0)
          .transition()
          .duration(900)
          .delay(500)
          .attr('opacity', 1);
      }

      // Trajectory stroke path: solid, stroke-width 2.4px, stroke-linecap round
      const p = svg
        .append('path')
        .attr('class', `line-path-${si}`)
        .attr('d', line(s.values) ?? '')
        .attr('fill', 'none')
        .attr('stroke', colorVal)
        .style('stroke', colorVal)
        .attr('stroke-width', s.width || 2.4)
        .style('stroke-width', `${s.width || 2.4}px`)
        .attr('stroke-linecap', 'round');

      if (s.dash) {
        p.attr('stroke-dasharray', s.dash);
      } else {
        const node = p.node();
        let L = 0;
        try {
          L = node ? node.getTotalLength() : 0;
        } catch (err) {
          L = 0;
        }

        if (L > 10) {
          p.attr('stroke-dasharray', `${L} ${L}`)
            .attr('stroke-dashoffset', L)
            .transition()
            .duration(1300)
            .delay(si * 160)
            .ease(d3.easeCubicInOut)
            .attr('stroke-dashoffset', 0)
            .on('end', function () {
              d3.select(this).attr('stroke-dasharray', null).attr('stroke-dashoffset', null);
            });
        } else {
          p.attr('stroke-dasharray', null).attr('stroke-dashoffset', null);
        }
      }
    });

    // Hover crosshair and snapping circle dots
    const crosshairG = svg.append('g').attr('class', 'crosshair-g').style('pointer-events', 'none');
    const hl = crosshairG
      .append('line')
      .attr('y1', m.t)
      .attr('y2', H - m.b)
      .attr('stroke', 'var(--line-strong)')
      .attr('opacity', 0);

    const dots = series.map((s) => {
      const colorVal = resolveColor(s.color);
      return crosshairG
        .append('circle')
        .attr('r', 4.5)
        .attr('fill', colorVal)
        .style('fill', colorVal)
        .attr('stroke', 'var(--surface-solid)')
        .attr('stroke-width', 2)
        .attr('opacity', 0);
    });

    // Transparent overlay for cursor interaction
    svg
      .append('rect')
      .attr('x', m.l)
      .attr('y', m.t)
      .attr('width', W - m.l - m.r)
      .attr('height', H - m.t - m.b)
      .attr('fill', 'transparent')
      .on('pointermove', function (e) {
        const [mx] = d3.pointer(e);
        const step = x.step ? x.step() : (W - m.l - m.r) / Math.max(1, years.length - 1);
        const i = Math.max(0, Math.min(years.length - 1, Math.round((mx - m.l) / step)));
        const yearVal = years[i];
        const posX = x(yearVal) ?? m.l;

        hl.attr('x1', posX).attr('x2', posX).attr('opacity', 1);

        dots.forEach((d, si) => {
          if (series[si]?.values?.[i] !== undefined) {
            d.attr('cx', posX)
              .attr('cy', y(series[si].values[i]))
              .attr('opacity', 1);
          }
        });

        const tipRowsHtml = series
          .map(
            (s) =>
              `<div class="tv"><span>${s.name}</span><span>${f(s.values[i])}</span></div>`
          )
          .join('');

        showTip(`<b>${yearVal}</b>${tipRowsHtml}`, e);
      })
      .on('pointerleave', function () {
        hl.attr('opacity', 0);
        dots.forEach((d) => d.attr('opacity', 0));
        hideTip();
      });
  }, [years, series, height]);

  // Clean up tooltip on unmount
  useEffect(() => {
    return () => {
      hideTip();
    };
  }, []);

  return <div ref={containerRef} id="d-trend" style={{ position: 'relative', width: '100%', height }} />;
}
