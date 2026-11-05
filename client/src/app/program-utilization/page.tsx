'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Assessment } from '@/types';
import { TIER_LABELS } from '@/config/metrics';
import { Icon } from '@/components/Icons';
import { useRouter } from 'next/navigation';
import { BivariateMap, BIV_MATRIX } from '@/components/BivariateMap';
import * as d3 from 'd3';

interface ProgramMeta {
  key: string;
  name: string;
  short: string;
  factor: number;
}

const PROGRAMS: Record<string, ProgramMeta> = {
  wic: { key: 'wic', name: 'WIC nutrition', short: 'WIC', factor: 0.07 },
  imm: { key: 'imm', name: 'Childhood immunization', short: 'Childhood', factor: 0.05 },
  dpp: { key: 'dpp', name: 'Diabetes prevention', short: 'Diabetes', factor: 0.09 },
  tob: { key: 'tob', name: 'Tobacco cessation', short: 'Tobacco', factor: 0.12 },
  mhv: { key: 'mhv', name: 'Maternal home visiting', short: 'Maternal', factor: 0.02 }
};

const YEARS = ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const TIER_COLOR = ['#9FE3E7', '#5CCAD2', '#66B6F5', '#2584EB', '#163E8C'];
const PALETTE = ['#37C8CF', '#8B5CF6', '#10B981', '#F43F5E', '#F59E0B', '#5FA8FF'];
const BIV = BIV_MATRIX;

// Deterministic Pseudo-Random Longitudinal Trend Math matching prototype
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1e6) / 1e6;
}

function rng(seed: number) {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

function trendFor(seed: string, end: number, n = 10, slope = 0.015) {
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

const fmtK = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toLocaleString());

// Component 1: Participation Trends Line Chart (Prototype lineChart lines 1500-1533)
function ParticipationTrendsChart({
  years,
  series
}: {
  years: string[];
  series: { name: string; color: string; values: number[] }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || series.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 500);
    const H = 220;
    const m = { t: 14, r: 14, b: 28, l: 44 };
    const f = (v: number) => v.toFixed(0) + '%';

    const svg = d3
      .select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible');

    const x = d3.scalePoint().domain(years).range([m.l, W - m.r]);
    const all = series.flatMap(s => s.values);
    const y = d3
      .scaleLinear()
      .domain([Math.max(0, (d3.min(all) ?? 40) * 0.92), (d3.max(all) ?? 80) * 1.06])
      .nice()
      .range([H - m.b, m.t]);

    // Gridlines
    svg
      .append('g')
      .attr('class', 'gridl')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(() => ''));

    // Left Axis
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat((d: any) => f(Number(d))).tickSize(0))
      .call(g => g.select('.domain').remove());

    // Bottom Axis
    const every = Math.ceil(years.length / Math.max(3, Math.floor(W / 70)));
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickValues(years.filter((_, i) => i % every === 0)))
      .call(g => g.select('.domain').remove());

    const line = d3
      .line<number>()
      .x((_, i) => x(years[i]) ?? 0)
      .y(d => y(d))
      .curve(d3.curveMonotoneX);

    const area = d3
      .area<number>()
      .x((_, i) => x(years[i]) ?? 0)
      .y0(H - m.b)
      .y1(d => y(d))
      .curve(d3.curveMonotoneX);

    series.forEach((s, si) => {
      if (si === 0) {
        const gid = 'pu-tr-grad-' + Math.random().toString(36).slice(2, 7);
        const defs = svg.append('defs');
        const gr = defs.append('linearGradient').attr('id', gid).attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
        gr.append('stop').attr('offset', 0).attr('stop-color', s.color).attr('stop-opacity', 0.3);
        gr.append('stop').attr('offset', 1).attr('stop-color', s.color).attr('stop-opacity', 0);

        svg.append('path')
          .attr('d', area(s.values) || '')
          .attr('fill', `url(#${gid})`);
      }

      const p = svg.append('path')
        .attr('d', line(s.values) || '')
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 2.4)
        .attr('stroke-linecap', 'round');

      const L = p.node()?.getTotalLength() || 600;
      p.attr('stroke-dasharray', `${L} ${L}`)
        .attr('stroke-dashoffset', L)
        .transition()
        .duration(1200)
        .delay(si * 150)
        .ease(d3.easeCubicInOut)
        .attr('stroke-dashoffset', 0);
    });

    // Hover crosshair and tracker dots
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
      .on('pointermove', function (e: MouseEvent) {
        const [mx] = d3.pointer(e);
        const step = x.step();
        const i = Math.min(years.length - 1, Math.max(0, Math.round((mx - m.l) / step)));
        const yr = years[i];
        const xx = x(yr) ?? 0;

        hl.attr('x1', xx).attr('x2', xx).attr('opacity', 1);
        dots.forEach((d, si) => {
          d.attr('cx', xx).attr('cy', y(series[si].values[i])).attr('opacity', 1);
        });

        showTip(
          `<b>${yr}</b>${tipRows(series.map(s => [s.name, f(s.values[i])]))}`,
          e
        );
      })
      .on('pointerleave', function () {
        hl.attr('opacity', 0);
        dots.forEach(d => d.attr('opacity', 0));
        hideTip();
      });

    return () => {
      hideTip();
    };
  }, [years, series]);

  return <div ref={containerRef} style={{ width: '100%', minHeight: '220px' }} />;
}

// Component 2: Service Distribution Donut Chart (Prototype donut lines 1535-1548)
function ServiceDonutChart({
  data
}: {
  data: { label: string; value: number; color: string }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 320);
    const S = Math.min(W, 210);
    const H = S;

    const svg = d3
      .select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible');

    const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2})`);

    const pie = d3.pie<{ label: string; value: number; color: string }>()
      .value(d => d.value)
      .sort(null)
      .padAngle(0.025);

    const arc = d3.arc<d3.PieArcDatum<{ label: string; value: number; color: string }>>()
      .innerRadius(S * 0.40)
      .outerRadius(S * 0.47)
      .cornerRadius(1);

    const tot = d3.sum(data, d => d.value) || 1;

    const p = g.selectAll('path')
      .data(pie(data))
      .join('path')
      .attr('fill', d => d.data.color)
      .style('cursor', 'pointer');

    p.transition()
      .duration(1000)
      .delay((_, i) => i * 80)
      .ease(d3.easeCubicOut)
      .attrTween('d', function (d) {
        const interpolate = d3.interpolate({ startAngle: d.startAngle, endAngle: d.startAngle }, d);
        return (t: number) => arc(interpolate(t)) || '';
      });

    p.on('pointerenter', function (e: MouseEvent, d) {
      showTip(
        `<b>${d.data.label}</b>${tipRows([
          ['Share', ((d.data.value / tot) * 100).toFixed(1) + '%'],
          ['Enrolled', Math.round(d.data.value).toLocaleString()]
        ])}`,
        e
      );
    })
      .on('pointermove', function (e: MouseEvent) {
        moveTip(e);
      })
      .on('pointerleave', function () {
        hideTip();
      });

    // Center total readout and label
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '.1em')
      .attr('class', 'val')
      .style('font-size', S * 0.13 + 'px')
      .style('font-weight', '700')
      .style('fill', 'var(--text)')
      .text(fmtK(tot));

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.9em')
      .attr('class', 'lbl')
      .style('font-size', '11px')
      .style('fill', 'var(--muted)')
      .text('enrolled');

    return () => {
      hideTip();
    };
  }, [data]);

  return <div ref={containerRef} style={{ width: '100%', minHeight: '210px' }} />;
}

// Component 3: Program Comparison Grouped Bars (Prototype groupedBars lines 1481-1498)
function ProgramComparisonChart({
  cats,
  series
}: {
  cats: string[];
  series: { name: string; color: string; values: number[] }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || series.length === 0 || cats.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 320);
    const H = 230;
    const m = { t: 14, r: 8, b: 30, l: 42 };
    const f = (v: number) => v.toFixed(0) + '%';

    const svg = d3
      .select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible');

    const x0 = d3.scaleBand().domain(cats).range([m.l, W - m.r]).padding(0.22);
    const x1 = d3.scaleBand().domain(series.map(s => s.name)).range([0, x0.bandwidth()]).padding(0.12);
    const y = d3.scaleLinear().domain([0, 100]).nice().range([H - m.b, m.t]);

    // Gridlines
    svg
      .append('g')
      .attr('class', 'gridl')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(() => ''));

    // Left Axis
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat((d: any) => f(Number(d))).tickSize(0))
      .call(g => g.select('.domain').remove());

    // Bottom Axis
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x0).tickSize(0).tickPadding(8))
      .call(g => g.select('.domain').remove());

    series.forEach((s, si) => {
      const r = svg
        .append('g')
        .selectAll('rect')
        .data(s.values)
        .join('rect')
        .attr('x', (_, i) => (x0(cats[i]) ?? 0) + (x1(s.name) ?? 0))
        .attr('width', x1.bandwidth())
        .attr('rx', Math.min(2, x1.bandwidth() / 3))
        .attr('fill', s.color)
        .attr('y', y(0))
        .attr('height', 0)
        .style('cursor', 'pointer');

      r.transition()
        .duration(850)
        .delay((_, i) => i * 70 + si * 110)
        .ease(d3.easeCubicOut)
        .attr('y', d => y(d))
        .attr('height', d => Math.max(1, y(0) - y(d)));

      r.on('pointerenter', function (e: MouseEvent, d) {
        const i = s.values.indexOf(d);
        showTip(`<b>${cats[i]}</b>${tipRows([[s.name, f(d)]])}`, e);
      })
        .on('pointermove', function (e: MouseEvent) {
          moveTip(e);
        })
        .on('pointerleave', function () {
          hideTip();
        });
    });

    return () => {
      hideTip();
    };
  }, [cats, series]);

  return <div ref={containerRef} style={{ width: '100%', minHeight: '230px' }} />;
}

function ProgramUtilizationContent() {
  const router = useRouter();
  const { activeCounty, markWorkflowMilestone } = useSession();

  const [activeProg, setActiveProg] = useState<string>('all');
  const [fte, setFte] = useState<number>(6);
  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [, setLoading] = useState<boolean>(true);
  const [selectedTractId, setSelectedTractId] = useState<string | null>(null);

  // Finding Modal state
  const [findingModalOpen, setFindingModalOpen] = useState(false);
  const [findingTract, setFindingTract] = useState<CensusTract | null>(null);
  const [findingNote, setFindingNote] = useState('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('__new');
  const targetAssessmentId = selectedAssessmentId;
  const setTargetAssessmentId = setSelectedAssessmentId;
  const [assessmentsList, setAssessmentsList] = useState<Assessment[]>([]);
  const [submittingFinding, setSubmittingFinding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const countyFips = activeCounty?._id || '53033';
  const countyName = activeCounty?.name || 'King';
  const stateAbbr = activeCounty?.stateAbbr || 'WA';
  const stateName = activeCounty?.stateName || 'Washington';

  // Mark workflow milestone
  useEffect(() => {
    markWorkflowMilestone('layer');
  }, [markWorkflowMilestone]);

  // Load tracts for active county
  useEffect(() => {
    setLoading(true);
    fetch(`/api/tracts?county=${countyFips}`)
      .then(res => (res.ok ? res.json() : { data: [] }))
      .then(json => {
        const data: CensusTract[] = json.data || [];
        setTracts(data);
        if (data.length > 0 && !selectedTractId) {
          setSelectedTractId(data[0]._id);
        }
      })
      .catch(err => console.error('Failed to load tracts:', err))
      .finally(() => setLoading(false));
  }, [countyFips]);

  // Load assessments for modal dropdown filtered by active county
  useEffect(() => {
    fetch(`/api/assessments?jurisdiction=${countyFips}`)
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        setAssessmentsList(data);
        if (data.length > 0) {
          setSelectedAssessmentId(data[0]._id);
        } else {
          setSelectedAssessmentId('__new');
        }
      })
      .catch(e => console.error(e));
  }, [countyFips]);

  // Helper to extract utilization for a tract
  const getUtil = (t: CensusTract, progKey: string): number => {
    if (progKey === 'all') {
      const p = t.prog;
      if (!p) return 48;
      const vals = Object.values(p);
      return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    }
    const val = t.prog ? (t.prog as any)[progKey] : (t.indicators as any)?.[`prog.${progKey}`];
    return typeof val === 'number' ? val : 50;
  };

  // Gap score formula: SVI * (100 - utilization)
  const calcGapScore = (t: CensusTract, progKey: string): number => {
    const u = getUtil(t, progKey);
    return t.svi * (100 - u);
  };

  // KPI Calculations matching prototype lines 2404-2415
  const kpis = useMemo(() => {
    if (tracts.length === 0) {
      return {
        enrolled: 14200,
        eligible: 26800,
        utilRate: 53.0,
        gapCount: 18,
        stateMedian: 54
      };
    }

    const totalPop = tracts.reduce((acc, t) => acc + (t.population || 4000), 0);
    const eligFactor =
      activeProg === 'all'
        ? 0.24
        : ({ wic: 0.07, imm: 0.05, dpp: 0.09, tob: 0.12, mhv: 0.02 }[activeProg] || 0.07);
    const eligible = Math.round(totalPop * eligFactor);

    // Weighted mean utilization
    const weightedUtilSum = tracts.reduce((acc, t) => {
      const u = getUtil(t, activeProg);
      return acc + u * (t.population || 4000);
    }, 0);
    const utilRate = totalPop > 0 ? weightedUtilSum / totalPop : 50;
    const enrolled = Math.round((eligible * utilRate) / 100);

    // Quantile thresholds
    const utils = tracts.map(t => getUtil(t, activeProg)).sort(d3.ascending);
    const svis = tracts.map(t => t.svi).sort(d3.ascending);

    const lowUtilThreshold = d3.quantile(utils, 1 / 3) ?? 45;
    const highSviThreshold = d3.quantile(svis, 2 / 3) ?? 0.66;

    const gapCount = tracts.filter(t => t.svi >= highSviThreshold && getUtil(t, activeProg) <= lowUtilThreshold).length;
    const stateMedian = { all: 54.0, wic: 56.0, imm: 72.0, dpp: 44.0, tob: 38.0, mhv: 62.0 }[activeProg] || 52.0;

    return {
      enrolled,
      eligible,
      utilRate,
      gapCount,
      stateMedian
    };
  }, [tracts, activeProg]);

  // Largest Coverage Gaps (Ranked top 7 matching prototype lines 2417-2418)
  const topGaps = useMemo(() => {
    if (tracts.length === 0) return [];
    return [...tracts]
      .sort((a, b) => calcGapScore(b, activeProg) - calcGapScore(a, activeProg))
      .slice(0, 7)
      .map(t => ({
        tract: t,
        gapScore: calcGapScore(t, activeProg),
        util: getUtil(t, activeProg),
        svi: t.svi,
        tier: t.tier ?? Math.min(4, Math.floor(t.svi * 5))
      }));
  }, [tracts, activeProg]);

  const maxGap = topGaps[0]?.gapScore || 1;

  // Resource Allocation Simulator (top 6 tracts matching prototype lines 2432-2435)
  const allocRows = useMemo(() => {
    if (tracts.length === 0) return [];
    const top6 = [...tracts]
      .sort((a, b) => calcGapScore(b, activeProg) - calcGapScore(a, activeProg))
      .slice(0, 6);

    const totGap = top6.reduce((acc, t) => acc + calcGapScore(t, activeProg), 0) || 1;

    return top6.map(t => {
      const base = getUtil(t, activeProg);
      const gap = calcGapScore(t, activeProg);
      const share = (fte * gap) / totGap;
      const gain = (100 - base) * (1 - Math.exp(-share * 0.22));
      return {
        tract: t,
        share,
        base,
        gain
      };
    });
  }, [tracts, activeProg, fte]);

  // Longitudinal Participation Trend Series (2016-2025)
  const trendSeries = useMemo(() => {
    const endCounty = kpis.utilRate;
    const endState = kpis.stateMedian;
    return [
      {
        name: countyName,
        color: 'var(--cyan)',
        values: trendFor(countyFips + activeProg + 'u', endCounty, 10, -0.02)
      },
      {
        name: stateName,
        color: 'var(--violet)',
        values: trendFor(stateAbbr + activeProg + 'u', endState, 10, -0.012)
      }
    ];
  }, [countyFips, activeProg, kpis, countyName, stateName, stateAbbr]);

  // Service Distribution Donut Data matching prototype lines 2422-2424
  const serviceDist = useMemo(() => {
    const totalPop = tracts.reduce((acc, t) => acc + (t.population || 4000), 0) || 280000;
    return Object.entries(PROGRAMS).map(([pk, meta], i) => {
      const weightedUtil =
        tracts.length > 0
          ? tracts.reduce((acc, t) => acc + (t.population || 4000) * getUtil(t, pk), 0) / totalPop
          : 50;
      const enrolled = Math.round((totalPop * meta.factor * weightedUtil) / 100);
      return {
        label: meta.name,
        value: enrolled,
        color: PALETTE[i % PALETTE.length]
      };
    });
  }, [tracts]);

  // Program Comparison Grouped Bars matching prototype lines 2426-2429
  const comparisonCategories = useMemo(() => {
    return Object.values(PROGRAMS).map(p => p.short);
  }, []);

  const comparisonSeries = useMemo(() => {
    const totalPop = tracts.reduce((acc, t) => acc + (t.population || 4000), 0) || 1;
    const countyValues = Object.keys(PROGRAMS).map(k => {
      if (tracts.length === 0) return 50;
      return Math.round(
        tracts.reduce((acc, t) => acc + (t.population || 4000) * getUtil(t, k), 0) / totalPop
      );
    });

    return [
      {
        name: countyName,
        color: 'var(--cyan)',
        values: countyValues
      },
      {
        name: stateAbbr,
        color: 'var(--violet)',
        values: [56, 72, 44, 38, 62]
      },
      {
        name: 'National',
        color: 'var(--faint)',
        values: [52, 68, 41, 35, 58]
      }
    ];
  }, [tracts, countyName, stateAbbr]);

  // Add Top Gap to Assessment Modal Trigger
  const handleOpenAddTopGap = () => {
    if (!topGaps[0]) return;
    const t = topGaps[0].tract;
    const util = getUtil(t, activeProg);
    const progLabel = activeProg === 'all' ? 'average program' : PROGRAMS[activeProg]?.name || 'program';

    setFindingTract(t);
    setFindingNote(
      `Coverage gap: ${t.name} combines vulnerability ${t.svi.toFixed(2)} with ${util.toFixed(0)}% ${progLabel} utilization, the largest gap in ${countyName}. Candidate for prioritized outreach allocation.`
    );
    setFindingModalOpen(true);
  };

  const handleSubmitFinding = async () => {
    if (!findingTract || !findingNote.trim()) return;
    setSubmittingFinding(true);

    try {
      let targetId = targetAssessmentId;

      if (targetId === '__new') {
        const createRes = await fetch('/api/assessments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Community Needs Assessment: ${countyName} County`,
            jurisdictionId: countyFips,
            template: 'access',
            due: new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10)
          })
        });
        if (createRes.ok) {
          const newAss = await createRes.json();
          targetId = newAss._id;
        }
      }

      const res = await fetch('/api/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: targetId,
          tractId: findingTract._id,
          note: findingNote.trim()
        })
      });

      if (res.ok) {
        await markWorkflowMilestone('finding');
        setToastMessage(`Finding added to Assessment`);
        setFindingModalOpen(false);
        setTimeout(() => setToastMessage(null), 4000);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to record finding');
      }
    } catch (e) {
      console.error(e);
      alert('Error creating finding');
    } finally {
      setSubmittingFinding(false);
    }
  };

  // CSV Export preserved
  const handleExportCSV = () => {
    if (!tracts.length) return;
    const headers = ['GEOID', 'Tract Name', 'SVI Vulnerability', 'Utilization (%)', 'Gap Priority Score'];
    const rows = tracts.map(t => {
      const util = getUtil(t, activeProg);
      const gap = calcGapScore(t, activeProg);
      return [t._id, `"${t.name}"`, t.svi.toFixed(3), util.toFixed(1), Math.round(gap)];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${countyFips}-program-utilization-${activeProg}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast" role="status" style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 200 }}>
          <span className="ic"><Icon name="check" size={15} /></span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header matching prototype lines 2378-2379 */}
      <div className="page-head">
        <div>
          <h1>Program utilization</h1>
          <p>
            See who is reached by public health programs, where coverage falls short of need, and how outreach
            resources could close the gap.
          </p>
        </div>
        <div className="head-actions">
          <span
            className="pill demo"
            title="Synthetic values generated for this demo. Not real surveillance or Census data."
          >
            <span className="dot"></span>Synthetic demo data
          </span>
          <button className="btn" id="pu-find" onClick={handleOpenAddTopGap}>
            <Icon name="clipboard" size={14} />
            <span>Add top gap to assessment</span>
          </button>
        </div>
      </div>

      {/* Toolbar matching prototype line 2380 */}
      <div className="toolbar">
        <div className="row between">
          <div className="field">
            <span>Program</span>
            <div className="seg" id="pu-p">
              <button
                className={activeProg === 'all' ? 'on' : ''}
                onClick={() => setActiveProg('all')}
              >
                All programs
              </button>
              {Object.entries(PROGRAMS).map(([k, meta]) => (
                <button
                  key={k}
                  className={activeProg === k ? 'on' : ''}
                  onClick={() => setActiveProg(k)}
                >
                  {meta.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ruled KPI Strip matching prototype lines 2381 & 2411-2415 */}
      <div id="pu-kpi">
        <section className="strip">
          <div className="strip-i">
            <div className="strip-l">Enrolled residents</div>
            <div className="strip-v">
              <span className="num">{Math.round(kpis.enrolled).toLocaleString()}</span>
            </div>
            <div className="strip-f">Eligibility × utilization estimate</div>
          </div>

          <div className="strip-i">
            <div className="strip-l">Eligible residents</div>
            <div className="strip-v">
              <span className="num">{Math.round(kpis.eligible).toLocaleString()}</span>
            </div>
            <div className="strip-f">Synthetic eligibility rate</div>
          </div>

          <div className="strip-i">
            <div className="strip-l">Utilization rate</div>
            <div className="strip-v">
              <span className="num">{kpis.utilRate.toFixed(1)}</span>
              <small>%</small>
            </div>
            <div className="strip-f">State median {kpis.stateMedian.toFixed(0)}%</div>
          </div>

          <div className="strip-i">
            <div className="strip-l">Coverage gap tracts</div>
            <div className="strip-v">
              <span className="num">{kpis.gapCount}</span>
              <small>of {tracts.length || 398}</small>
            </div>
            <div className="strip-f">High need, low utilization</div>
          </div>
        </section>
      </div>

      {/* Main Grid matching prototype lines 2382-2398 */}
      <div className="grid g-12">
        {/* Panel 1: Bivariate Map (c-7) */}
        <section className="panel c-7" style={{ padding: 0, overflow: 'hidden', minHeight: '440px', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0 }} id="pu-map">
            <BivariateMap
              countyFips={countyFips}
              countyName={countyName}
              tracts={tracts}
              programKey={activeProg}
              programLabel={activeProg === 'all' ? 'Average program' : (PROGRAMS[activeProg]?.name || activeProg)}
              selectedTractId={selectedTractId}
              onSelectTract={t => router.push(`/census-tracts?county=${countyFips}&tract=${t._id}`)}
              height={440}
            />
          </div>

          <div className="map-float" style={{ left: '14px', top: '14px', padding: '12px 14px' }}>
            <b style={{ fontSize: '12.5px' }}>Community coverage gaps</b>
            <div className="note">Tract need against program utilization</div>
          </div>

          <div
            className="map-float"
            style={{
              right: '14px',
              bottom: '14px',
              padding: '10px 14px',
              display: 'flex',
              gap: '6px',
              alignItems: 'center'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 16px)', gap: '2px' }}>
                {[2, 1, 0].map(n =>
                  [0, 1, 2].map(u => (
                    <i
                      key={`${n}-${u}`}
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '3px',
                        background: BIV[n][u],
                        display: 'inline-block'
                      }}
                    />
                  ))
                )}
              </div>
              <span className="note">Lower utilization →</span>
            </div>
            <span className="note" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              Higher need →
            </span>
          </div>
        </section>

        {/* Panel 2: Largest Coverage Gaps (c-5) */}
        <section className="panel c-5">
          <div className="panel-h">
            <div>
              <h3>Largest coverage gaps</h3>
              <div className="sub">High need, low utilization tracts in {countyName}</div>
            </div>
          </div>
          <div className="list" id="pu-gaps">
            {topGaps.map(g => (
              <button
                key={g.tract._id}
                className="li"
                data-t={g.tract._id}
                onClick={() => router.push(`/census-tracts?county=${countyFips}&tract=${g.tract._id}`)}
                style={{
                  border: 0,
                  borderBottom: '1px solid var(--line)',
                  background: 'none',
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 4px'
                }}
              >
                <span
                  className="tier"
                  style={{
                    background: TIER_COLOR[g.tier],
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    flexShrink: 0
                  }}
                />
                <span className="b" style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: '13px' }}>{g.tract.name}</b>
                  <small style={{ color: 'var(--muted)', fontSize: '11.5px' }}>
                    Vulnerability {g.svi.toFixed(2)}. Utilization {g.util.toFixed(0)}%
                  </small>
                  <div
                    className="prog"
                    style={{
                      marginTop: '6px',
                      height: '6px',
                      borderRadius: '3px',
                      background: 'var(--surface-2)',
                      overflow: 'hidden'
                    }}
                  >
                    <i
                      style={{
                        display: 'block',
                        height: '100%',
                        width: `${Math.min(100, Math.max(5, (g.gapScore / maxGap) * 100))}%`,
                        background: 'var(--cyan)',
                        borderRadius: '3px',
                        transition: 'width 0.6s ease'
                      }}
                    />
                  </div>
                </span>
                <span className="num" style={{ fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                  {Math.round(g.gapScore)}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Panel 3: Participation Trends (c-7) */}
        <section className="panel c-7">
          <div className="panel-h">
            <div>
              <h3>Participation trends</h3>
              <div className="sub">Utilization among eligible residents, 2016 to 2025</div>
            </div>
          </div>
          <div id="pu-tr">
            <ParticipationTrendsChart years={YEARS} series={trendSeries} />
          </div>
          <div className="legend-row">
            <span>
              <i style={{ background: 'var(--cyan)' }}></i>
              {countyName}
            </span>
            <span>
              <i style={{ background: 'var(--violet)' }}></i>
              {stateName}
            </span>
          </div>
        </section>

        {/* Panel 4: Service Distribution Donut (c-5) */}
        <section className="panel c-5">
          <div className="panel-h">
            <div>
              <h3>Service distribution</h3>
              <div className="sub">Enrolled residents by program</div>
            </div>
          </div>
          <div id="pu-donut">
            <ServiceDonutChart data={serviceDist} />
          </div>
          <div className="legend-row" id="pu-dl">
            {serviceDist.map(d => (
              <span key={d.label}>
                <i style={{ background: d.color }}></i>
                {d.label}
              </span>
            ))}
          </div>
        </section>

        {/* Panel 5: Resource Allocation Simulator (c-7) */}
        <section className="panel c-7">
          <div className="panel-h">
            <div>
              <h3>Resource allocation</h3>
              <div className="sub">Illustrative model: assign outreach staff to the largest gaps</div>
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'nowrap', gap: '16px', marginBottom: '12px' }}>
            <label className="field" style={{ flex: 1 }}>
              Outreach staff to allocate
              <input
                type="range"
                className="range"
                min={1}
                max={20}
                value={fte}
                onChange={e => setFte(Number(e.target.value))}
                id="pu-fte"
              />
            </label>
            <div className="kpi" style={{ minWidth: '110px', textAlign: 'right' }}>
              <span className="k-val num" id="pu-fte-l" style={{ fontSize: '26px' }}>
                {fte} FTE
              </span>
            </div>
          </div>
          <div id="pu-alloc">
            <div className="stack" style={{ gap: '10px' }}>
              {allocRows.map(r => (
                <div key={r.tract._id}>
                  <div className="row between" style={{ fontSize: '12.5px' }}>
                    <b>{r.tract.name.replace('Census ', '')}</b>
                    <span className="note">
                      <b className="num" style={{ color: 'var(--text)' }}>
                        {r.share.toFixed(1)} FTE
                      </b>
                      , {r.base.toFixed(0)}% to{' '}
                      <b className="num" style={{ color: 'var(--teal)' }}>
                        {(r.base + r.gain).toFixed(0)}%
                      </b>
                    </span>
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      height: '10px',
                      borderRadius: '6px',
                      background: 'var(--surface-2)',
                      marginTop: '5px',
                      overflow: 'hidden'
                    }}
                  >
                    <i
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${r.base}%`,
                        background: 'var(--violet)',
                        opacity: 0.55,
                        borderRadius: '6px'
                      }}
                    />
                    <i
                      className="gain"
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${r.base}%`,
                        width: `${r.gain}%`,
                        background: 'linear-gradient(90deg, var(--teal), var(--cyan))',
                        borderRadius: '0 6px 6px 0',
                        transition: 'width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="note mt-s">
            Assumes each FTE raises tract utilization with diminishing returns. A planning aid, not a forecast.
          </div>
        </section>

        {/* Panel 6: Program Comparison (c-5) */}
        <section className="panel c-5">
          <div className="panel-h">
            <div>
              <h3>Program comparison</h3>
              <div className="sub">Utilization: jurisdiction, state and national median</div>
            </div>
          </div>
          <div id="pu-cmp">
            <ProgramComparisonChart cats={comparisonCategories} series={comparisonSeries} />
          </div>
          <div className="legend-row">
            <span>
              <i style={{ background: 'var(--cyan)' }}></i>
              {countyName}
            </span>
            <span>
              <i style={{ background: 'var(--violet)' }}></i>
              {stateAbbr}
            </span>
            <span>
              <i style={{ background: 'var(--faint)' }}></i>
              National
            </span>
          </div>
        </section>
      </div>

      {/* Add Finding Modal matching prototype lines 1210-1230 & 2442 */}
      {findingModalOpen && findingTract && (
        <div id="modal-root" className="open">
          <div className="modal-scrim" onClick={() => setFindingModalOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" style={{ width: '560px', maxWidth: '92vw' }}>
            <div className="modal-h">
              <div>
                <h2>Add finding to an assessment</h2>
                <p>
                  {findingTract.name}, {countyName}. GEOID {findingTract._id}
                </p>
              </div>
              <button className="icon-btn" onClick={() => setFindingModalOpen(false)} aria-label="Close">
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="grid g-12">
              <div className="c-6 c-lg-6">
                <div className="kv">
                  <dt>Vulnerability</dt>
                  <dd>
                    {findingTract.svi.toFixed(2)} ({TIER_LABELS[findingTract.tier ?? 2] || 'Moderate'})
                  </dd>
                  <dt>Poverty</dt>
                  <dd>{(findingTract.indicators?.poverty ?? 14.2).toFixed(1)}%</dd>
                  <dt>Uninsured</dt>
                  <dd>{(findingTract.indicators?.uninsured ?? 8.5).toFixed(1)}%</dd>
                  <dt>Diabetes</dt>
                  <dd>{(findingTract.indicators?.diabetes ?? 10.4).toFixed(1)}%</dd>
                  <dt>Access score</dt>
                  <dd>{Math.round(findingTract.indicators?.access ?? (findingTract as any).access ?? 65)}/100</dd>
                </div>
              </div>

              <div className="c-6 c-lg-6 stack">
                <label className="field">
                  Assessment
                  <select
                    className="input"
                    value={targetAssessmentId}
                    onChange={e => setTargetAssessmentId(e.target.value)}
                  >
                    <option value="__new">Create a new draft assessment</option>
                    {assessmentsList.map(a => (
                      <option key={a._id} value={a._id}>
                        {a.title} ({a.status})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  Finding
                  <textarea
                    className="input"
                    rows={4}
                    value={findingNote}
                    onChange={e => setFindingNote(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="modal-f">
              <span className="note">Values are synthetic demo data captured at the time of the finding.</span>
              <button
                className="btn primary"
                id="fa-go"
                onClick={handleSubmitFinding}
                disabled={submittingFinding}
              >
                <Icon name="plus" size={14} />
                <span>Add finding</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ProgramUtilizationPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[13px] text-[var(--muted)]">
          Loading program utilization analytics...
        </div>
      }
    >
      <ProgramUtilizationContent />
    </Suspense>
  );
}
