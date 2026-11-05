'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';

export interface BarItem {
  label: string;
  value: number;
  color: string;
  tierName?: string;
}

export interface ReportBarChartProps {
  id?: string;
  data: BarItem[];
  height?: number;
  fmt?: (v: number) => string;
}

// Tooltip helpers matching standard MapWell #tooltip
function showTip(html: string, e: MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  moveTip(e);
}

function moveTip(e: MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t || !e) return;
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  let x = e.clientX + 16;
  let y = e.clientY + 14;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}

function hideTip() {
  const t = document.getElementById('tooltip');
  if (t) t.classList.remove('on');
}

const tipRows = (rows: [string, string][]) =>
  rows.map(([a, b]) => `<div class="tv"><span>${a}</span><span>${b}</span></div>`).join('');

export function ReportBarChart({
  id = 'rp-ch',
  data,
  height = 150,
  fmt = (v: number) => v.toFixed(1)
}: ReportBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 320);
    const H = height;
    const m = { t: 16, r: 8, b: 30, l: 40 };

    const svg = d3.select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H);

    const x = d3.scaleBand()
      .domain(data.map(d => d.label))
      .range([m.l, W - m.r])
      .padding(0.32);

    const maxVal = d3.max(data, d => d.value) || 1;
    const y = d3.scaleLinear()
      .domain([0, maxVal * 1.15])
      .nice()
      .range([H - m.b, m.t]);

    // Grid lines (.gridl)
    svg.append('g')
      .attr('class', 'gridl')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3.axisLeft(y)
          .ticks(4)
          .tickSize(-(W - m.l - m.r))
          .tickFormat(() => '')
      );

    // Left Y Axis (.axis)
    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(
        d3.axisLeft(y)
          .ticks(4)
          .tickFormat(fmt as any)
          .tickSize(0)
      )
      .call(g => g.select('.domain').remove());

    // Bottom X Axis (.axis)
    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(
        d3.axisBottom(x)
          .tickSize(0)
          .tickPadding(8)
      )
      .call(g => g.select('.domain').remove());

    // Rectangular Bars (rect.b)
    const bars = svg.selectAll<SVGRectElement, BarItem>('rect.b')
      .data(data)
      .join('rect')
      .attr('class', 'b')
      .attr('x', d => x(d.label) || 0)
      .attr('width', x.bandwidth())
      .attr('rx', Math.min(2, x.bandwidth() / 3))
      .attr('fill', d => d.color || '#37C8CF')
      .attr('y', y(0))
      .attr('height', 0);

    bars.transition()
      .duration(900)
      .delay((_, i) => i * 70)
      .ease(d3.easeCubicOut)
      .attr('y', d => y(d.value))
      .attr('height', d => Math.max(0, y(0) - y(d.value)));

    // Value Labels above bars (text.val)
    svg.selectAll<SVGTextElement, BarItem>('text.val')
      .data(data)
      .join('text')
      .attr('class', 'val')
      .attr('text-anchor', 'middle')
      .attr('x', d => (x(d.label) || 0) + x.bandwidth() / 2)
      .attr('y', d => y(d.value) - 6)
      .text(d => fmt(d.value))
      .attr('opacity', 0)
      .transition()
      .delay(700)
      .attr('opacity', 1);

    // Hover tooltips on bars
    bars
      .on('pointerenter', function (e: MouseEvent, d) {
        showTip(`<b>${d.tierName || d.label}</b>${tipRows([['Value', fmt(d.value)]])}`, e);
      })
      .on('pointermove', function (e: MouseEvent) {
        moveTip(e);
      })
      .on('pointerleave', function () {
        hideTip();
      });

    return () => {
      hideTip();
    };
  }, [data, height, fmt]);

  return <div id={id} ref={containerRef} className="chart" style={{ width: '100%', height }} />;
}
