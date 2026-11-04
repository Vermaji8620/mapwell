'use client';

import React, { useEffect, useState, useMemo, useRef, Suspense } from 'react';
import * as d3 from 'd3';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Jurisdiction, Assessment } from '@/types';
import { Icon } from '@/components/Icons';

/* =====================================================================
   PROTOTYPE METRICS & CONSTANTS
   ===================================================================== */
const INDS = ['diabetes', 'hypertension', 'asthma', 'obesity', 'uninsured', 'lifeExp'];
const REGIONS = ['Northeast', 'Midwest', 'South', 'West'];
const TIER_COLOR = ['#9FE3E7', '#5CCAD2', '#66B6F5', '#2584EB', '#163E8C'];
const TIER_LABEL = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
const YEARS = d3.range(2016, 2026).map(String);

interface MetricConfig {
  label: string;
  short: string;
  f: (v: number) => string;
  bad: 'high' | 'low';
  unit?: string;
}

const METRICS: Record<string, MetricConfig> = {
  diabetes: { label: 'Diagnosed diabetes prevalence', short: 'Diabetes', f: v => v.toFixed(1) + '%', bad: 'high' },
  hypertension: { label: 'High blood pressure prevalence', short: 'Hypertension', f: v => v.toFixed(1) + '%', bad: 'high' },
  asthma: { label: 'Current asthma prevalence', short: 'Asthma', f: v => v.toFixed(1) + '%', bad: 'high' },
  obesity: { label: 'Adult obesity prevalence', short: 'Obesity', f: v => v.toFixed(1) + '%', bad: 'high' },
  uninsured: { label: 'Adults without health insurance', short: 'Uninsured', f: v => v.toFixed(1) + '%', bad: 'high' },
  lifeExp: { label: 'Life expectancy at birth', short: 'Life expectancy', f: v => v.toFixed(1) + ' yrs', bad: 'low' },
  svi: { label: 'Social vulnerability index', short: 'Vulnerability', f: v => v.toFixed(2), bad: 'high', unit: '' },
  poverty: { label: 'Population below poverty line', short: 'Poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  access: { label: 'Healthcare access score', short: 'Access score', f: v => v.toFixed(0), bad: 'low', unit: '/100' }
};

/* =====================================================================
   MATHEMATICAL & FORMATTING HELPERS
   ===================================================================== */
function esc(s: any): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function getV(rec: any, key: string): number {
  if (!rec) return 0;
  if (key.startsWith('prog.')) {
    const pk = key.slice(5);
    return Number(rec.prog?.[pk] ?? rec.indicators?.programs?.[pk] ?? 0);
  }
  const val = rec[key] ?? rec.indicators?.[key];
  const num = Number(val);
  return isNaN(num) ? 0 : num;
}

function countyLabel(c: any): string {
  if (!c) return '';
  const name = c.name || '';
  const st = c.stateAbbr || c.st || c.state?.abbr || '';
  const clean = name.replace(/\s+County$/i, '');
  return `${clean} County, ${st}`;
}

const wmean = (arr: any[], k: string): number => {
  const totPop = d3.sum(arr, u => (u.pop || u.population || 4000));
  return totPop > 0 ? d3.sum(arr, u => getV(u, k) * (u.pop || u.population || 4000)) / totPop : 0;
};

function quintiles(units: any[], key = 'svi'): any[][] {
  const s = units.slice().sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0));
  const n = s.length;
  return [0, 1, 2, 3, 4].map(i => s.slice(Math.floor((i * n) / 5), Math.floor(((i + 1) * n) / 5)));
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1e6) / 1e6;
}

function rng(seed: number): () => number {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

function trendFor(seed: string, end: number, n = 10, slope = 0.015): number[] {
  const r = rng(hash(seed));
  const out: number[] = [];
  let v = end * (1 + slope * n * (r() > 0.3 ? 1 : -0.5));
  for (let i = 0; i < n; i++) {
    v = v + (end - v) / (n - i) + gauss(r) * end * 0.012;
    out.push(v);
  }
  out[n - 1] = end;
  return out;
}

function cvar(n: string): string {
  if (typeof window !== 'undefined') {
    const val = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    if (val) return val;
  }
  if (n === '--cyan') return '#2584EB';
  if (n === '--violet') return '#66B6F5';
  if (n === '--teal') return '#37C8CF';
  if (n === '--rose') return '#F06A75';
  if (n === '--amber') return '#F2B33D';
  if (n === '--surface-2') return '#EEF6FD';
  return '#2584EB';
}

/* =====================================================================
   TOOLTIP HELPERS MATCHING PROTOTYPE
   ===================================================================== */
function showTip(html: string, e: any) {
  if (typeof document === 'undefined') return;
  const t = document.getElementById('tooltip');
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  moveTip(e);
}

function moveTip(e: any) {
  if (typeof document === 'undefined') return;
  const t = document.getElementById('tooltip');
  if (!t || !e) return;
  const w = t.offsetWidth,
    h = t.offsetHeight;
  let x = e.clientX + 16,
    y = e.clientY + 14;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}

function hideTip() {
  if (typeof document === 'undefined') return;
  const t = document.getElementById('tooltip');
  if (t) t.classList.remove('on');
}

const tipRows = (rows: [string, string | number][]) =>
  rows.map(([a, b]) => `<div class="tv"><span>${a}</span><span>${b}</span></div>`).join('');

let _gid = 0;
function svgIn(el: HTMLElement, w: number, h: number) {
  return d3.select(el).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);
}

/* =====================================================================
   EXACT D3 CHART DRAWING FUNCTIONS FROM entire_website.html
   ===================================================================== */
function barChart(el: HTMLElement, data: any[], o: any = {}) {
  const W = Math.max(200, el.clientWidth);
  el.classList.add('chart');
  el.innerHTML = '';
  const f = o.fmt || ((v: number) => v.toFixed(1));
  const horiz = o.horizontal;

  if (horiz) {
    const rowH = o.rowH || 30;
    const lw = Math.min(o.labelW || 150, W * 0.42);
    const H = data.length * rowH + 6;
    const svg = svgIn(el, W, H);
    const maxVal = o.max || (d3.max(data, d => d.value) || 10) * 1.08;
    const x = d3.scaleLinear().domain([0, maxVal]).range([0, W - lw - 64]);
    const fill = cvar('--cyan');
    const row = svg
      .selectAll('g.r')
      .data(data)
      .join('g')
      .attr('transform', (_d, i) => `translate(0,${i * rowH})`);

    row
      .append('text')
      .attr('class', 'lbl')
      .attr('x', 0)
      .attr('y', rowH / 2 + 4)
      .text(d => (d.label.length > 24 ? d.label.slice(0, 23) + '…' : d.label));

    row
      .append('rect')
      .attr('x', lw)
      .attr('y', rowH / 2 - 3)
      .attr('height', 6)
      .attr('rx', 1)
      .attr('fill', 'var(--surface-2)')
      .attr('width', Math.max(0, W - lw - 64));

    row
      .append('rect')
      .attr('x', lw)
      .attr('y', rowH / 2 - 3)
      .attr('height', 6)
      .attr('rx', 1)
      .attr('fill', d => d.color || fill)
      .attr('width', d => Math.max(0, x(d.value)));

    row
      .append('text')
      .attr('class', 'val')
      .attr('x', W)
      .attr('text-anchor', 'end')
      .attr('y', rowH / 2 + 4)
      .text(d => f(d.value));

    if (o.onClick) {
      row.style('cursor', 'pointer').on('click', (_e, d) => o.onClick(d));
    }
    return;
  }

  const H = o.h || 220;
  const m = { t: 16, r: 8, b: 30, l: 40 };
  const svg = svgIn(el, W, H);
  const x = d3
    .scaleBand()
    .domain(data.map(d => d.label))
    .range([m.l, W - m.r])
    .padding(0.32);
  const maxVal = o.max || (d3.max(data, d => d.value) || 10) * 1.15;
  const y = d3.scaleLinear().domain([0, maxVal]).nice().range([H - m.b, m.t]);

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
    );

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(${m.l},0)`)
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickFormat(o.axisFmt || f)
        .tickSize(0)
    )
    .call(g => g.select('.domain').remove());

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(8))
    .call(g => g.select('.domain').remove());

  const fill = cvar('--cyan');
  const b = svg
    .selectAll('rect.b')
    .data(data)
    .join('rect')
    .attr('class', 'b')
    .attr('x', d => x(d.label) || 0)
    .attr('width', x.bandwidth())
    .attr('rx', Math.min(2, x.bandwidth() / 3))
    .attr('fill', d => d.color || fill)
    .attr('y', d => y(d.value))
    .attr('height', d => Math.max(0, y(0) - y(d.value)));

  svg
    .selectAll('text.v')
    .data(data)
    .join('text')
    .attr('class', 'val')
    .attr('text-anchor', 'middle')
    .attr('x', d => (x(d.label) || 0) + x.bandwidth() / 2)
    .attr('y', d => y(d.value) - 6)
    .text(d => f(d.value));

  b.on('pointerenter', (e, d: any) =>
    showTip(`<b>${esc(d.label)}</b>${tipRows([[o.name || 'Value', f(d.value)]])}`, e)
  )
    .on('pointermove', moveTip)
    .on('pointerleave', hideTip);
}

function lorenz(el: HTMLElement, pairs: [number, number][], o: any = {}) {
  const W = Math.max(200, el.clientWidth);
  el.classList.add('chart');
  el.innerHTML = '';
  const H = o.h || 240;
  const m = { t: 12, r: 12, b: 30, l: 40 };
  const svg = svgIn(el, W, H);
  const x = d3.scaleLinear().domain([0, 1]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);

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
    );

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(${m.l},0)`)
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickFormat((d: any) => d3.format('.0%')(d))
        .tickSize(0)
    )
    .call(g => g.select('.domain').remove());

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${H - m.b})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(5)
        .tickFormat((d: any) => d3.format('.0%')(d))
        .tickSize(0)
        .tickPadding(8)
    )
    .call(g => g.select('.domain').remove());

  svg
    .append('line')
    .attr('x1', x(0))
    .attr('y1', y(0))
    .attr('x2', x(1))
    .attr('y2', y(1))
    .attr('stroke', 'var(--line-strong)')
    .attr('stroke-dasharray', '4 4');

  const gid = 'l' + ++_gid;
  const gr = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 1);
  gr.append('stop').attr('offset', 0).attr('stop-color', cvar('--rose')).attr('stop-opacity', 0.35);
  gr.append('stop').attr('offset', 1).attr('stop-color', cvar('--violet')).attr('stop-opacity', 0.1);

  const ar = d3
    .area<[number, number]>()
    .x(d => x(d[0]))
    .y0(d => y(d[0]))
    .y1(d => y(d[1]))
    .curve(d3.curveMonotoneX);

  svg.append('path').attr('d', ar(pairs) || '').attr('fill', `url(#${gid})`);

  svg
    .append('path')
    .attr(
      'd',
      d3
        .line<[number, number]>()
        .x(d => x(d[0]))
        .y(d => y(d[1]))
        .curve(d3.curveMonotoneX)(pairs) || ''
    )
    .attr('fill', 'none')
    .attr('stroke', cvar('--rose'))
    .attr('stroke-width', 2.6);

  if (o.xl) {
    svg
      .append('text')
      .attr('class', 'lbl')
      .attr('x', W - m.r)
      .attr('y', H - 2)
      .attr('text-anchor', 'end')
      .text(o.xl);
  }
}

function matrix(el: HTMLElement, rows: string[], cols: string[], Z: number[][], o: any = {}) {
  const W = Math.max(200, el.clientWidth);
  el.classList.add('chart');
  el.innerHTML = '';
  const lw = Math.min(150, W * 0.3);
  const cw = (W - lw) / cols.length;
  const ch = o.ch || 30;
  const H = rows.length * ch + 34;
  const svg = svgIn(el, W, H);
  const f = o.fmt || ((v: number) => (v > 0 ? '+' : '') + v.toFixed(2));
  const c2 = (v: number) => {
    const t = clamp((v + 1.6) / 3.2, 0, 1);
    return d3.piecewise(d3.interpolateRgb, [cvar('--teal'), cvar('--surface-2') || '#223', cvar('--rose')])(t);
  };

  cols.forEach((c, j) =>
    svg
      .append('text')
      .attr('class', 'lbl')
      .attr('x', lw + j * cw + cw / 2)
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .text(c.length > 12 && cw < 90 ? c.slice(0, 10) + '…' : c)
  );

  rows.forEach((r, i) => {
    svg
      .append('text')
      .attr('class', 'lbl')
      .attr('x', 0)
      .attr('y', 34 + i * ch + ch / 2 + 2)
      .text(r);

    cols.forEach((c, j) => {
      const v = Z[i]?.[j] ?? 0;
      const rc = svg
        .append('rect')
        .attr('x', lw + j * cw + 2)
        .attr('y', 26 + i * ch + 2)
        .attr('width', Math.max(0, cw - 4))
        .attr('height', Math.max(0, ch - 4))
        .attr('rx', 2)
        .attr('fill', c2(v));

      rc.on('pointerenter', e => showTip(`<b>${esc(r)}</b>${tipRows([[c, f(v) + ' SD vs national']])}`, e))
        .on('pointermove', moveTip)
        .on('pointerleave', hideTip);

      if (cw > 46) {
        svg
          .append('text')
          .attr('class', 'val')
          .attr('x', lw + j * cw + cw / 2)
          .attr('y', 26 + i * ch + ch / 2 + 4)
          .attr('text-anchor', 'middle')
          .style('font-size', '11px')
          .text(f(v))
          .style('pointer-events', 'none');
      }
    });
  });
}

function lineChart(el: HTMLElement, xs: string[], series: any[], o: any = {}) {
  const W = Math.max(200, el.clientWidth);
  el.classList.add('chart');
  el.innerHTML = '';
  const H = o.h || 230;
  const m = { t: 14, r: 14, b: 28, l: 44 };
  const f = o.fmt || ((v: number) => v.toFixed(1));
  const svg = svgIn(el, W, H);
  const x = d3.scalePoint().domain(xs).range([m.l, W - m.r]);
  const all = series.flatMap(s => s.values);
  const minVal = d3.min(all) || 0;
  const maxVal = d3.max(all) || 10;
  const y = d3
    .scaleLinear()
    .domain(o.domain || [minVal * 0.92, maxVal * 1.06])
    .nice()
    .range([H - m.b, m.t]);

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
    );

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(f).tickSize(0))
    .call(g => g.select('.domain').remove());

  const every = Math.ceil(xs.length / Math.max(3, Math.floor(W / 70)));
  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${H - m.b})`)
    .call(
      d3
        .axisBottom(x)
        .tickSize(0)
        .tickPadding(8)
        .tickValues(xs.filter((_d, i) => i % every === 0))
    )
    .call(g => g.select('.domain').remove());

  const line = d3
    .line<number>()
    .x((_d, i) => x(xs[i]) || 0)
    .y(d => y(d))
    .curve(d3.curveMonotoneX);

  const area = d3
    .area<number>()
    .x((_d, i) => x(xs[i]) || 0)
    .y0(H - m.b)
    .y1(d => y(d))
    .curve(d3.curveMonotoneX);

  series.forEach((s, si) => {
    if (o.area !== false && si === 0) {
      const gid = 'a' + ++_gid;
      const gr = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
      gr.append('stop').attr('offset', 0).attr('stop-color', s.color).attr('stop-opacity', 0.3);
      gr.append('stop').attr('offset', 1).attr('stop-color', s.color).attr('stop-opacity', 0);
      svg.append('path').attr('d', area(s.values) || '').attr('fill', `url(#${gid})`);
    }

    svg
      .append('path')
      .attr('d', line(s.values) || '')
      .attr('fill', 'none')
      .attr('stroke', s.color)
      .attr('stroke-width', s.width || 2.4)
      .attr('stroke-dasharray', s.dash || null)
      .attr('stroke-linecap', 'round');
  });

  // hover crosshair
  const hl = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', 'var(--line-strong)').attr('opacity', 0);
  const dots = series.map(s =>
    svg
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', s.color)
      .attr('stroke', 'var(--surface-solid)')
      .attr('stroke-width', 2)
      .attr('opacity', 0)
  );

  svg
    .append('rect')
    .attr('x', m.l)
    .attr('y', m.t)
    .attr('width', Math.max(0, W - m.l - m.r))
    .attr('height', Math.max(0, H - m.t - m.b))
    .attr('fill', 'transparent')
    .on('pointermove', e => {
      const [mx] = d3.pointer(e);
      const step = x.step();
      const i = clamp(Math.round((mx - m.l) / step), 0, xs.length - 1);
      const xPos = x(xs[i]) || 0;
      hl.attr('x1', xPos).attr('x2', xPos).attr('opacity', 1);
      dots.forEach((d, si) => d.attr('cx', xPos).attr('cy', y(series[si].values[i])).attr('opacity', 1));
      showTip(`<b>${esc(xs[i])}</b>${tipRows(series.map(s => [s.name, f(s.values[i])]))}`, e);
    })
    .on('pointerleave', () => {
      hl.attr('opacity', 0);
      dots.forEach(d => d.attr('opacity', 0));
      hideTip();
    });
}

function scatter(el: HTMLElement, pts: any[], o: any = {}) {
  const W = Math.max(200, el.clientWidth);
  el.classList.add('chart');
  el.innerHTML = '';
  const H = o.h || 260;
  const m = { t: 12, r: 14, b: 34, l: 46 };
  const svg = svgIn(el, W, H);
  const xExt = d3.extent(pts, (d: any) => d.x) as [number, number];
  const yExt = d3.extent(pts, (d: any) => d.y) as [number, number];
  const x = d3.scaleLinear().domain([xExt[0] ?? 0, xExt[1] ?? 1]).nice().range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([yExt[0] ?? 0, yExt[1] ?? 10]).nice().range([H - m.b, m.t]);

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
    );

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(${m.l},0)`)
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickFormat(o.fy || ((v: any) => v))
        .tickSize(0)
    )
    .call(g => g.select('.domain').remove());

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${H - m.b})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(5)
        .tickFormat(o.fx || ((v: any) => v))
        .tickSize(0)
        .tickPadding(8)
    )
    .call(g => g.select('.domain').remove());

  if (o.xl) {
    svg
      .append('text')
      .attr('class', 'lbl')
      .attr('x', W - m.r)
      .attr('y', H - 2)
      .attr('text-anchor', 'end')
      .text(o.xl);
  }
  if (o.yl) {
    svg
      .append('text')
      .attr('class', 'lbl')
      .attr('x', m.l + 4)
      .attr('y', m.t + 2)
      .text(o.yl);
  }

  // Regression line
  const n = pts.length;
  const mx = d3.mean(pts, d => d.x) || 0;
  const my = d3.mean(pts, d => d.y) || 0;
  const den = d3.sum(pts, d => (d.x - mx) ** 2) || 1;
  const b = d3.sum(pts, d => (d.x - mx) * (d.y - my)) / den;
  const a = my - b * mx;
  const [xa, xb] = x.domain();

  svg
    .append('line')
    .attr('x1', x(xa))
    .attr('y1', y(a + b * xa))
    .attr('x2', x(xb))
    .attr('y2', y(a + b * xb))
    .attr('stroke', cvar('--cyan'))
    .attr('stroke-width', 1.6)
    .attr('stroke-dasharray', '5 5')
    .attr('opacity', 0.8);

  const c = svg
    .selectAll('circle')
    .data(pts)
    .join('circle')
    .attr('cx', d => x(d.x))
    .attr('cy', d => y(d.y))
    .attr('fill', d => d.c || cvar('--violet'))
    .attr('fill-opacity', 0.75)
    .attr('stroke', d => (d.hl ? cvar('--text') : 'none'))
    .attr('stroke-width', 1.5)
    .attr('r', d => d.r || 3.2);

  c.on('pointerenter', (e, d: any) =>
    showTip(
      `<b>${esc(d.label || '')}</b>${tipRows([
        [o.xn || 'x', (o.fx || ((v: any) => v.toFixed(1)))(d.x)],
        [o.yn || 'y', (o.fy || ((v: any) => v.toFixed(1)))(d.y)]
      ])}`,
      e
    )
  )
    .on('pointermove', moveTip)
    .on('pointerleave', hideTip)
    .on('click', (_e, d) => o.onClick && o.onClick(d));

  const sx = Math.sqrt(d3.sum(pts, d => (d.x - mx) ** 2));
  const sy = Math.sqrt(d3.sum(pts, d => (d.y - my) ** 2));
  const r2 = sx * sy > 0 ? (d3.sum(pts, d => (d.x - mx) * (d.y - my)) / (sx * sy)) ** 2 : 0;

  svg
    .append('text')
    .attr('class', 'lbl')
    .attr('x', W - m.r)
    .attr('y', m.t + 4)
    .attr('text-anchor', 'end')
    .text('r² = ' + r2.toFixed(2) + (n ? '' : ''));
}

/* =====================================================================
   MAIN COMPONENT CONTENT
   ===================================================================== */
function HealthDisparitiesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlMetric = searchParams.get('metric');

  const { activeCounty, jurisdictions, markWorkflowMilestone } = useSession();

  const [activeMetric, setActiveMetric] = useState<string>(urlMetric || 'diabetes');
  const [geoScope, setGeoScope] = useState<'nation' | 'state' | 'tracts'>('state');
  const [tracts, setTracts] = useState<CensusTract[]>([]);

  // Add Finding Modal state matching prototype
  const [findingModalOpen, setFindingModalOpen] = useState(false);
  const [findingTract, setFindingTract] = useState<any>(null);
  const [findingNote, setFindingNote] = useState('');
  const [assessmentsList, setAssessmentsList] = useState<Assessment[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('');
  const [submittingFinding, setSubmittingFinding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Chart DOM container refs
  const chartQRef = useRef<HTMLDivElement>(null);
  const chartLRef = useRef<HTMLDivElement>(null);
  const chartMRef = useRef<HTMLDivElement>(null);
  const chartTRef = useRef<HTMLDivElement>(null);
  const chartRRef = useRef<HTMLDivElement>(null);
  const chartSRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    markWorkflowMilestone('layer');
  }, [markWorkflowMilestone]);

  // Load tracts for active county from MongoDB
  useEffect(() => {
    if (!activeCounty) return;
    fetch(`/api/tracts?county=${activeCounty._id}`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(res => {
        setTracts(res.data || []);
      })
      .catch(err => console.error(err));
  }, [activeCounty]);

  // Load assessments for Finding modal
  useEffect(() => {
    if (!activeCounty) return;
    fetch(`/api/assessments?jurisdiction=${activeCounty._id}`)
      .then(r => (r.ok ? r.json() : []))
      .then(res => {
        setAssessmentsList(res || []);
        if (res && res.length > 0) {
          setSelectedAssessmentId(res[0]._id);
        } else {
          setSelectedAssessmentId('__new');
        }
      })
      .catch(err => console.error(err));
  }, [activeCounty]);

  // Toast timer
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Active units for current geography scope matching prototype unitsFor(geo)
  const units: any[] = useMemo(() => {
    if (geoScope === 'tracts') {
      return tracts.length > 0 ? tracts : [];
    }
    if (geoScope === 'state') {
      const stateCounties = jurisdictions.filter(
        c => c.stateFips === activeCounty?.stateFips || c.stateAbbr === activeCounty?.stateAbbr
      );
      return stateCounties.length > 0 ? stateCounties : jurisdictions;
    }
    return jurisdictions;
  }, [geoScope, tracts, jurisdictions, activeCounty]);

  // Current metric config
  const m = METRICS[activeMetric] || METRICS.diabetes;

  // Statistical calculations matching prototype draw()
  const stats = useMemo(() => {
    if (!units.length || !activeCounty) {
      return {
        ratio: 1.0,
        top20: 0.2,
        ci: 0.0,
        gapNow: 0,
        gapThen: 0,
        above: 0
      };
    }

    const Q = quintiles(units);
    const qv = Q.map(q => wmean(q, activeMetric));
    const ratio = m.bad === 'low' ? (qv[4] > 0 ? qv[0] / qv[4] : 1) : (qv[0] > 0 ? qv[4] / qv[0] : 1);

    // Concentration curve: sort by SVI desc, cumulative pop vs cumulative burden
    const s: any[] = units.slice().sort((a, b) => (b.svi || 0) - (a.svi || 0));
    const totP = d3.sum(s, (u: any) => (u.pop || u.population || 4000));
    const burden = (u: any) => (m.bad === 'low' ? 90 - getV(u, activeMetric) : getV(u, activeMetric));
    const totB = d3.sum(s, (u: any) => (u.pop || u.population || 4000) * burden(u));
    let cp = 0,
      cb = 0;
    const pairs: [number, number][] = [[0, 0]];
    s.forEach((u: any) => {
      const pop = u.pop || u.population || 4000;
      cp += pop;
      cb += pop * burden(u);
      pairs.push([totP > 0 ? cp / totP : 0, totB > 0 ? cb / totB : 0]);
    });

    const step = Math.max(1, Math.floor(pairs.length / 120));
    const pp = pairs.filter((_p, i) => i % step === 0 || i === pairs.length - 1);
    const ci = 2 * d3.sum(pp.slice(1).map((p, i) => (p[0] - pp[i][0]) * ((p[1] + pp[i][1]) / 2))) - 1;

    const top20 = (() => {
      const i = pairs.findIndex(p => p[0] >= 0.2);
      if (i <= 0) return pairs[Math.max(0, i)] ? pairs[Math.max(0, i)][1] : 0.2;
      const [a, b] = [pairs[i - 1], pairs[i]];
      return a[1] + ((b[1] - a[1]) * (0.2 - a[0])) / Math.max(0.0001, b[0] - a[0]);
    })();

    // Trends: Q1 and Q5 over 10 years
    const t5 = trendFor('q5' + activeMetric + geoScope, qv[4], 10, m.bad === 'low' ? -0.004 : -0.02);
    const t1 = trendFor('q1' + activeMetric + geoScope, qv[0], 10, m.bad === 'low' ? -0.01 : 0.004);
    const gapNow = Math.abs(qv[4] - qv[0]);
    const gapThen = Math.abs(t5[0] - t1[0]);

    // Worst quartile cutoff against national counties
    const allCounties: any[] = jurisdictions.length > 0 ? jurisdictions : units;
    const allCountyVals = allCounties.map(c => getV(c, activeMetric)).sort(d3.ascending);
    const cutoff = m.bad === 'low' ? d3.quantile(allCountyVals, 0.25) : d3.quantile(allCountyVals, 0.75);
    const above = units.filter((u: any) =>
      m.bad === 'low' ? getV(u, activeMetric) < (cutoff ?? 0) : getV(u, activeMetric) > (cutoff ?? 0)
    ).length;

    return {
      ratio,
      top20,
      ci,
      gapNow,
      gapThen,
      above
    };
  }, [units, activeMetric, geoScope, jurisdictions, activeCounty, m]);

  // Regional ranking for analytical insights
  const { worstReg, worstRegMean } = useMemo(() => {
    if (!jurisdictions.length) return { worstReg: 'South', worstRegMean: 0 };
    const sorted = REGIONS.slice().sort(
      (a, b) =>
        (wmean(jurisdictions.filter(c => c.region === b || (c as any).state?.region === b), activeMetric) -
          wmean(jurisdictions.filter(c => c.region === a || (c as any).state?.region === a), activeMetric)) *
        (m.bad === 'low' ? -1 : 1)
    );
    const worst = sorted[0] || 'South';
    const mean = wmean(jurisdictions.filter(c => c.region === worst || (c as any).state?.region === worst), activeMetric);
    return { worstReg: worst, worstRegMean: mean };
  }, [jurisdictions, activeMetric, m]);

  // Render all 6 charts matching prototype draw()
  useEffect(() => {
    if (!units.length || !activeCounty) return;

    const Q = quintiles(units);
    const qv = Q.map(q => wmean(q, activeMetric));

    // Concentration curve pairs
    const s: any[] = units.slice().sort((a, b) => (b.svi || 0) - (a.svi || 0));
    const totP = d3.sum(s, (u: any) => (u.pop || u.population || 4000));
    const burden = (u: any) => (m.bad === 'low' ? 90 - getV(u, activeMetric) : getV(u, activeMetric));
    const totB = d3.sum(s, (u: any) => (u.pop || u.population || 4000) * burden(u));
    let cp = 0,
      cb = 0;
    const pairs: [number, number][] = [[0, 0]];
    s.forEach((u: any) => {
      const pop = u.pop || u.population || 4000;
      cp += pop;
      cb += pop * burden(u);
      pairs.push([totP > 0 ? cp / totP : 0, totB > 0 ? cb / totB : 0]);
    });
    const step = Math.max(1, Math.floor(pairs.length / 120));
    const pp = pairs.filter((_p, i) => i % step === 0 || i === pairs.length - 1);

    // Trend series
    const t5 = trendFor('q5' + activeMetric + geoScope, qv[4], 10, m.bad === 'low' ? -0.004 : -0.02);
    const t1 = trendFor('q1' + activeMetric + geoScope, qv[0], 10, m.bad === 'low' ? -0.01 : 0.004);

    // Chart 1: Bar chart quintiles
    if (chartQRef.current) {
      barChart(
        chartQRef.current,
        qv.map((x, i) => ({ label: 'Quintile ' + (i + 1), value: x, color: TIER_COLOR[i] })),
        { h: 240, fmt: m.f, name: m.short, max: (d3.max(qv) || 10) * 1.15 }
      );
    }

    // Chart 2: Lorenz concentration curve
    if (chartLRef.current) {
      lorenz(chartLRef.current, pp, { h: 240, xl: 'Cumulative population share' });
    }

    // Chart 3: Z-score matrix heatmap
    if (chartMRef.current) {
      const stateName = activeCounty.stateName || 'State';
      const stateCounties = jurisdictions.filter(
        c => c.stateFips === activeCounty.stateFips || c.stateAbbr === activeCounty.stateAbbr
      );
      const regRows = [...REGIONS, stateName, countyLabel(activeCounty)];
      const mu: Record<string, number> = {},
        sd: Record<string, number> = {};
      INDS.forEach(x => {
        const a = jurisdictions.map(c => getV(c, x));
        mu[x] = d3.mean(a) || 0;
        sd[x] = d3.deviation(a) || 1;
      });
      const Z = regRows.map((r, i) =>
        INDS.map(x => {
          const pool =
            i < 4
              ? jurisdictions.filter(c => c.region === r || (c as any).state?.region === r)
              : i === 4
              ? stateCounties.length > 0
                ? stateCounties
                : jurisdictions
              : [activeCounty];
          const z = (wmean(pool, x) - mu[x]) / (sd[x] || 1);
          return METRICS[x].bad === 'low' ? -z : z;
        })
      );
      matrix(chartMRef.current, regRows, INDS.map(x => METRICS[x].short), Z, { ch: 34 });
    }

    // Chart 4: Trend analysis
    if (chartTRef.current) {
      lineChart(
        chartTRef.current,
        YEARS,
        [
          { name: 'Quintile 5', color: cvar('--rose'), values: t5 },
          { name: 'Quintile 1', color: cvar('--teal'), values: t1 }
        ],
        { h: 230, fmt: m.f }
      );
    }

    // Chart 5: Regional comparison
    if (chartRRef.current) {
      const stateName = activeCounty.stateName || 'State';
      const stateCounties = jurisdictions.filter(
        c => c.stateFips === activeCounty.stateFips || c.stateAbbr === activeCounty.stateAbbr
      );
      const regData: Array<{ label: string; value: number; color?: string }> = REGIONS.map(r => ({
        label: r,
        value: wmean(
          jurisdictions.filter(c => c.region === r || (c as any).state?.region === r),
          activeMetric
        )
      }));
      regData.push({
        label: stateName,
        value: wmean(stateCounties.length > 0 ? stateCounties : jurisdictions, activeMetric),
        color: cvar('--violet')
      });
      barChart(chartRRef.current, regData, { horizontal: true, fmt: m.f, labelW: 120 });
    }

    // Chart 6: Vulnerability against metric scatter
    if (chartSRef.current) {
      const pts = units.map(u => ({
        x: u.svi ?? 0,
        y: getV(u, activeMetric),
        c: TIER_COLOR[clamp(Math.floor((u.svi ?? 0) * 5), 0, 4)],
        label: u.name ? (u.county ? u.name : countyLabel(u)) : '',
        id: u._id || u.id || '',
        r: geoScope === 'nation' ? 2.2 : 3.6,
        hl: (u._id || u.id) === activeCounty._id
      }));
      scatter(chartSRef.current, geoScope === 'nation' ? pts.filter((_p, i) => i % 2 === 0) : pts, {
        h: 280,
        xl: 'Social vulnerability index',
        yl: m.short,
        xn: 'Vulnerability',
        yn: m.short,
        fx: (xVal: any) => (+xVal).toFixed(1),
        fy: (yVal: any) => m.f(+yVal),
        onClick: (d: any) => router.push(d.id.length === 5 ? `/health-map?county=${d.id}` : `/health-map?tract=${d.id}`)
      });
    }
  }, [units, activeMetric, geoScope, jurisdictions, activeCounty, m, router]);

  // Handle opening insight modal matching prototype line 2216
  const handleOpenInsightModal = () => {
    const worst = (geoScope === 'tracts' ? units : tracts).slice().sort((a, b) => (b.svi || 0) - (a.svi || 0))[0] || units[0];
    const stateName = activeCounty?.stateName || 'State';
    const preset = `Disparity analysis: ${m.short} is ${stats.ratio.toFixed(2)}× higher in the most vulnerable quintile (${
      geoScope === 'tracts' ? 'tracts in ' + (activeCounty?.name || 'County') : stateName + ' counties'
    }). ${(worst?.name || 'High-vulnerability unit')} is the most vulnerable tract.`;

    setFindingTract(worst);
    setFindingNote(preset);
    setFindingModalOpen(true);
  };

  // Submit finding to assessment
  const handleSubmitFinding = async () => {
    if (!findingTract || !findingNote.trim()) return;
    setSubmittingFinding(true);

    try {
      let finalAssessmentId = selectedAssessmentId;
      if (finalAssessmentId === '__new') {
        const createRes = await fetch('/api/assessments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Needs assessment: ${countyLabel(activeCounty)}`,
            jurisdictionId: activeCounty?._id || '53033',
            status: 'Draft',
            step: 1,
            indicators: ['svi', 'poverty', 'uninsured', 'diabetes'],
            tracts: [findingTract._id || (findingTract as any).id]
          })
        });
        if (createRes.ok) {
          const newA = await createRes.json();
          finalAssessmentId = newA._id || newA.id;
        } else {
          throw new Error('Failed to create assessment');
        }
      }

      const res = await fetch('/api/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: finalAssessmentId,
          tractId: findingTract._id || (findingTract as any).id,
          note: findingNote
        })
      });

      if (res.ok) {
        await markWorkflowMilestone('finding');
        setToastMessage(`Finding added to ${finalAssessmentId}`);
        setFindingModalOpen(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to record finding');
      }
    } catch (e) {
      console.error(e);
      alert('Error creating finding');
    } finally {
      setSubmittingFinding(false);
    }
  };

  const stateName = activeCounty?.stateName || 'State';
  const countyName = activeCounty?.name || 'County';

  return (
    <>
      {/* Toast Notification in #toasts */}
      {toastMessage && (
        <div id="toasts">
          <div className="toast" role="status">
            <span className="ic">
              <Icon name="check" />
            </span>
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Page Header matching prototype line 2166 */}
      <div className="page-head">
        <div>
          <h1>Health disparity analysis</h1>
          <p>Compare outcomes across vulnerability quintiles, regions and time to see where inequities concentrate.</p>
        </div>
        <div className="head-actions">
          <span
            className="pill demo"
            title="Synthetic values generated for this demo. Not real surveillance or Census data."
          >
            <span className="dot"></span>Synthetic demo data
          </span>
        </div>
      </div>

      {/* Toolbar matching prototype lines 2167-2168 */}
      <div className="toolbar">
        <div className="row between">
          <div className="field">
            <span>Health indicator</span>
            <div className="chips" id="hd-k">
              {INDS.map(x => (
                <button
                  key={x}
                  className={`chip ${x === activeMetric ? 'on' : ''}`}
                  data-k={x}
                  onClick={() => setActiveMetric(x)}
                >
                  {METRICS[x].short}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Geography</span>
            <div className="seg" id="hd-g">
              <button
                data-g="nation"
                className={geoScope === 'nation' ? 'on' : ''}
                onClick={() => setGeoScope('nation')}
              >
                All US counties
              </button>
              <button
                data-g="state"
                className={geoScope === 'state' ? 'on' : ''}
                onClick={() => setGeoScope('state')}
              >
                {stateName} counties
              </button>
              <button
                data-g="tracts"
                className={geoScope === 'tracts' ? 'on' : ''}
                onClick={() => setGeoScope('tracts')}
              >
                {countyName} tracts
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Body Container matching prototype line 2169 & 2185-2216 */}
      <div id="hd-body">
        {/* Strip: 4 KPI readouts matching prototype lines 2185-2189 */}
        <section className="strip">
          <div className="strip-i">
            <div className="strip-l">Disparity ratio, most vs least vulnerable</div>
            <div className="strip-v">
              <span className="num" data-count={stats.ratio.toFixed(2)} data-dec="2">
                {stats.ratio.toFixed(2)}
              </span>
              <small>×</small>
            </div>
            <div className="strip-f">
              {m.short}, quintile 5 against quintile 1
            </div>
          </div>

          <div className="strip-i">
            <div className="strip-l">Burden held by the most vulnerable 20%</div>
            <div className="strip-v">
              <span className="num" data-count={(stats.top20 * 100).toFixed(1)} data-dec="1">
                {(stats.top20 * 100).toFixed(1)}
              </span>
              <small>%</small>
            </div>
            <div className="strip-f">Population-weighted share</div>
          </div>

          <div className="strip-i">
            <div className="strip-l">Quintile gap change since 2016</div>
            <div className="strip-v">
              <span className="num">
                {stats.gapNow >= stats.gapThen ? '+' : ''}
                {(stats.gapNow - stats.gapThen).toFixed(1)}
              </span>
              <small>pts</small>
            </div>
            <div className="strip-f">
              <span className={`delta ${stats.gapNow > stats.gapThen ? 'up' : 'down'}`}>
                {stats.gapNow > stats.gapThen ? 'Widening' : 'Narrowing'}
              </span>{' '}
              now {stats.gapNow.toFixed(1)} pts
            </div>
          </div>

          <div className="strip-i">
            <div className="strip-l">Units in the national worst quartile</div>
            <div className="strip-v">
              <span className="num" data-count={stats.above}>
                {stats.above}
              </span>
              <small>of {units.length.toLocaleString()}</small>
            </div>
            <div className="strip-f">{geoScope === 'tracts' ? 'Tracts in view' : 'Counties in view'}</div>
          </div>
        </section>

        {/* Main Grid: 7 Panels matching prototype lines 2190-2198 */}
        <div className="grid g-12">
          {/* Panel 1: Outcome by Vulnerability Quintile */}
          <section className="panel c-7">
            <div className="panel-h">
              <div>
                <h3>{m.label} by vulnerability quintile</h3>
                <div className="sub">Population-weighted averages. Quintile 5 is the most vulnerable</div>
              </div>
            </div>
            <div id="hd-q" ref={chartQRef}></div>
          </section>

          {/* Panel 2: Geographic Inequality */}
          <section className="panel c-5">
            <div className="panel-h">
              <div>
                <h3>Geographic inequality</h3>
                <div className="sub">Concentration curve, units ordered from most to least vulnerable</div>
              </div>
              <span className="pill violet">Index {stats.ci.toFixed(2)}</span>
            </div>
            <div id="hd-l" ref={chartLRef}></div>
          </section>

          {/* Panel 3: Vulnerability Indicator Heatmap */}
          <section className="panel c-12">
            <div className="panel-h">
              <div>
                <h3>Vulnerability indicator heatmap</h3>
                <div className="sub">
                  Standard deviations from the national county mean. Warm cells signal worse outcomes
                </div>
              </div>
            </div>
            <div id="hd-m" ref={chartMRef}></div>
          </section>

          {/* Panel 4: Trend Analysis */}
          <section className="panel c-7">
            <div className="panel-h">
              <div>
                <h3>Trend analysis</h3>
                <div className="sub">Most and least vulnerable quintiles, 2016 to 2025</div>
              </div>
            </div>
            <div id="hd-t" ref={chartTRef}></div>
            <div className="legend-row">
              <span>
                <i style={{ background: 'var(--rose)' }}></i>Quintile 5, most vulnerable
              </span>
              <span>
                <i style={{ background: 'var(--teal)' }}></i>Quintile 1, least vulnerable
              </span>
            </div>
          </section>

          {/* Panel 5: Regional Comparison */}
          <section className="panel c-5">
            <div className="panel-h">
              <div>
                <h3>Regional comparison</h3>
                <div className="sub">Population-weighted {m.short.toLowerCase()} by Census region</div>
              </div>
            </div>
            <div id="hd-r" ref={chartRRef}></div>
          </section>

          {/* Panel 6: Vulnerability against Metric Scatter */}
          <section className="panel c-8">
            <div className="panel-h">
              <div>
                <h3>Vulnerability against {m.short.toLowerCase()}</h3>
                <div className="sub">
                  Each point is a {geoScope === 'tracts' ? 'tract' : 'county'}. Click a point to open it on the health map
                </div>
              </div>
            </div>
            <div id="hd-s" ref={chartSRef}></div>
          </section>

          {/* Panel 7: Analytical Insights */}
          <section className="panel c-4">
            <div className="panel-h">
              <h3>Analytical insights</h3>
            </div>
            <div className="stack" id="hd-i">
              <div className="insight">
                <span className="ic">
                  <Icon name="spark" />
                </span>
                <p>
                  Residents of the most vulnerable fifth of {geoScope === 'tracts' ? 'tracts' : 'counties'} experience{' '}
                  <b>{stats.ratio.toFixed(2)}×</b> the {m.bad === 'low' ? 'shortfall in' : 'rate of'}{' '}
                  {m.short.toLowerCase()} seen in the least vulnerable fifth.
                  <small>Ratio of quintile 5 to quintile 1</small>
                </p>
              </div>

              <div className="insight">
                <span className="ic">
                  <Icon name="spark" />
                </span>
                <p>
                  The {worstReg} has the {m.bad === 'low' ? 'lowest' : 'highest'} regional {m.short.toLowerCase()}, at{' '}
                  {m.f(worstRegMean)}.
                  <small>Population-weighted regional average</small>
                </p>
              </div>

              <div className="insight">
                <span className="ic">
                  <Icon name="spark" />
                </span>
                <p>
                  The gap between quintiles has {stats.gapNow > stats.gapThen ? 'widened' : 'narrowed'} by{' '}
                  {Math.abs(stats.gapNow - stats.gapThen).toFixed(1)} points since 2016
                  {stats.gapNow > stats.gapThen
                    ? ', suggesting current interventions are not reaching the highest-need areas'
                    : ''}
                  .<small>Synthetic ten-year trend</small>
                </p>
              </div>

              <button className="btn" id="hd-add" onClick={handleOpenInsightModal}>
                <Icon name="clipboard" />
                <span>Add insight to assessment</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Add Finding Modal matching prototype lines 1788-1795 */}
      {findingModalOpen && findingTract && (
        <div id="modal-root" className="open">
          <div className="modal-scrim" onClick={() => setFindingModalOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" style={{ width: '560px', maxWidth: '90vw' }}>
            <div className="modal-h">
              <div>
                <h2>Add finding to an assessment</h2>
                <p>
                  {findingTract.name}, {countyLabel(activeCounty)}. GEOID {findingTract._id || findingTract.id}
                </p>
              </div>
              <button className="icon-btn" data-close aria-label="Close" onClick={() => setFindingModalOpen(false)}>
                <Icon name="x" />
              </button>
            </div>

            <div className="grid g-12">
              <div className="c-6 c-lg-6">
                <div className="kv">
                  <dt>Vulnerability</dt>
                  <dd>
                    {(findingTract.svi ?? 0).toFixed(2)} (
                    {TIER_LABEL[clamp(Math.floor((findingTract.svi ?? 0) * 5), 0, 4)] || 'Moderate'})
                  </dd>
                  <dt>Poverty</dt>
                  <dd>{getV(findingTract, 'poverty').toFixed(1)}%</dd>
                  <dt>Uninsured</dt>
                  <dd>{getV(findingTract, 'uninsured').toFixed(1)}%</dd>
                  <dt>Diabetes</dt>
                  <dd>{getV(findingTract, 'diabetes').toFixed(1)}%</dd>
                  <dt>Access score</dt>
                  <dd>{getV(findingTract, 'access').toFixed(0)}/100</dd>
                </div>
              </div>

              <div className="c-6 c-lg-6 stack">
                <label className="field">
                  Assessment
                  <select
                    className="input"
                    id="fa-a"
                    value={selectedAssessmentId}
                    onChange={e => setSelectedAssessmentId(e.target.value)}
                  >
                    {assessmentsList
                      .filter(a => a.status !== 'Completed')
                      .map(a => (
                        <option key={a._id} value={a._id}>
                          {a.title} ({a.status})
                        </option>
                      ))}
                    <option value="__new">Create a new draft assessment</option>
                  </select>
                </label>

                <label className="field">
                  Finding
                  <textarea
                    className="input"
                    id="fa-n"
                    rows={4}
                    value={findingNote}
                    onChange={e => setFindingNote(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="modal-f">
              <span className="note">Values are synthetic demo data captured at the time of the finding.</span>
              <button className="btn primary" id="fa-go" onClick={handleSubmitFinding} disabled={submittingFinding}>
                <Icon name="plus" />
                <span>{submittingFinding ? 'Saving...' : 'Add finding'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function HealthDisparitiesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading disparity analysis...</div>}>
      <HealthDisparitiesContent />
    </Suspense>
  );
}
