'use client';

import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import * as d3 from 'd3';
import { useSession } from '@/context/SessionContext';
import { METRICS_CONFIG } from '@/config/metrics';
import { Icon } from '@/components/Icons';
import {
  TemporalDiseaseMap,
  createDiseaseColorScale
} from '@/components/TemporalDiseaseMap';
import {
  CountyRecord,
  getCountyRepository,
  STATE_META
} from '@/utils/countyRepository';

const CONDS = ['diabetes', 'hypertension', 'asthma', 'obesity', 'copd'];
const YEARS = ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const REGIONS = ['Northeast', 'Midwest', 'South', 'West'];

function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1e6) / 1e6;
}

function rngGen(seed: number): () => number {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function gaussRand(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

function trendFor(seed: string, end: number, n = 10, slope = 0.022): number[] {
  const r = rngGen(hashStr(seed));
  const out: number[] = [];
  let v = end * (1 + slope * n * (r() > 0.3 ? 1 : -0.5));
  for (let i = 0; i < n; i++) {
    v = v + (end - v) / (n - i) + gaussRand(r) * end * 0.012;
    out.push(v);
  }
  out[n - 1] = end;
  return out;
}

// Sparkline SVG matching prototype line 1712
function sparkSVG(vals: number[], w = 80, h = 24, color = 'var(--cyan)') {
  if (!vals || vals.length === 0) return null;
  const x = d3.scaleLinear().domain([0, vals.length - 1]).range([2, w - 2]);
  const minMax = d3.extent(vals) as [number, number];
  const y = d3.scaleLinear()
    .domain(minMax[0] === minMax[1] ? [minMax[0] - 1, minMax[1] + 1] : minMax)
    .range([h - 3, 3]);
  const d = d3.line<number>().x((_, i) => x(i)).y(v => y(v)).curve(d3.curveMonotoneX)(vals);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d={d || ''} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="3" fill={color} />
    </svg>
  );
}

// Tooltip helpers matching prototype lines 1316-1321
const TIP = { el: null as HTMLElement | null };

function showTip(html: string, e: MouseEvent) {
  const t = TIP.el || (TIP.el = document.getElementById('tooltip'));
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  moveTip(e);
}

function moveTip(e: MouseEvent) {
  const t = TIP.el || (TIP.el = document.getElementById('tooltip'));
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
  const t = TIP.el || (TIP.el = document.getElementById('tooltip'));
  if (t) t.classList.remove('on');
}

// Geographic Distribution Horizontal Bar Chart matching prototype barChart lines 1538-1552
function RegionalBarChart({
  data,
  format
}: {
  data: { label: string; value: number }[];
  format: (v: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 300);
    const rowH = 30;
    const lw = 96;
    const H = data.length * rowH + 6;

    const svg = d3.select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible');

    const maxVal = d3.max(data, d => d.value) || 10;
    const x = d3.scaleLinear()
      .domain([0, maxVal * 1.08])
      .range([0, Math.max(10, W - lw - 64)]);

    const rows = svg.selectAll('g.r')
      .data(data)
      .enter()
      .append('g')
      .attr('class', 'r')
      .attr('transform', (_, i) => `translate(0,${i * rowH})`);

    rows.append('text')
      .attr('class', 'lbl')
      .attr('x', 0)
      .attr('y', rowH / 2 + 4)
      .text(d => d.label.length > 24 ? d.label.slice(0, 23) + '…' : d.label);

    // Track background
    rows.append('rect')
      .attr('x', lw)
      .attr('y', rowH / 2 - 3)
      .attr('height', 6)
      .attr('rx', 1)
      .attr('fill', 'var(--surface-2)')
      .attr('width', Math.max(10, W - lw - 64));

    // Fill bar
    rows.append('rect')
      .attr('x', lw)
      .attr('y', rowH / 2 - 3)
      .attr('height', 6)
      .attr('rx', 1)
      .attr('fill', 'var(--cyan)')
      .attr('width', d => Math.max(2, x(d.value)));

    rows.append('text')
      .attr('class', 'val')
      .attr('x', W)
      .attr('text-anchor', 'end')
      .attr('y', rowH / 2 + 4)
      .text(d => format(d.value));

    rows.style('cursor', 'pointer')
      .on('pointerenter', (e: MouseEvent, d: any) => {
        showTip(`<b>${d.label}</b><div class="tv"><span>Prevalence</span><span>${format(d.value)}</span></div>`, e);
      })
      .on('pointermove', (e: MouseEvent) => {
        moveTip(e);
      })
      .on('pointerleave', () => {
        hideTip();
      });

    return () => {
      hideTip();
    };
  }, [data, format]);

  return <div ref={containerRef} style={{ width: '100%', minHeight: '126px' }} />;
}

// Time-Based Trends Line Chart matching prototype lineChart lines 1589-1621
function TimeTrendsChart({
  years,
  series,
  markX,
  format
}: {
  years: string[];
  series: { name: string; color: string; values: number[]; dash?: string; width?: number }[];
  markX: number;
  format: (v: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || series.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 500);
    const H = 230;
    const m = { t: 14, r: 14, b: 28, l: 44 };

    const svg = d3.select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible');

    const x = d3.scalePoint().domain(years).range([m.l, W - m.r]);
    const all = series.flatMap(s => s.values);
    const minVal = d3.min(all) ?? 0;
    const maxVal = d3.max(all) ?? 20;
    const y = d3.scaleLinear()
      .domain([minVal * 0.92, maxVal * 1.06])
      .nice()
      .range([H - m.b, m.t]);

    // Gridlines
    svg.append('g')
      .attr('class', 'gridl')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(() => ''));

    // Y Axis
    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat((d: any) => format(Number(d))).tickSize(0))
      .call(g => g.select('.domain').remove());

    // X Axis
    const every = Math.ceil(years.length / Math.max(3, Math.floor(W / 70)));
    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickValues(years.filter((_, i) => i % every === 0)))
      .call(g => g.select('.domain').remove());

    const line = d3.line<number>()
      .x((_, i) => x(years[i]) ?? 0)
      .y(d => y(d))
      .curve(d3.curveMonotoneX);

    const area = d3.area<number>()
      .x((_, i) => x(years[i]) ?? 0)
      .y0(H - m.b)
      .y1(d => y(d))
      .curve(d3.curveMonotoneX);

    series.forEach((s, si) => {
      if (si === 0) {
        const gid = 'di-tr-area-grad';
        const defs = svg.append('defs');
        const gr = defs.append('linearGradient').attr('id', gid).attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
        gr.append('stop').attr('offset', 0).attr('stop-color', s.color).attr('stop-opacity', 0.3);
        gr.append('stop').attr('offset', 1).attr('stop-color', s.color).attr('stop-opacity', 0);

        svg.append('path')
          .attr('d', area(s.values) || '')
          .attr('fill', `url(#${gid})`);
      }

      svg.append('path')
        .attr('d', line(s.values) || '')
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', s.width || 2.4)
        .attr('stroke-dasharray', s.dash || null)
        .attr('stroke-linecap', 'round');
    });

    // Mark line at active year index
    if (markX != null && years[markX] && x(years[markX]) != null) {
      const xx = x(years[markX])!;
      svg.append('line')
        .attr('x1', xx)
        .attr('x2', xx)
        .attr('y1', m.t)
        .attr('y2', H - m.b)
        .attr('stroke', 'var(--cyan)')
        .attr('stroke-dasharray', '3 4');
    }

    // Hover crosshair and interactive overlay
    const hl = svg.append('line')
      .attr('y1', m.t)
      .attr('y2', H - m.b)
      .attr('stroke', 'var(--line-strong)')
      .attr('opacity', 0);

    const dots = series.map(s =>
      svg.append('circle')
        .attr('r', 4.5)
        .attr('fill', s.color)
        .attr('stroke', 'var(--surface-solid)')
        .attr('stroke-width', 2)
        .attr('opacity', 0)
    );

    svg.append('rect')
      .attr('x', m.l)
      .attr('y', m.t)
      .attr('width', W - m.l - m.r)
      .attr('height', H - m.t - m.b)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('pointermove', (e: MouseEvent) => {
        const [mx] = d3.pointer(e);
        const step = x.step();
        const i = Math.max(0, Math.min(years.length - 1, Math.round((mx - m.l) / step)));
        const xx = x(years[i]) ?? m.l;
        hl.attr('x1', xx).attr('x2', xx).attr('opacity', 1);
        dots.forEach((d, si) => {
          const val = series[si]?.values[i] ?? 0;
          d.attr('cx', xx).attr('cy', y(val)).attr('opacity', 1);
        });

        const tipRowsHtml = series.map(s => `<div class="tv"><span>${s.name}</span><span>${format(s.values[i])}</span></div>`).join('');
        showTip(`<b>${years[i]}</b>${tipRowsHtml}`, e);
      })
      .on('pointerleave', () => {
        hl.attr('opacity', 0);
        dots.forEach(d => d.attr('opacity', 0));
        hideTip();
      });

    return () => {
      hideTip();
    };
  }, [years, series, markX, format]);

  return <div ref={containerRef} style={{ width: '100%', height: '230px' }} />;
}

// Influenza-Like Illness Weekly Chart matching prototype lines 2448-2451
function IliChart({
  weeks,
  series,
  format
}: {
  weeks: string[];
  series: { name: string; color: string; values: number[]; dash?: string; width?: number }[];
  format: (v: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || series.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 400);
    const H = 200;
    const m = { t: 14, r: 14, b: 28, l: 44 };

    const svg = d3.select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible');

    const x = d3.scalePoint().domain(weeks).range([m.l, W - m.r]);
    const all = series.flatMap(s => s.values);
    const minVal = d3.min(all) ?? 0;
    const maxVal = d3.max(all) ?? 10;
    const y = d3.scaleLinear()
      .domain([minVal * 0.92, maxVal * 1.06])
      .nice()
      .range([H - m.b, m.t]);

    // Gridlines
    svg.append('g')
      .attr('class', 'gridl')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(() => ''));

    // Y Axis
    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat((d: any) => format(Number(d))).tickSize(0))
      .call(g => g.select('.domain').remove());

    // X Axis with filtered ticks across 52 weeks
    const every = Math.ceil(weeks.length / Math.max(3, Math.floor(W / 70)));
    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickValues(weeks.filter((_, i) => i % every === 0)))
      .call(g => g.select('.domain').remove());

    const line = d3.line<number>()
      .x((_, i) => x(weeks[i]) ?? 0)
      .y(d => y(d))
      .curve(d3.curveMonotoneX);

    const area = d3.area<number>()
      .x((_, i) => x(weeks[i]) ?? 0)
      .y0(H - m.b)
      .y1(d => y(d))
      .curve(d3.curveMonotoneX);

    series.forEach((s, si) => {
      if (si === 0) {
        const gid = 'di-ili-area-grad';
        const defs = svg.append('defs');
        const gr = defs.append('linearGradient').attr('id', gid).attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
        gr.append('stop').attr('offset', 0).attr('stop-color', s.color).attr('stop-opacity', 0.3);
        gr.append('stop').attr('offset', 1).attr('stop-color', s.color).attr('stop-opacity', 0);

        svg.append('path')
          .attr('d', area(s.values) || '')
          .attr('fill', `url(#${gid})`);
      }

      svg.append('path')
        .attr('d', line(s.values) || '')
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', s.width || 2.4)
        .attr('stroke-dasharray', s.dash || null)
        .attr('stroke-linecap', 'round');
    });

    // Hover crosshair and interactive overlay
    const hl = svg.append('line')
      .attr('y1', m.t)
      .attr('y2', H - m.b)
      .attr('stroke', 'var(--line-strong)')
      .attr('opacity', 0);

    const dots = series.map(s =>
      svg.append('circle')
        .attr('r', 4.5)
        .attr('fill', s.color)
        .attr('stroke', 'var(--surface-solid)')
        .attr('stroke-width', 2)
        .attr('opacity', 0)
    );

    svg.append('rect')
      .attr('x', m.l)
      .attr('y', m.t)
      .attr('width', W - m.l - m.r)
      .attr('height', H - m.t - m.b)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('pointermove', (e: MouseEvent) => {
        const [mx] = d3.pointer(e);
        const step = x.step();
        const i = Math.max(0, Math.min(weeks.length - 1, Math.round((mx - m.l) / step)));
        const xx = x(weeks[i]) ?? m.l;
        hl.attr('x1', xx).attr('x2', xx).attr('opacity', 1);
        dots.forEach((d, si) => {
          const val = series[si]?.values[i] ?? 0;
          d.attr('cx', xx).attr('cy', y(val)).attr('opacity', 1);
        });

        const tipRowsHtml = series.map(s => `<div class="tv"><span>${s.name}</span><span>${format(s.values[i])}</span></div>`).join('');
        showTip(`<b>${weeks[i]}</b>${tipRowsHtml}`, e);
      })
      .on('pointerleave', () => {
        hl.attr('opacity', 0);
        dots.forEach(d => d.attr('opacity', 0));
        hideTip();
      });

    return () => {
      hideTip();
    };
  }, [weeks, series, format]);

  return <div ref={containerRef} style={{ width: '100%', height: '200px' }} />;
}

function DiseaseIncidenceContent() {
  const { activeCounty, markWorkflowMilestone } = useSession();

  const [repo, setRepo] = useState<{
    counties: CountyRecord[];
    countyById: Map<string, CountyRecord>;
    countiesByState: Map<string, CountyRecord[]>;
  } | null>(null);

  const [condition, setCondition] = useState<string>('diabetes');
  const [scopeSt, setScopeSt] = useState<string | null>(null); // null = USA, or stateFips e.g. '27'
  const [yearIndex, setYearIndex] = useState<number>(9); // 9 = 2025
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedCountyId, setSelectedCountyId] = useState<string | null>(
    activeCounty?._id || '27053'
  );
  const [filterQuery, setFilterQuery] = useState<string>('');

  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load county repository
  useEffect(() => {
    getCountyRepository().then(res => {
      setRepo(res);
    });
  }, []);

  useEffect(() => {
    markWorkflowMilestone('layer');
  }, [markWorkflowMilestone]);

  // Synchronize active county from session
  useEffect(() => {
    if (activeCounty?._id) {
      setSelectedCountyId(activeCounty._id);
    }
  }, [activeCounty]);

  // Pre-generate 10-year trends for all counties for the active condition
  const countyTrends = useMemo(() => {
    const trends = new Map<string, number[]>();
    if (!repo) return trends;

    repo.counties.forEach(c => {
      const endVal = (c.indicators as any)[condition] ?? 10;
      const t = trendFor(c.id + condition, endVal, 10, 0.022);
      trends.set(c.id, t);
    });
    return trends;
  }, [repo, condition]);

  // Play / Pause timer effect matching prototype 1100ms interval
  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setInterval(() => {
        setYearIndex(prev => {
          if (prev >= 9) {
            setIsPlaying(false);
            return 9;
          }
          return prev + 1;
        });
      }, 1100);
    } else if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (yearIndex >= 9) {
        setYearIndex(0);
      }
      setIsPlaying(true);
    }
  };

  const metricMeta = useMemo(() => {
    return METRICS_CONFIG[condition] || { label: condition, short: condition, unit: '%' };
  }, [condition]);

  // Current scope state object
  const currentStateName = useMemo(() => {
    const fips = scopeSt || activeCounty?.stateFips || '27';
    const m = STATE_META[fips] || ['MN', 'Minnesota', 'Midwest'];
    return m[1];
  }, [scopeSt, activeCounty]);

  const activeCountyStateName = useMemo(() => {
    const fips = activeCounty?.stateFips || '27';
    const m = STATE_META[fips] || ['MN', 'Minnesota', 'Midwest'];
    return m[1];
  }, [activeCounty]);

  // Counties pool in view (National or State)
  const poolCounties = useMemo(() => {
    if (!repo) return [];
    if (scopeSt) {
      return repo.countiesByState.get(scopeSt) || [];
    }
    return repo.counties;
  }, [repo, scopeSt]);

  // Disease Color Scale across all 10 years (Fixed across years matching prototype)
  const diseaseScaleInfo = useMemo(() => {
    const allVals: number[] = [];
    poolCounties.forEach(c => {
      const t = countyTrends.get(c.id);
      if (t) allVals.push(...t);
      else allVals.push((c.indicators as any)[condition] ?? 10);
    });
    if (allVals.length === 0) allVals.push(5, 25);
    return createDiseaseColorScale(allVals);
  }, [poolCounties, countyTrends, condition]);

  // Focus County
  const focusCounty = useMemo(() => {
    if (!repo || !selectedCountyId) return null;
    return repo.countyById.get(selectedCountyId) || repo.counties[0] || null;
  }, [repo, selectedCountyId]);

  const focusCountyLabel = useMemo(() => {
    if (!focusCounty) return 'Hennepin County, MN';
    return `${focusCounty.name} ${focusCounty.st === '22' ? 'Parish' : focusCounty.st === '02' ? 'Borough' : 'County'}, ${focusCounty.stateAbbr}`;
  }, [focusCounty]);

  // Focus County Rate for current year
  const focusCountyRate = useMemo(() => {
    if (!focusCounty) return 0;
    const trend = countyTrends.get(focusCounty.id);
    return trend ? trend[yearIndex] : (focusCounty.indicators as any)[condition] ?? 0;
  }, [focusCounty, countyTrends, yearIndex, condition]);

  // National Median for current year
  const nationalMedian = useMemo(() => {
    if (!repo) return 10;
    const vals = repo.counties.map(c => {
      const t = countyTrends.get(c.id);
      return t ? t[yearIndex] : (c.indicators as any)[condition] ?? 0;
    }).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)] || 10;
  }, [repo, countyTrends, yearIndex, condition]);

  const deltaFromNat = focusCountyRate - nationalMedian;

  // Geographic Distribution by Region (BarChart) matching prototype line 2427
  const regionalDistributionData = useMemo(() => {
    if (!repo) return [];
    return REGIONS.map(reg => {
      const regCounties = repo.counties.filter(c => c.region === reg);
      const totalPop = regCounties.reduce((acc, c) => acc + c.pop, 0) || 1;
      const weightedSum = regCounties.reduce((acc, c) => {
        const trend = countyTrends.get(c.id);
        const val = trend ? trend[9] : (c.indicators as any)[condition] ?? 0;
        return acc + val * c.pop;
      }, 0);
      return {
        label: reg,
        value: weightedSum / totalPop
      };
    });
  }, [repo, countyTrends, condition]);

  // 10-Year Time-Based Trend Series: County vs State Average vs National Median matching prototype line 2432
  const timeBasedTrendSeries = useMemo(() => {
    if (!repo) return [];

    const countyValues = focusCounty ? countyTrends.get(focusCounty.id) || [] : [];
    const stateList = focusCounty ? repo.countiesByState.get(focusCounty.st) || [] : [];
    const stateTotalPop = stateList.reduce((acc, c) => acc + c.pop, 0) || 1;
    const stateValues = YEARS.map((_, idx) => {
      const sum = stateList.reduce((acc, c) => {
        const t = countyTrends.get(c.id);
        return acc + (t ? t[idx] : 10) * c.pop;
      }, 0);
      return sum / stateTotalPop;
    });

    const natValues = YEARS.map((_, idx) => {
      const vals = repo.counties.map(c => {
        const t = countyTrends.get(c.id);
        return t ? t[idx] : 10;
      }).sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)] || 10;
    });

    return [
      {
        name: focusCounty?.name || 'County',
        color: 'var(--cyan)',
        values: countyValues
      },
      {
        name: currentStateName,
        color: 'var(--violet)',
        values: stateValues
      },
      {
        name: 'National median',
        color: 'var(--faint)',
        dash: '5 5',
        width: 1.8,
        values: natValues
      }
    ];
  }, [repo, focusCounty, countyTrends, currentStateName]);

  // Influenza-Like Illness (ILI) Weekly Surveillance Curve (52 weeks) matching prototype lines 2449-2451
  const iliWeeks = useMemo(() => {
    return Array.from({ length: 52 }, (_, i) => 'Wk ' + (((i + 39) % 52) + 1));
  }, []);

  const iliSeries = useMemo(() => {
    const fips = focusCounty?.id || '27053';
    const ili = (seed: string, amp: number) => {
      const r = rngGen(hashStr(seed));
      return Array.from({ length: 52 }, (_, i) => 1.4 + amp * Math.exp(-((i - 18) ** 2) / 40) + gaussRand(r) * 0.12);
    };

    return [
      {
        name: '2025–26 season',
        color: 'var(--amber)',
        values: ili(fips + 'ili26', 4.6)
      },
      {
        name: '2024–25 season',
        color: 'var(--violet)',
        dash: '4 4',
        width: 1.6,
        values: ili(fips + 'ili25', 5.4)
      }
    ];
  }, [focusCounty]);

  // Filtered & Ranked County Table matching prototype line 2435-2437
  const tableRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    const rows = poolCounties.filter(c => !q || c.name.toLowerCase().includes(q));

    return rows.map(c => {
      const trend = countyTrends.get(c.id) || [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const valCurrent = trend[yearIndex];
      const startVal = trend[0];
      const endVal = trend[9];
      const changePts = endVal - startVal;
      const moe = 1.96 * Math.sqrt((valCurrent * (100 - valCurrent)) / Math.max(400, c.pop * 0.02));

      return {
        county: c,
        valCurrent,
        ciLow: Math.max(0, valCurrent - moe),
        ciHigh: valCurrent + moe,
        changePts,
        trend
      };
    }).sort((a, b) => b.valCurrent - a.valCurrent).slice(0, 60);
  }, [poolCounties, filterQuery, countyTrends, yearIndex]);

  // Geographic Insights matching prototype lines 2439-2446
  const insights = useMemo(() => {
    if (poolCounties.length === 0) {
      return {
        risingCount: 0,
        topLabel: 'County',
        topRate: 0,
        corr: 0.65
      };
    }

    let rising = 0;
    let topC = poolCounties[0];
    let topVal = -Infinity;

    poolCounties.forEach(c => {
      const t = countyTrends.get(c.id);
      if (t) {
        if (t[9] - t[0] > 0) rising++;
        if (t[9] > topVal) {
          topVal = t[9];
          topC = c;
        }
      }
    });

    const topLabel = `${topC.name} ${topC.st === '22' ? 'Parish' : topC.st === '02' ? 'Borough' : 'County'}, ${topC.stateAbbr}`;

    // Pearson correlation with SVI
    const xs = poolCounties.map(c => c.svi);
    const ys = poolCounties.map(c => {
      const t = countyTrends.get(c.id);
      return t ? t[9] : 10;
    });
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - mx;
      const dy = ys[i] - my;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const corr = denX && denY ? num / Math.sqrt(denX * denY) : 0.65;

    return {
      risingCount: rising,
      topLabel,
      topRate: topVal === -Infinity ? 0 : topVal,
      corr
    };
  }, [poolCounties, countyTrends]);

  // CSV Export Handler matching prototype line 2458
  const handleExportTable = () => {
    if (!poolCounties.length) return;
    const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = [
      ['fips', 'id'],
      ['county', (c: CountyRecord) => `${c.name} ${c.st === '22' ? 'Parish' : c.st === '02' ? 'Borough' : 'County'}, ${c.stateAbbr}`],
      ...YEARS.map((y, i) => [y, (c: CountyRecord) => (countyTrends.get(c.id)?.[i] ?? 10).toFixed(2)]),
      ['data_status', () => 'synthetic demo']
    ];

    const csvContent = [
      cols.map(c => q(c[0])).join(','),
      ...poolCounties.map(r =>
        cols.map(c => q(typeof c[1] === 'function' ? c[1](r) : (r as any)[c[1]])).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${condition}-prevalence-by-county.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const activeYear = YEARS[yearIndex];
  const minValFormatted = `${diseaseScaleInfo.extent[0].toFixed(1)}%`;
  const maxValFormatted = `${diseaseScaleInfo.extent[1].toFixed(1)}%`;

  return (
    <>
      {/* Page Header */}
      <div className="page-head">
        <div>
          <h1>Disease incidence</h1>
          <p>Track chronic condition prevalence across counties and over time. Use the timeline to see how burden has shifted.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo" title="Synthetic values generated for this demo. Not real surveillance or Census data.">
            <span className="dot"></span>Synthetic demo data
          </span>
          <button className="btn" id="di-exp" onClick={handleExportTable}>
            <Icon name="download" />Export table
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="row between">
          <div className="field">
            <span>Condition</span>
            <div className="chips" id="di-c">
              {CONDS.map((c) => (
                <button
                  key={c}
                  className={`chip ${condition === c ? 'on' : ''}`}
                  data-k={c}
                  onClick={() => setCondition(c)}
                >
                  {METRICS_CONFIG[c]?.short || c}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Geography</span>
            <div className="seg" id="di-g">
              <button
                className={!scopeSt ? 'on' : ''}
                data-g=""
                onClick={() => setScopeSt(null)}
              >
                United States
              </button>
              <button
                className={scopeSt ? 'on' : ''}
                data-g={activeCounty?.stateFips || '27'}
                onClick={() => setScopeSt(activeCounty?.stateFips || '27')}
              >
                {activeCountyStateName}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid g-12">
        {/* Panel 1: Map and Timeline (c-8) */}
        <section className="panel c-8" style={{ padding: 0, overflow: 'hidden', minHeight: '460px' }}>
          <div style={{ position: 'absolute', inset: '0 0 70px 0' }} id="di-map">
            <TemporalDiseaseMap
              scopeSt={scopeSt}
              condition={condition}
              yearIndex={yearIndex}
              years={YEARS}
              selectedCountyId={selectedCountyId}
              onSelectCounty={(c) => setSelectedCountyId(c.id)}
              countyTrends={countyTrends}
              isPlaying={isPlaying}
            />
          </div>

          {/* Floating Map Legend */}
          <div className="map-float legend" style={{ left: '14px', top: '14px' }} id="di-leg">
            <div className="ttl"><span>{metricMeta.label}, {activeYear}</span></div>
            <div className="ramp">
              {diseaseScaleInfo.bins.map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </div>
            <div className="ends">
              <span>{minValFormatted}</span>
              <span>Fixed across years</span>
              <span>{maxValFormatted}</span>
            </div>
          </div>

          {/* Bottom Timeline Player Bar */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '70px',
              borderTop: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '0 18px',
              background: 'var(--surface)'
            }}
          >
            <button
              className="icon-btn"
              id="di-play"
              aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
              onClick={togglePlay}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} />
            </button>
            <div style={{ flex: 1 }}>
              <input
                type="range"
                className="range"
                min="0"
                max="9"
                value={yearIndex}
                onChange={(e) => setYearIndex(Number(e.target.value))}
                id="di-yr"
                aria-label="Year"
              />
              <div className="row between note">
                {YEARS.filter((_, i) => i % 3 === 0 || i === 9).map((y) => (
                  <span key={y}>{y}</span>
                ))}
              </div>
            </div>
            <div
              className="num"
              style={{
                fontSize: '26px',
                fontWeight: 600,
                minWidth: '64px',
                textAlign: 'right'
              }}
              id="di-ylab"
            >
              {activeYear}
            </div>
          </div>
        </section>

        {/* Panel 2: Right Stack: KPI & Regional Distribution (c-4) */}
        <div className="c-4 stack" style={{ gap: '18px' }}>
          {/* Active County KPI */}
          <section className="panel tight">
            <div className="kpi">
              <span className="k-label">{focusCountyLabel}</span>
              <span className="k-val num" id="di-jv">
                {focusCountyRate.toFixed(1)}%
              </span>
              <span className="k-foot" id="di-jf">
                {metricMeta.label} in {activeYear}.{' '}
                <span className={`delta ${deltaFromNat > 0 ? 'up' : deltaFromNat < 0 ? 'down' : 'neutral'}`}>
                  {deltaFromNat > 0 ? '+' : ''}{deltaFromNat.toFixed(1)}
                </span>{' '}
                vs national median
              </span>
            </div>
          </section>

          {/* Regional Distribution */}
          <section className="panel">
            <div className="panel-h">
              <div>
                <h3>Geographic distribution</h3>
                <div className="sub">Population-weighted prevalence by region</div>
              </div>
            </div>
            <div id="di-reg">
              <RegionalBarChart data={regionalDistributionData} format={(v) => `${v.toFixed(1)}%`} />
            </div>
          </section>
        </div>

        {/* Panel 3: Time-Based Trends Line Chart (c-7) */}
        <section className="panel c-7">
          <div className="panel-h">
            <div>
              <h3>Time-based trends</h3>
              <div className="sub">Prevalence, 2016 to 2025</div>
            </div>
          </div>
          <div id="di-tr">
            <TimeTrendsChart
              years={YEARS}
              series={timeBasedTrendSeries}
              markX={yearIndex}
              format={(v) => `${v.toFixed(1)}%`}
            />
          </div>
          <div className="legend-row">
            <span><i style={{ background: 'var(--cyan)' }}></i>{focusCounty?.name || 'County'}</span>
            <span><i style={{ background: 'var(--violet)' }}></i>{currentStateName}</span>
            <span><i style={{ background: 'var(--faint)' }}></i>National median</span>
          </div>
        </section>

        {/* Panel 4: Influenza-Like Illness Surveillance (c-5) */}
        <section className="panel c-5">
          <div className="panel-h">
            <div>
              <h3>Influenza-like illness</h3>
              <div className="sub">Weekly share of emergency visits, last two seasons</div>
            </div>
            <span className="pill info"><span className="dot live"></span>Seasonal</span>
          </div>
          <div id="di-ili">
            <IliChart
              weeks={iliWeeks}
              series={iliSeries}
              format={(v) => `${v.toFixed(1)}%`}
            />
          </div>
        </section>

        {/* Panel 5: County Data Table (c-8) */}
        <section className="panel c-8">
          <div className="panel-h">
            <div>
              <h3>County data table</h3>
              <div className="sub" id="di-tsub">
                {metricMeta.label}, {scopeSt ? currentStateName : activeCountyStateName} counties, highest first
              </div>
            </div>
            <input
              className="input"
              id="di-q"
              placeholder="Filter counties"
              style={{ width: '200px' }}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>
          <div className="tbl-wrap" style={{ maxHeight: '380px', overflow: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>County</th>
                  <th className="r">Prevalence</th>
                  <th className="r">95% CI</th>
                  <th className="r">Change since 2016</th>
                  <th className="r">Trend</th>
                </tr>
              </thead>
              <tbody id="di-tb">
                {tableRows.map((r) => {
                  const isSelected = r.county.id === selectedCountyId;
                  const isJur = r.county.id === (activeCounty?._id || '27053');
                  return (
                    <tr
                      key={r.county.id}
                      className={`clickable ${isSelected ? 'sel' : ''}`}
                      data-c={r.county.id}
                      onClick={() => setSelectedCountyId(r.county.id)}
                    >
                      <td>
                        <b>{r.county.name}</b>
                        {isJur && (
                          <> <span className="pill info" style={{ padding: '1px 7px' }}>Jurisdiction</span></>
                        )}
                      </td>
                      <td className="r num">{r.valCurrent.toFixed(1)}%</td>
                      <td className="r num muted">
                        {r.ciLow.toFixed(1)} to {r.ciHigh.toFixed(1)}
                      </td>
                      <td
                        className="r num"
                        style={{ color: r.changePts > 0 ? 'var(--rose)' : 'var(--teal)' }}
                      >
                        {r.changePts > 0 ? '+' : ''}{r.changePts.toFixed(1)} pts
                      </td>
                      <td className="r">
                        {sparkSVG(r.trend, 80, 24, r.changePts > 0 ? 'var(--rose)' : 'var(--teal)')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel 6: Geographic Insights (c-4) */}
        <section className="panel c-4">
          <div className="panel-h">
            <h3>Geographic insights</h3>
          </div>
          <div className="stack" id="di-ins">
            <div className="insight">
              <span className="ic"><Icon name="spark" /></span>
              <p>
                <b>{insights.risingCount}</b> of {poolCounties.length} counties shown have higher {metricMeta.short.toLowerCase()} in 2025 than in 2016.
                <small>Change across the timeline</small>
              </p>
            </div>
            <div className="insight">
              <span className="ic"><Icon name="spark" /></span>
              <p>
                {insights.topLabel} has the highest prevalence in view at <b>{insights.topRate.toFixed(1)}%</b>.
                <small>Ranked on 2025 values</small>
              </p>
            </div>
            <div className="insight">
              <span className="ic"><Icon name="spark" /></span>
              <p>
                County {metricMeta.short.toLowerCase()} correlates with social vulnerability at <b>r = {insights.corr.toFixed(2)}</b> nationally.
                <small>Pearson correlation across all counties</small>
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

export default function DiseaseIncidencePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading disease incidence surveillance...</div>}>
      <DiseaseIncidenceContent />
    </Suspense>
  );
}
