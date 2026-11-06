'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { CountyRecord, getCountyRepository } from '@/utils/countyRepository';

export interface ReportScaleInfo {
  bins: string[];
  lo: string;
  hi: string;
  title: string;
  note: string;
}

export interface ReportMapProps {
  countyFips: string;
  tracts: CensusTract[];
  metric?: string;
  focusTractIds?: string[];
  height?: number;
  onScaleReady?: (scale: ReportScaleInfo) => void;
  onCountySelect?: (countyFips: string) => void;
}

let topoCache: any = null;
const tractDataCache = new Map<string, CensusTract[]>();

// Tooltip helpers matching standard MapWell #tooltip (demo folder/entire_website.html lines 1230-1232)
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

const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-US'),
  pct: (v: number, d = 1) => v.toFixed(d) + '%',
  usd: (v: number) => '$' + Math.round(v).toLocaleString('en-US'),
  k: (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : Math.round(v) + '')
};

interface MetricDef {
  label: string;
  short: string;
  f: (v: number) => string;
  bad: 'high' | 'low' | 'none';
  unit?: string;
}

const METRICS: Record<string, MetricDef> = {
  svi: { label: 'Social vulnerability index', short: 'Vulnerability', f: v => v.toFixed(2), bad: 'high', unit: '' },
  sdoh: { label: 'SDOH composite burden', short: 'SDOH burden', f: v => v.toFixed(0), bad: 'high', unit: '/100' },
  poverty: { label: 'Population below poverty line', short: 'Poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  childPoverty: { label: 'Children below poverty line', short: 'Child poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  income: { label: 'Median household income', short: 'Median income', f: v => fmt.usd(v), bad: 'low' },
  rentBurden: { label: 'Rent-burdened households', short: 'Rent burden', f: v => v.toFixed(1) + '%', bad: 'high' },
  oldHousing: { label: 'Housing built before 1960', short: 'Pre-1960 housing', f: v => v.toFixed(1) + '%', bad: 'high' },
  crowding: { label: 'Overcrowded housing units', short: 'Crowding', f: v => v.toFixed(1) + '%', bad: 'high' },
  noVehicle: { label: 'Households without a vehicle', short: 'No vehicle', f: v => v.toFixed(1) + '%', bad: 'high' },
  transit: { label: 'Residents within ¼ mile of transit', short: 'Transit access', f: v => v.toFixed(0) + '%', bad: 'low' },
  commute: { label: 'Mean commute time', short: 'Commute', f: v => v.toFixed(0) + ' min', bad: 'high' },
  noDiploma: { label: 'Adults without a high school diploma', short: 'No diploma', f: v => v.toFixed(1) + '%', bad: 'high' },
  bachelors: { label: "Adults with a bachelor's degree", short: "Bachelor's+", f: v => v.toFixed(1) + '%', bad: 'low' },
  broadband: { label: 'Households with broadband', short: 'Broadband', f: v => v.toFixed(0) + '%', bad: 'low' },
  unemployment: { label: 'Unemployment rate', short: 'Unemployment', f: v => v.toFixed(1) + '%', bad: 'high' },
  lfp: { label: 'Labor force participation', short: 'Labor force', f: v => v.toFixed(1) + '%', bad: 'low' },
  uninsured: { label: 'Adults without health insurance', short: 'Uninsured', f: v => v.toFixed(1) + '%', bad: 'high' },
  pcp: { label: 'Primary care physicians per 100k', short: 'PCP per 100k', f: v => v.toFixed(0), bad: 'low' },
  driveTime: { label: 'Drive time to nearest clinic', short: 'Clinic drive time', f: v => v.toFixed(0) + ' min', bad: 'high' },
  access: { label: 'Healthcare access score', short: 'Access score', f: v => v.toFixed(0), bad: 'low', unit: '/100' },
  diabetes: { label: 'Diagnosed diabetes prevalence', short: 'Diabetes', f: v => v.toFixed(1) + '%', bad: 'high' },
  asthma: { label: 'Current asthma prevalence', short: 'Asthma', f: v => v.toFixed(1) + '%', bad: 'high' },
  hypertension: { label: 'High blood pressure prevalence', short: 'Hypertension', f: v => v.toFixed(1) + '%', bad: 'high' },
  obesity: { label: 'Adult obesity prevalence', short: 'Obesity', f: v => v.toFixed(1) + '%', bad: 'high' },
  copd: { label: 'COPD prevalence', short: 'COPD', f: v => v.toFixed(1) + '%', bad: 'high' },
  incidence: { label: 'Chronic disease burden index', short: 'Disease burden', f: v => v.toFixed(0), bad: 'high', unit: '/100' },
  utilization: { label: 'Average program utilization', short: 'Utilization', f: v => v.toFixed(0) + '%', bad: 'low' },
  lifeExp: { label: 'Life expectancy at birth', short: 'Life expectancy', f: v => v.toFixed(1) + ' yrs', bad: 'low' },
  pop: { label: 'Population', short: 'Population', f: v => fmt.k(v), bad: 'none' }
};

const TIER_LABEL = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];

const LAYERS: Record<string, { id: string; ramp: string[]; metrics: string[] }> = {
  sdoh: { id: 'sdoh', ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'], metrics: ['sdoh', 'poverty', 'noDiploma', 'rentBurden', 'unemployment', 'noVehicle'] },
  disease: { id: 'disease', ramp: ['#BDEFF0', '#37C8CF', '#2A9FD6', '#2565C8', '#173F8A'], metrics: ['incidence', 'diabetes', 'hypertension', 'asthma', 'obesity', 'copd'] },
  program: { id: 'program', ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'], metrics: ['utilization', 'prog.wic', 'prog.imm', 'prog.dpp', 'prog.tob', 'prog.mhv'] },
  access: { id: 'access', ramp: ['#C6EAF7', '#7FC6F2', '#3B97E6', '#1F63C6', '#143F86'], metrics: ['access', 'uninsured', 'pcp', 'driveTime'] },
  vuln: { id: 'vuln', ramp: ['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E'], metrics: ['svi', 'childPoverty', 'crowding', 'lifeExp'] }
};

function layerOf(key: string): string {
  for (const l of Object.values(LAYERS)) {
    if (l.metrics.includes(key)) return l.id;
  }
  return 'sdoh';
}

function getV(rec: any, key: string): number {
  if (!rec) return 0;
  if (key.startsWith('prog.')) return rec.prog?.[key.slice(5)] ?? 50;
  const val = rec.indicators?.[key] ?? rec[key];
  if (typeof val === 'number') return val;
  if (key === 'svi') return rec.svi ?? 0.5;
  if (key === 'pop' || key === 'population') return rec.population ?? rec.pop ?? 4000;
  if (key === 'uninsured') return rec.indicators?.uninsured ?? rec.uninsured ?? 10.5;
  return 0;
}

function countyLabel(c?: any): string {
  if (!c) return 'County';
  const st = c.stateAbbr || c.st || 'WA';
  const name = (c.name || 'County').replace(/\s+County$/i, '');
  return `${name} County, ${st}`;
}

const escapeHtml = (s: any): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

const getTractId = (t: CensusTract): string => t._id || (t as any).id || '';

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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function generateVoronoiSeeds(
  bounds: [[number, number], [number, number]],
  countyD: string,
  targetCount: number,
  urban = 0.65,
  cid = 'seed'
): [number, number][] {
  const [[x0, y0], [x1, y1]] = bounds;
  const w = Math.max(x1 - x0, 2);
  const h = Math.max(y1 - y0, 2);

  let ctx: CanvasRenderingContext2D | null = null;
  let p2: Path2D | null = null;
  if (typeof document !== 'undefined' && typeof Path2D !== 'undefined') {
    const canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    try {
      p2 = new Path2D(countyD);
    } catch {
      p2 = null;
    }
  }

  const pts: [number, number][] = [];
  const r = rngGen(hashStr('t' + cid));
  const core: [number, number] = [
    x0 + w * (0.3 + r() * 0.4),
    y0 + h * (0.3 + r() * 0.4)
  ];

  let guard = 0;
  while (pts.length < targetCount && guard++ < targetCount * 80) {
    let px = x0 + r() * w;
    let py = y0 + r() * h;
    if (r() < urban * 0.7) {
      px = core[0] + gaussRand(r) * w * 0.16;
      py = core[1] + gaussRand(r) * h * 0.16;
    }
    if (ctx && p2) {
      if (ctx.isPointInPath(p2, px, py)) pts.push([px, py]);
    } else {
      pts.push([px, py]);
    }
  }

  // Backup grid if sampling didn't reach target count
  if (pts.length < targetCount && ctx && p2) {
    const steps = 30;
    const dx = w / steps;
    const dy = h / steps;
    const grid: [number, number][] = [];
    for (let ix = 1; ix < steps; ix++) {
      for (let iy = 1; iy < steps; iy++) {
        const gx = x0 + ix * dx + (r() - 0.5) * dx * 0.5;
        const gy = y0 + iy * dy + (r() - 0.5) * dy * 0.5;
        if (ctx.isPointInPath(p2, gx, gy)) grid.push([gx, gy]);
      }
    }
    grid.sort(() => r() - 0.5);
    for (const p of grid) {
      if (pts.length >= targetCount) break;
      pts.push(p);
    }
  }

  while (pts.length < targetCount) {
    const fallback = pts.length > 0 ? pts[pts.length % pts.length] : [x0 + w * 0.5, y0 + h * 0.5];
    pts.push([fallback[0] + (r() - 0.5) * 2, fallback[1] + (r() - 0.5) * 2]);
  }

  if (pts.length < 3) {
    pts.push([x0 + w * 0.5, y0 + h * 0.5], [x0 + 1, y0 + 1], [x1 - 1, y1 - 1]);
  }

  return pts;
}

// Generate realistic deterministic tracts for county matching prototype demo folder/entire_website.html lines 885964-886000
function getTractsForCounty(county: CountyRecord, incomingTracts?: CensusTract[]): CensusTract[] {
  if (incomingTracts && incomingTracts.length > 5 && incomingTracts[0].countyFips === county.id) {
    tractDataCache.set(county.id, incomingTracts);
    return incomingTracts;
  }
  if (tractDataCache.has(county.id)) {
    return tractDataCache.get(county.id)!;
  }

  const n = clamp(Math.round(Math.sqrt(county.pop || 80000) / 11), 6, 140);
  const ind = county.indicators || ({} as any);
  const cSvi = ind.svi !== undefined ? ind.svi : (county.svi || 0.4);
  const cPoverty = ind.poverty !== undefined ? ind.poverty : 12;
  const cUninsured = ind.uninsured !== undefined ? ind.uninsured : 8;
  const cDiabetes = ind.diabetes !== undefined ? ind.diabetes : 9;
  const cAsthma = ind.asthma !== undefined ? ind.asthma : 8.5;
  const cHypertension = ind.hypertension !== undefined ? ind.hypertension : 28;
  const cSdoh = ind.sdoh !== undefined ? ind.sdoh : 40;
  const cIncidence = ind.incidence !== undefined ? ind.incidence : 35;
  const cAccess = ind.access !== undefined ? ind.access : 65;
  const cUtilization = ind.utilization !== undefined ? ind.utilization : 50;
  const cLifeExp = ind.lifeExp !== undefined ? ind.lifeExp : 78;

  const tracts: CensusTract[] = [];
  for (let i = 0; i < n; i++) {
    const rr = rngGen(hashStr(county.id + ':' + i));
    const ln = () => gaussRand(rr);
    const k = ln() * 0.12;

    const tnum = 100 + i * 2 + Math.floor(rr() * 2);
    const suffix = rr() < 0.35 ? '.0' + (1 + Math.floor(rr() * 2)) : '';
    const geoid = county.id + String(tnum).padStart(4, '0') + (suffix ? suffix.slice(1).padStart(2, '0') : '00');

    const tractSvi = clamp(cSvi + k * 1.1 + ln() * 0.05, 0.01, 0.99);
    const tier = clamp(Math.floor(tractSvi * 5), 0, 4);

    tracts.push({
      _id: geoid,
      countyFips: county.id,
      name: `Census Tract ${tnum}${suffix}`,
      population: Math.round(clamp(2400 + rr() * 4800, 1200, 8200)),
      svi: parseFloat(tractSvi.toFixed(2)),
      tier,
      indicators: {
        svi: parseFloat(tractSvi.toFixed(2)),
        poverty: parseFloat(clamp(cPoverty * (1 + k * 2.2) + ln() * 2, 1.5, 58).toFixed(1)),
        uninsured: parseFloat(clamp(cUninsured * (1 + k * 2) + ln() * 1.5, 1, 40).toFixed(1)),
        diabetes: parseFloat(clamp(cDiabetes * (1 + k * 1.2) + ln() * 0.6, 3.5, 24).toFixed(1)),
        asthma: parseFloat(clamp(cAsthma * (1 + k * 0.7) + ln() * 0.4, 5.5, 17).toFixed(1)),
        hypertension: parseFloat(clamp(cHypertension * (1 + k * 0.8) + ln() * 1.4, 18, 55).toFixed(1)),
        sdoh: Math.round(clamp(cSdoh + k * 35 + ln() * 3, 2, 98)),
        incidence: Math.round(clamp(cIncidence + k * 30 + ln() * 3, 2, 98)),
        access: Math.round(clamp(cAccess * (1 - k * 1.1) + ln() * 4, 4, 98)),
        utilization: Math.round(clamp(cUtilization * (1 - k * 1.4) + ln() * 4, 4, 95)),
        lifeExp: parseFloat(clamp(cLifeExp - k * 9 + ln() * 0.7, 62, 88).toFixed(1))
      }
    } as CensusTract);
  }

  tractDataCache.set(county.id, tracts);
  return tracts;
}

function buildColorScale(key: string, values: number[], layerId?: string) {
  const m = METRICS[key] || { bad: 'high' };
  const layer = layerId ? LAYERS[layerId] : (LAYERS[layerOf(key)] || LAYERS.sdoh);
  const ramp = layer.ramp;
  const low = '#101B45';
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
    d3.interpolateRgb(low, ramp[0])(0.6),
    ...ramp
  ]);
  const cleanVals = values.length > 0 ? values : [0, 1];
  const q = d3.scaleQuantile().domain(cleanVals).range(d3.range(7));
  const flip = m.bad === 'low';
  const tOf = (i: number) => {
    const t = (i + 0.5) / 7;
    return flip ? 1 - t : t;
  };
  const fn = (v: number) => interp(tOf(q(v)));
  const bins = d3.range(7).map(i => interp(tOf(i)));
  const ext = (cleanVals.length > 0 ? d3.extent(cleanVals) : [0, 1]) as [number, number];
  return { fn, bins, ext, q };
}

function getBoundsTransform(bounds: [[number, number], [number, number]], pad = 0.72) {
  const [[x0, y0], [x1, y1]] = bounds;
  const bw = Math.max(x1 - x0, 10);
  const bh = Math.max(y1 - y0, 10);
  const s = Math.min(90, pad / Math.max(bw / 975, bh / 610));
  return d3.zoomIdentity
    .translate(975 / 2, 610 / 2)
    .scale(s)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
}

export function ReportMap({
  countyFips,
  tracts,
  metric = 'svi',
  focusTractIds = [],
  height = 280,
  onScaleReady,
  onCountySelect
}: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInitializedRef = useRef<boolean>(false);
  const lastRenderedCountyRef = useRef<string>('');
  const currentMetricRef = useRef<string>(metric);
  const currentScopeStateRef = useRef<string>('');
  const lastScaleSigRef = useRef<string>('');

  // Callbacks stored in refs to avoid triggering effect runs on parent re-renders
  const onScaleReadyRef = useRef(onScaleReady);
  onScaleReadyRef.current = onScaleReady;

  const onCountySelectRef = useRef(onCountySelect);
  onCountySelectRef.current = onCountySelect;

  // D3 Selection Refs
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const gRootRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gCRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gBRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gTRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gSelRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const clipPathRef = useRef<d3.Selection<SVGPathElement, unknown, null, undefined> | null>(null);

  // Cached Repo Data Ref
  const repoDataRef = useRef<{
    counties: CountyRecord[];
    countyById: Map<string, CountyRecord>;
    countiesByState: Map<string, CountyRecord[]>;
    statesFeatures: any[];
  } | null>(null);

  // Helper: Select and bring county into focus
  const selectCounty = useCallback((targetCounty: CountyRecord, animate = true) => {
    if (!gRootRef.current || !gCRef.current || !gSelRef.current || !gTRef.current || !clipPathRef.current) return;
    const isRM = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const pathGen = d3.geoPath();
    const countyD = targetCounty.d || pathGen(targetCounty.feature) || '';
    const countyBounds = pathGen.bounds(targetCounty.feature);
    const countyTargetTransform = getBoundsTransform(countyBounds, 0.7);

    lastRenderedCountyRef.current = targetCounty.id;

    // 1. Update .sel class across neighbouring counties
    gCRef.current.selectAll<SVGPathElement, CountyRecord>('path.county')
      .classed('sel', d => d.id === targetCounty.id);

    // 2. Update cyan glowing outline
    gSelRef.current.selectAll('*').remove();
    gSelRef.current.append('path')
      .attr('class', 'sel-outline')
      .attr('d', countyD)
      .attr('vector-effect', 'non-scaling-stroke')
      .style('pointer-events', 'none');

    // 3. Update ClipPath
    clipPathRef.current.attr('d', countyD);

    // 4. Smooth camera glide into clicked county
    if (animate && !isRM) {
      gRootRef.current.transition('cam')
        .duration(900)
        .ease(d3.easeCubicInOut)
        .attr('transform', countyTargetTransform.toString());
    } else {
      gRootRef.current.attr('transform', countyTargetTransform.toString());
    }

    // 5. Draw tracts for clicked county with distinct quantile colors & focus outlines
    const effectiveTracts = getTractsForCounty(targetCounty);
    const tractValues = effectiveTracts.map(t => getV(t, currentMetricRef.current));
    const tractScale = buildColorScale(
      currentMetricRef.current,
      tractValues,
      layerOf(currentMetricRef.current)
    );

    const focusSet = new Set(
      focusTractIds && focusTractIds.length > 0
        ? focusTractIds
        : effectiveTracts.filter(t => (t.tier ?? Math.floor(t.svi * 5)) >= 3).map(t => getTractId(t))
    );

    renderTracts(
      gTRef.current,
      targetCounty,
      countyBounds,
      countyD,
      effectiveTracts,
      currentMetricRef.current,
      tractScale,
      focusSet,
      isRM
    );

    // 6. Update legend scale callback
    if (onScaleReadyRef.current) {
      const mInfo = METRICS[currentMetricRef.current] || { short: currentMetricRef.current, f: (v: number) => v.toFixed(1) };
      const sig = `${targetCounty.id}:${currentMetricRef.current}:${tractScale.ext[0]}:${tractScale.ext[1]}:${tractScale.bins.join(',')}`;
      if (lastScaleSigRef.current !== sig) {
        lastScaleSigRef.current = sig;
        onScaleReadyRef.current({
          bins: tractScale.bins,
          lo: mInfo.f(tractScale.ext[0]),
          hi: mInfo.f(tractScale.ext[1]),
          title: mInfo.short,
          note: 'Tracts'
        });
      }
    }

    // 7. Notify parent callback
    if (onCountySelectRef.current) {
      onCountySelectRef.current(targetCounty.id);
    }
  }, [focusTractIds]);

  // Stable string key for focus tract ids to prevent redundant effect triggers
  const focusTractsKey = focusTractIds.slice().sort().join(',');

  useEffect(() => {
    let isMounted = true;
    const isRM = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    async function initOrUpdate() {
      if (!containerRef.current) return;
      const container = containerRef.current;

      // 1. Load Geo & Repository Data (Only loaded once into cache)
      if (!repoDataRef.current) {
        if (!topoCache) {
          try {
            const res = await fetch('/us-counties.json');
            if (!res.ok) throw new Error('Failed to load county map data');
            topoCache = await res.json();
          } catch (e) {
            console.error(e);
            return;
          }
        }
        if (!isMounted || !topoCache) return;

        const repo = await getCountyRepository();
        const statesFeatures = (topojson.feature(topoCache, topoCache.objects.states) as any).features;

        repoDataRef.current = {
          counties: repo.counties,
          countyById: repo.countyById,
          countiesByState: repo.countiesByState,
          statesFeatures
        };
      }

      if (!isMounted || !repoDataRef.current) return;
      const { counties, countyById, countiesByState, statesFeatures } = repoDataRef.current;

      // Identify target county and state
      const targetCounty = countyById.get(countyFips) ||
        counties.find(c => c.id === countyFips) ||
        countyById.get('53033') ||
        counties[0];

      if (!targetCounty) return;

      const statePrefix = targetCounty.st || targetCounty.id.slice(0, 2);
      const stateFeature = statesFeatures.find(
        (s: any) => s.id === statePrefix || s.id.toString().padStart(2, '0') === statePrefix
      );

      const pathGen = d3.geoPath();
      const countyD = targetCounty.d || pathGen(targetCounty.feature) || '';
      const countyBounds = pathGen.bounds(targetCounty.feature);
      const countyTargetTransform = getBoundsTransform(countyBounds, 0.7);

      const stateBounds = stateFeature ? pathGen.bounds(stateFeature) : countyBounds;
      const stateOverviewTransform = getBoundsTransform(stateBounds, 0.9);

      const stateCounties = countiesByState.get(statePrefix) || counties.filter(c => c.st === statePrefix);

      // Color Scales
      const countyScale = buildColorScale(
        metric,
        stateCounties.map(c => getV(c, metric)),
        layerOf(metric)
      );

      // Get full deterministic set of tracts with varied metric distribution
      const effectiveTracts = getTractsForCounty(targetCounty, tracts);
      const tractValues = effectiveTracts.map(t => getV(t, metric));
      const tractScale = buildColorScale(
        metric,
        tractValues,
        layerOf(metric)
      );

      // Notify parent about legend scale only if changed
      const mInfo = METRICS[metric] || { short: metric, f: (v: number) => v.toFixed(1) };
      const currentScaleSig = `${targetCounty.id}:${metric}:${tractScale.bins.join(',')}:${tractScale.ext.join(',')}`;
      if (onScaleReadyRef.current && lastScaleSigRef.current !== currentScaleSig) {
        lastScaleSigRef.current = currentScaleSig;
        onScaleReadyRef.current({
          bins: tractScale.bins,
          lo: mInfo.f(tractScale.ext[0]),
          hi: mInfo.f(tractScale.ext[1]),
          title: mInfo.short,
          note: 'Tracts'
        });
      }

      // Determine focus tracts cohort
      const focusSet = new Set(
        focusTractIds && focusTractIds.length > 0
          ? focusTractIds
          : effectiveTracts.filter(t => (t.tier ?? Math.floor(t.svi * 5)) >= 3).map(t => getTractId(t))
      );

      // --- FIRST TIME INITIALIZATION: Run exactly once ---
      if (!mapInitializedRef.current || !svgRef.current || !gRootRef.current) {
        container.innerHTML = '';
        container.classList.add('map-shell');

        // Loading Skeleton matching prototype (entire_website.html lines 5-6)
        const skel = document.createElement('div');
        skel.className = 'map-skel skeleton';
        container.appendChild(skel);
        setTimeout(() => {
          skel.classList.add('done');
          setTimeout(() => skel.remove(), 700);
        }, isRM ? 0 : 450);

        const uid = 'rp-' + Math.random().toString(36).substring(2, 7);

        // SVG Container matching prototype (entire_website.html line 7)
        const svg = d3.select(container)
          .append('svg')
          .attr('class', 'map-svg dim-others')
          .attr('viewBox', '0 0 975 610')
          .attr('preserveAspectRatio', 'xMidYMid meet')
          .attr('role', 'img')
          .attr('aria-label', 'Interactive county map of the United States')
          .style('width', '100%')
          .style('height', '100%')
          .style('display', 'block')
          .style('background', 'transparent');

        svgRef.current = svg;

        // Defs: County ClipPath
        const defs = svg.append('defs');
        const clipPathEl = defs.append('clipPath').attr('id', uid + 'clip').append('path').attr('d', countyD);
        clipPathRef.current = clipPathEl;

        // Root Camera Group
        const gRoot = svg.append('g').attr('class', 'map-root');
        gRootRef.current = gRoot;

        // Layer subgroups matching prototype MapView hierarchy (lines 16-22)
        const gC = gRoot.append('g').attr('class', 'state-counties');
        const gB = gRoot.append('g').attr('class', 'state-boundary');
        const gT = gRoot.append('g').attr('class', 'tracts-group').attr('clip-path', `url(#${uid}clip)`);
        const gSel = gRoot.append('g').attr('class', 'target-county-outline');

        gCRef.current = gC;
        gBRef.current = gB;
        gTRef.current = gT;
        gSelRef.current = gSel;

        // 1. Neighbouring Counties in State Scope
        gC.selectAll<SVGPathElement, CountyRecord>('path.county')
          .data(stateCounties, d => d.id)
          .join('path')
          .attr('class', d => `county ${d.id === targetCounty.id ? 'sel' : ''}`)
          .attr('d', d => d.d || pathGen(d.feature) || '')
          .attr('fill', d => countyScale.fn(getV(d, metric)))
          .attr('vector-effect', 'non-scaling-stroke')
          .on('pointerenter', function (event, d) {
            const m = METRICS[metric] || { short: metric, f: (v: number) => v.toFixed(1) };
            showTip(
              `<b>${escapeHtml(countyLabel(d))}</b>${tipRows([
                [m.short, m.f(getV(d, metric))],
                ['Vulnerability', d.svi.toFixed(2)],
                ['Population', fmt.k(d.pop)]
              ])}<div class="note" style="margin-top:5px">Synthetic demo values</div>`,
              event
            );
          })
          .on('pointermove', moveTip)
          .on('pointerleave', hideTip)
          .on('click', function (event, d) {
            event.stopPropagation();
            hideTip();
            selectCounty(d, true);
          });

        // 2. State Boundary (.nation-b)
        if (stateFeature) {
          gB.append('path')
            .attr('class', 'nation-b')
            .attr('d', pathGen(stateFeature) || '')
            .attr('vector-effect', 'non-scaling-stroke')
            .style('pointer-events', 'none');
        }

        // 3. Focused County Outline (.sel-outline)
        gSel.append('path')
          .attr('class', 'sel-outline')
          .attr('d', countyD)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('pointer-events', 'none');

        // 4. Initial Camera Fly-in Transition: Exactly once on mount
        gRoot.attr('transform', stateOverviewTransform.toString());
        gRoot.transition('cam')
          .duration(isRM ? 0 : 900)
          .ease(d3.easeCubicInOut)
          .attr('transform', countyTargetTransform.toString());

        // 5. Initial Tracts Render with Staggered Entrance & Boundary Draw Sweep
        renderTracts(
          gT,
          targetCounty,
          countyBounds,
          countyD,
          effectiveTracts,
          metric,
          tractScale,
          focusSet,
          isRM
        );

        mapInitializedRef.current = true;
        lastRenderedCountyRef.current = targetCounty.id;
        currentMetricRef.current = metric;
        currentScopeStateRef.current = statePrefix;
        return;
      }

      // --- SUBSEQUENT UPDATES: Only update what actually changed ---
      const gRoot = gRootRef.current;
      const gC = gCRef.current;
      const gB = gBRef.current;
      const gT = gTRef.current;
      const gSel = gSelRef.current;
      const clipPathEl = clipPathRef.current;

      if (!gRoot || !gC || !gB || !gT || !gSel || !clipPathEl) return;

      const countyChanged = lastRenderedCountyRef.current !== targetCounty.id;
      const stateChanged = currentScopeStateRef.current !== statePrefix;
      const metricChanged = currentMetricRef.current !== metric;

      currentMetricRef.current = metric;
      currentScopeStateRef.current = statePrefix;

      // If State changed, update boundaries & state counties
      if (stateChanged) {
        gB.selectAll('*').remove();
        if (stateFeature) {
          gB.append('path')
            .attr('class', 'nation-b')
            .attr('d', pathGen(stateFeature) || '')
            .attr('vector-effect', 'non-scaling-stroke')
            .style('pointer-events', 'none');
        }

        const countyPaths = gC.selectAll<SVGPathElement, CountyRecord>('path.county')
          .data(stateCounties, d => d.id);
        countyPaths.exit().remove();
        countyPaths.enter()
          .append('path')
          .attr('class', d => `county ${d.id === targetCounty.id ? 'sel' : ''}`)
          .attr('d', d => d.d || pathGen(d.feature) || '')
          .attr('vector-effect', 'non-scaling-stroke')
          .on('pointerenter', function (event, d) {
            const m = METRICS[metric] || { short: metric, f: (v: number) => v.toFixed(1) };
            showTip(
              `<b>${escapeHtml(countyLabel(d))}</b>${tipRows([
                [m.short, m.f(getV(d, metric))],
                ['Vulnerability', d.svi.toFixed(2)],
                ['Population', fmt.k(d.pop)]
              ])}<div class="note" style="margin-top:5px">Synthetic demo values</div>`,
              event
            );
          })
          .on('pointermove', moveTip)
          .on('pointerleave', hideTip)
          .on('click', function (event, d) {
            event.stopPropagation();
            hideTip();
            selectCounty(d, true);
          });
      }

      // If Metric changed, smoothly recolor neighbouring counties
      if (metricChanged && !isRM) {
        gC.selectAll<SVGPathElement, CountyRecord>('path.county')
          .transition('fill')
          .duration(520)
          .delay((d: any) => ((d.cx || 487) / 975) * 650)
          .attr('fill', d => countyScale.fn(getV(d, metric)));
      } else {
        gC.selectAll<SVGPathElement, CountyRecord>('path.county')
          .attr('fill', d => countyScale.fn(getV(d, metric)));
      }

      // If County changed via props: Bring it into focus with camera glide & tract sweep
      if (countyChanged) {
        selectCounty(targetCounty, true);
      } else {
        // SAME county: Smoothly update existing tracts with distinct colors & focus outline
        updateTracts(gT, effectiveTracts, metric, tractScale, focusSet);
      }
    }

    initOrUpdate();

    return () => {
      isMounted = false;
      hideTip();
    };
  }, [countyFips, metric, focusTractsKey, tracts, selectCounty]);

  return (
    <div
      ref={containerRef}
      className="map-shell w-full h-full select-none"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    />
  );
}

// Sub-routine: Fresh render of tracts (with distinct colors, amber focus outlines, and sweep)
function renderTracts(
  gT: d3.Selection<SVGGElement, unknown, null, undefined>,
  county: CountyRecord,
  countyBounds: [[number, number], [number, number]],
  countyD: string,
  tractList: CensusTract[],
  metric: string,
  tractScale: { fn: (v: number) => string },
  focusSet: Set<string>,
  isRM: boolean
) {
  gT.selectAll('*').interrupt();
  gT.selectAll('*').remove();

  const targetCount = Math.max(tractList.length, 6);
  const seeds = generateVoronoiSeeds(
    countyBounds,
    countyD,
    targetCount,
    county.urban ?? 0.65,
    county.id
  );

  const [[x0, y0], [x1, y1]] = countyBounds;
  const delaunay = d3.Delaunay.from(seeds);
  const voronoi = delaunay.voronoi([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);

  const paths = gT.selectAll<SVGPathElement, CensusTract>('path.tract')
    .data(tractList, (d, i) => getTractId(d) || String(i))
    .join('path')
    .attr('class', t => `tract ${focusSet.has(getTractId(t)) ? 'cmp' : ''}`)
    .attr('d', (_, i) => voronoi.renderCell(i) || '')
    .attr('data-id', t => getTractId(t))
    .attr('fill', t => tractScale.fn(getV(t, metric)))
    .attr('stroke', t => focusSet.has(getTractId(t)) ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)')
    .attr('stroke-width', t => focusSet.has(getTractId(t)) ? 2.2 : 0.65)
    .attr('vector-effect', 'non-scaling-stroke');

  // Staggered Opacity Fade Entrance matching prototype (entire_website.html line 120)
  if (!isRM) {
    paths.attr('opacity', 0)
      .transition('tin')
      .delay((_, i) => 350 + i * 12)
      .duration(450)
      .attr('opacity', 1);

    // Staggered Boundary "Draw" Sweep matching prototype (entire_website.html lines 122-124)
    paths.each(function () {
      const elNode = this as SVGPathElement;
      const L = elNode.getTotalLength ? elNode.getTotalLength() : 0;
      d3.select(this)
        .attr('stroke-dasharray', `${L} ${L}`)
        .attr('stroke-dashoffset', L);
    })
    .transition('tdraw')
    .delay((_, i) => 300 + i * 12)
    .duration(900)
    .ease(d3.easeCubicOut)
    .attr('stroke-dashoffset', 0)
    .on('end', function () {
      d3.select(this).attr('stroke-dasharray', null);
    });
  } else {
    paths.attr('opacity', 1);
  }

  // Tract Tooltip & Pointer Events matching prototype (lines 125-127)
  paths
    .on('pointerenter', function (event: MouseEvent, t) {
      d3.select(this)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2.4)
        .raise();

      const m = METRICS[metric] || { short: metric, f: (v: number) => v.toFixed(1) };
      const val = getV(t, metric);
      const tier = t.tier ?? Math.min(4, Math.floor((t.svi ?? 0.5) * 5));

      showTip(
        `<b>${escapeHtml(t.name)}</b>${tipRows([
          ['GEOID', getTractId(t)],
          [m.short, m.f(val)],
          ['Vulnerability tier', TIER_LABEL[tier] || 'Moderate'],
          ['Population', fmt.int(t.population || (t as any).pop || 4000)]
        ])}`,
        event
      );
    })
    .on('pointermove', function (event: MouseEvent) {
      moveTip(event);
    })
    .on('pointerleave', function (_, t) {
      const isFocus = focusSet.has(getTractId(t));
      d3.select(this)
        .attr('stroke', isFocus ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)')
        .attr('stroke-width', isFocus ? 2.2 : 0.65);
      hideTip();
    });
}

// Sub-routine: Smooth update of existing tracts without resetting camera or re-animating from scratch
function updateTracts(
  gT: d3.Selection<SVGGElement, unknown, null, undefined>,
  tractList: CensusTract[],
  metric: string,
  tractScale: { fn: (v: number) => string },
  focusSet: Set<string>
) {
  const existingPaths = gT.selectAll<SVGPathElement, CensusTract>('path.tract');
  if (existingPaths.empty()) return;

  const paths = existingPaths.data(tractList, (d, i) => getTractId(d) || String(i));

  paths
    .classed('cmp', t => focusSet.has(getTractId(t)))
    .attr('fill', t => tractScale.fn(getV(t, metric)))
    .attr('stroke', t => (focusSet.has(getTractId(t)) ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)'))
    .attr('stroke-width', t => (focusSet.has(getTractId(t)) ? 2.2 : 0.65));
}
