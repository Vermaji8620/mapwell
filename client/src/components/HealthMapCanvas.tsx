'use client';

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { useRouter } from 'next/navigation';
import { CountyRecord, getCountyRepository, STATE_META } from '@/utils/countyRepository';
import { TIER_LABELS, TIER_COLORS } from '@/config/metrics';
import { Icon } from '@/components/Icons';

/* ===== Layers Definition from Prototype ===== */
export interface LayerDef {
  id: string;
  name: string;
  desc: string;
  metrics: string[];
  ramp: string[];
}

export const LAYERS: LayerDef[] = [
  {
    id: 'sdoh',
    name: 'Social determinants of health',
    desc: 'Poverty, education, housing, employment',
    metrics: ['sdoh', 'poverty', 'noDiploma', 'rentBurden', 'unemployment', 'noVehicle'],
    ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D']
  },
  {
    id: 'disease',
    name: 'Disease incidence',
    desc: 'Chronic condition prevalence',
    metrics: ['incidence', 'diabetes', 'hypertension', 'asthma', 'obesity', 'copd'],
    ramp: ['#BDEFF0', '#37C8CF', '#2A9FD6', '#2565C8', '#173F8A']
  },
  {
    id: 'program',
    name: 'Program utilization',
    desc: 'Enrollment among eligible residents',
    metrics: ['utilization', 'prog.wic', 'prog.imm', 'prog.dpp', 'prog.tob', 'prog.mhv'],
    ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D']
  },
  {
    id: 'access',
    name: 'Healthcare access',
    desc: 'Coverage, clinicians, travel time',
    metrics: ['access', 'uninsured', 'pcp', 'driveTime'],
    ramp: ['#C6EAF7', '#7FC6F2', '#3B97E6', '#1F63C6', '#143F86']
  },
  {
    id: 'vuln',
    name: 'Community vulnerability',
    desc: 'Composite social vulnerability',
    metrics: ['svi', 'childPoverty', 'crowding', 'lifeExp'],
    ramp: ['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E']
  }
];

/* ===== Formatters ===== */
const fmt = {
  k: (v: number) =>
    v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : Math.round(v) + '',
  int: (v: number) => Math.round(v).toLocaleString(),
  usd: (v: number) => '$' + Math.round(v).toLocaleString()
};

/* ===== Metric Registry from Prototype ===== */
export interface MetricMeta {
  label: string;
  short: string;
  f: (v: number) => string;
  bad: 'high' | 'low' | 'none';
  unit?: string;
}

export const METRICS: Record<string, MetricMeta> = {
  svi: { label: 'Social vulnerability index', short: 'Vulnerability', f: v => v.toFixed(2), bad: 'high', unit: '' },
  sdoh: { label: 'SDOH composite burden', short: 'SDOH burden', f: v => v.toFixed(0), bad: 'high', unit: '/100' },
  poverty: { label: 'Population below poverty line', short: 'Poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  childPoverty: { label: 'Children below poverty line', short: 'Child poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  income: { label: 'Median household income', short: 'Median income', f: v => fmt.usd(v), bad: 'low' },
  rentBurden: { label: 'Rent-burdened households', short: 'Rent burden', f: v => v.toFixed(1) + '%', bad: 'high' },
  oldHousing: { label: 'Housing built before 1960', short: 'Pre-1960 housing', f: v => v.toFixed(1) + '%', bad: 'high' },
  crowding: { label: 'Overcrowded housing units', short: 'Crowding', f: v => v.toFixed(1) + '%', bad: 'high' },
  noVehicle: { label: 'Households without a vehicle', short: 'No vehicle', f: v => v.toFixed(1) + '%', bad: 'high' },
  transit: { label: 'Residents within ½ mile of transit', short: 'Transit access', f: v => v.toFixed(0) + '%', bad: 'low' },
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
  pop: { label: 'Population', short: 'Population', f: v => fmt.k(v), bad: 'none' },
  'prog.wic': { label: 'WIC nutrition utilization', short: 'WIC nutrition', f: v => v.toFixed(0) + '%', bad: 'low' },
  'prog.imm': { label: 'Childhood immunization utilization', short: 'Childhood immunization', f: v => v.toFixed(0) + '%', bad: 'low' },
  'prog.dpp': { label: 'Diabetes prevention utilization', short: 'Diabetes prevention', f: v => v.toFixed(0) + '%', bad: 'low' },
  'prog.tob': { label: 'Tobacco cessation utilization', short: 'Tobacco cessation', f: v => v.toFixed(0) + '%', bad: 'low' },
  'prog.mhv': { label: 'Maternal home visiting utilization', short: 'Maternal home visiting', f: v => v.toFixed(0) + '%', bad: 'low' }
};

export function getV(rec: any, key: string): number {
  if (!rec) return 0;
  if (key.startsWith('prog.')) {
    const pk = key.slice(5);
    return rec.prog?.[pk] ?? rec.indicators?.[pk] ?? (rec.indicators as any)?.[key] ?? 40;
  }
  if (rec.indicators && rec.indicators[key] !== undefined) {
    return rec.indicators[key];
  }
  if (rec[key] !== undefined) {
    return typeof rec[key] === 'number' ? rec[key] : 0;
  }
  return 0;
}

export function countyLabel(c: any): string {
  if (!c) return '';
  const st = c.st || c.state?.id;
  const kind = ['22'].includes(st) ? 'Parish' : ['02'].includes(st) ? 'Borough' : 'County';
  const abbr = c.stateAbbr || c.state?.abbr || (STATE_META[st] ? STATE_META[st][0] : '');
  return `${c.name} ${kind}, ${abbr}`;
}

function pctRank(arr: number[], v: number): number {
  let count = 0;
  for (const x of arr) if (x < v) count++;
  return arr.length ? count / arr.length : 0.5;
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
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

function trendFor(seed: string, end: number, n: number = 10, slope: number = 0.015): number[] {
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

function SparkSVG({ vals, w = 290, h = 46, color = 'var(--cyan)' }: { vals: number[]; w?: number; h?: number; color?: string }) {
  if (!vals || vals.length < 2) return null;
  const x = d3.scaleLinear().domain([0, vals.length - 1]).range([2, w - 2]);
  const extent = d3.extent(vals) as [number, number];
  const y = d3.scaleLinear().domain(extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent).range([h - 3, 3]);
  const lineGen = d3.line<number>().x((_, i) => x(i)).y(v => y(v)).curve(d3.curveMonotoneX);
  const pathData = lineGen(vals) || '';
  const lastX = x(vals.length - 1);
  const lastY = y(vals[vals.length - 1]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <path d={pathData} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="3" fill={color} />
    </svg>
  );
}

/* ===== Toast helper matching prototype ===== */
function showToast(msg: string, action?: { label: string; fn: () => void }) {
  const container = document.getElementById('toasts');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><span>${msg}</span>${action ? `<button class="btn sm">${action.label}</button>` : ''}`;
  if (action) {
    t.querySelector('button')?.addEventListener('click', () => {
      action.fn();
      t.remove();
    });
  }
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(30px)';
    t.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => t.remove(), 320);
  }, 4200);
}

/* ===== Tooltip helpers matching prototype ===== */
function showTip(html: string, e: MouseEvent | React.MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  moveTip(e);
}

function moveTip(e: MouseEvent | React.MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t || !e) return;
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + 16, y = e.clientY + 14;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}

function hideTip() {
  const t = document.getElementById('tooltip');
  if (t) t.classList.remove('on');
}

const tipRows = (rows: [string, string | number][]) =>
  rows.map(([a, b]) => `<div class="tv"><span>${a}</span><span>${b}</span></div>`).join('');

let topoCache: any = null;
const tractCache = new Map<string, any[]>();

export interface HealthMapCanvasProps {
  initialCountyId?: string;
  initialTractId?: string;
  initialLayerId?: string;
  initialMetric?: string;
  jurisdictionCountyId?: string;
  onCountySelect?: (county: CountyRecord) => void;
  onTractSelect?: (tract: any) => void;
  onLayerSelect?: () => void;
  onAddFinding?: (tract: any) => void;
  compareTractIds?: string[];
  flaggedTractIds?: string[];
  onToggleCompare?: (tractId: string) => void;
  onToggleFlag?: (tractId: string) => void;
}

export function HealthMapCanvas({
  initialCountyId,
  initialTractId,
  initialLayerId,
  initialMetric,
  jurisdictionCountyId,
  onCountySelect,
  onTractSelect,
  onLayerSelect,
  onAddFinding,
  compareTractIds = [],
  flaggedTractIds = [],
  onToggleCompare,
  onToggleFlag
}: HealthMapCanvasProps) {
  const router = useRouter();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const rootGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const countiesGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const tractsGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const selGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const heatGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const markersGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const clipPathRef = useRef<d3.Selection<SVGPathElement, unknown, null, undefined> | null>(null);
  const homeTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const pathGenRef = useRef<d3.GeoPath>(d3.geoPath());

  const repoRef = useRef<any>(null);
  const stateByRef = useRef<Record<string, any>>({});
  const countiesRef = useRef<CountyRecord[]>([]);
  const [counties, setCounties] = useState<CountyRecord[]>([]);

  // Default to the 2nd layer: 'disease' (Disease incidence)
  const defaultLayer = LAYERS[1] || LAYERS[0];
  const resolvedInitialLayer = initialLayerId || defaultLayer.id; // 'disease'
  const resolvedInitialMetric =
    initialMetric ||
    (LAYERS.find((l) => l.id === resolvedInitialLayer)?.metrics[0] ?? defaultLayer.metrics[0]); // 'incidence'

  // Map state
  const [curLayerId, setCurLayerId] = useState<string>(resolvedInitialLayer);
  const [curMetric, setCurMetric] = useState<string>(resolvedInitialMetric);
  const [scope, setScope] = useState<{ st: string | null; c: string | null; t: string | null }>({
    st: null,
    c: null,
    t: null
  });

  const curLayerIdRef = useRef(curLayerId);
  curLayerIdRef.current = curLayerId;
  const curMetricRef = useRef(curMetric);
  curMetricRef.current = curMetric;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const [heat, setHeat] = useState<boolean>(false);
  const [markers, setMarkers] = useState<boolean>(true);
  const [mobileLayersOpen, setMobileLayersOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [perfInfo, setPerfInfo] = useState<{ n: number; ms: number } | null>(null);
  const [legend, setLegend] = useState<{
    title: string;
    bins: string[];
    lo: string;
    hi: string;
    note: string;
  } | null>(null);

  // Finding modal state
  const [findingModalTract, setFindingModalTract] = useState<any | null>(null);
  const [findingNote, setFindingNote] = useState<string>('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('__new');
  const [assessments, setAssessments] = useState<any[]>([]);

  // Tracts for currently selected county
  const [countyTracts, setCountyTracts] = useState<any[]>([]);

  const compareSet = useMemo(() => new Set(compareTractIds), [compareTractIds]);
  const flaggedSet = useMemo(() => new Set(flaggedTractIds), [flaggedTractIds]);

  const activeLayerDef = useMemo(
    () => LAYERS.find(l => l.id === curLayerId) || LAYERS[0],
    [curLayerId]
  );
  const curMetricObj = useMemo(
    () => METRICS[curMetric] || { label: curMetric, short: curMetric, f: (v: number) => String(v), bad: 'high' as const },
    [curMetric]
  );

  // Helper to compute tracts with realistic Voronoi cells clipped to county
  const getTractsForCounty = useCallback((cRecord: CountyRecord): any[] => {
    if (tractCache.has(cRecord.id)) {
      return tractCache.get(cRecord.id)!;
    }
    const pathGen = pathGenRef.current;
    const [[bx0, by0], [bx1, by1]] = pathGen.bounds(cRecord.feature);
    const bw = Math.max(bx1 - bx0, 10);
    const bh = Math.max(by1 - by0, 10);
    const n = Math.min(140, Math.max(6, Math.round(Math.sqrt(cRecord.pop) / 11)));
    const r = rng(hash('t' + cRecord.id));
    const pts: [number, number][] = [];
    const core = [bx0 + bw * (0.3 + r() * 0.4), by0 + bh * (0.3 + r() * 0.4)];
    let guard = 0;
    while (pts.length < n && guard++ < n * 80) {
      let x = bx0 + r() * bw, y = by0 + r() * bh;
      if (r() < cRecord.urban * 0.7) {
        x = core[0] + gauss(r) * bw * 0.16;
        y = core[1] + gauss(r) * bh * 0.16;
      }
      pts.push([x, y]);
    }
    if (pts.length < 3) {
      pts.push([bx0 + bw * 0.5, by0 + bh * 0.5], [bx0 + 1, by0 + 1], [bx0 + bw - 1, by0 + bh - 1]);
    }
    const delaunay = d3.Delaunay.from(pts);
    const voronoi = delaunay.voronoi([bx0 - 1, by0 - 1, bx1 + 1, by1 + 1]);

    const out = pts.map((p, i) => {
      const rr = rng(hash(cRecord.id + ':' + i));
      const ln = () => gauss(rr);
      const k = ln() * 0.12;
      const tnum = 100 + i * 2 + Math.floor(rr() * 2);
      const suffix = rr() < 0.35 ? '.0' + (1 + Math.floor(rr() * 2)) : '';
      const geoid = cRecord.id + String(tnum).padStart(4, '0') + (suffix ? suffix.slice(1).padStart(2, '0') : '00');
      const svi = Math.min(0.99, Math.max(0.01, cRecord.svi + k * 1.1 + ln() * 0.05));
      const tier = Math.min(4, Math.max(0, Math.floor(svi * 5)));
      const t: any = {
        id: geoid,
        name: 'Census Tract ' + tnum + suffix,
        county: cRecord,
        cx: p[0],
        cy: p[1],
        d: voronoi.renderCell(i) || '',
        pop: Math.round(Math.min(8200, Math.max(1200, 2400 + rr() * 4800))),
        svi: Math.round(svi * 100) / 100,
        tier,
        poverty: Math.round(Math.min(58, Math.max(1.5, cRecord.indicators.poverty * (1 + k * 2.2) + ln() * 2)) * 10) / 10,
        uninsured: Math.round(Math.min(40, Math.max(1, cRecord.indicators.uninsured * (1 + k * 2) + ln() * 1.5)) * 10) / 10,
        diabetes: Math.round(Math.min(24, Math.max(3.5, cRecord.indicators.diabetes * (1 + k * 1.2) + ln() * 0.6)) * 10) / 10,
        asthma: Math.round(Math.min(17, Math.max(5.5, cRecord.indicators.asthma * (1 + k * 0.7) + ln() * 0.4)) * 10) / 10,
        hypertension: Math.round(Math.min(55, Math.max(18, cRecord.indicators.hypertension * (1 + k * 0.8) + ln() * 1.4)) * 10) / 10,
        noVehicle: Math.round(Math.min(44, Math.max(0.3, cRecord.indicators.noVehicle * (1 + k * 2) + ln() * 1.5)) * 10) / 10,
        noDiploma: Math.round(Math.min(45, Math.max(1, cRecord.indicators.noDiploma * (1 + k * 1.8) + ln() * 1.5)) * 10) / 10,
        unemployment: Math.round(Math.min(22, Math.max(1, cRecord.indicators.unemployment * (1 + k * 1.7) + ln() * 0.6)) * 10) / 10,
        utilization: Math.round(Math.min(95, Math.max(4, cRecord.indicators.utilization * (1 - k * 1.4) + ln() * 4))),
        access: Math.round(Math.min(98, Math.max(4, cRecord.indicators.access * (1 - k * 1.1) + ln() * 4))),
        lifeExp: Math.round(Math.min(87, Math.max(65, cRecord.indicators.lifeExp - k * 5 + ln() * 0.8)) * 10) / 10,
        childPoverty: Math.round(Math.min(65, Math.max(2, cRecord.indicators.childPoverty * (1 + k * 2) + ln() * 2)) * 10) / 10,
        rentBurden: Math.round(Math.min(68, Math.max(6, cRecord.indicators.rentBurden * (1 + k * 1.4) + ln() * 2)) * 10) / 10,
        crowding: Math.round(Math.min(22, Math.max(0.1, cRecord.indicators.crowding * (1 + k * 2) + ln() * 0.8)) * 10) / 10,
        pcp: Math.round(Math.min(220, Math.max(8, cRecord.indicators.pcp * (1 - k * 0.8) + ln() * 10))),
        driveTime: Math.round(Math.min(85, Math.max(2, cRecord.indicators.driveTime * (1 + k * 0.9) + ln() * 3))),
        sdoh: Math.round(Math.min(98, Math.max(2, cRecord.indicators.sdoh + k * 35 + ln() * 3))),
        incidence: Math.round(Math.min(98, Math.max(2, cRecord.indicators.incidence + k * 30 + ln() * 3)))
      };
      t.indicators = { ...t };
      return t;
    });
    tractCache.set(cRecord.id, out);
    return out;
  }, []);

  // Need calculation helper
  const needOf = useCallback((rec: any, metricKey: string) => {
    const m = METRICS[metricKey] || { bad: 'high' };
    const v = getV(rec, metricKey);
    return m.bad === 'low' ? -v : v;
  }, []);

  // Draw Heatmap circles
  const drawHeatmap = useCallback((isHeat: boolean, mKey: string, cRecord: CountyRecord | null) => {
    const gHeat = heatGroupRef.current;
    if (!gHeat) return;
    gHeat.selectAll('*').remove();
    if (!isHeat) return;

    if (cRecord) {
      const tracts = getTractsForCounty(cRecord);
      const sorted = [...tracts].sort((a, b) => needOf(b, mKey) - needOf(a, mKey));
      const top = sorted.slice(0, Math.max(3, Math.ceil(tracts.length * 0.35)));
      gHeat.selectAll('circle')
        .data(top)
        .join('circle')
        .attr('cx', (d: any) => d.cx)
        .attr('cy', (d: any) => d.cy)
        .attr('r', 0)
        .attr('fill', 'url(#hm-heat)')
        .transition()
        .duration(700)
        .attr('r', 18);
    } else {
      const allCounties = counties.length > 0 ? counties : countiesRef.current;
      const pool = scope.st ? (stateByRef.current[scope.st]?.counties || allCounties) : allCounties;
      const sorted = [...pool]
        .filter((c: any) => typeof c.cx === 'number' && !isNaN(c.cx) && typeof c.cy === 'number' && !isNaN(c.cy))
        .sort((a, b) => needOf(b, mKey) - needOf(a, mKey));
      const top = sorted.slice(0, Math.ceil(pool.length * 0.14));
      gHeat.selectAll('circle')
        .data(top)
        .join('circle')
        .attr('cx', (d: any) => d.cx || 0)
        .attr('cy', (d: any) => d.cy || 0)
        .attr('r', 0)
        .attr('fill', 'url(#hm-heat)')
        .transition()
        .duration(900)
        .delay((_, i) => i * 1.2)
        .attr('r', (d: any) => Math.max(6, Math.sqrt(Math.max(1, d.area || 30)) * 1.6));
    }
  }, [counties, getTractsForCounty, needOf, scope.st]);

  // Draw Pulse Markers
  const drawMarkers = useCallback((isMarkers: boolean, mKey: string, cRecord: CountyRecord | null, zoomK: number) => {
    const gM = markersGroupRef.current;
    if (!gM) return;
    gM.selectAll('*').remove();
    if (!isMarkers) return;

    let pts: { x: number; y: number }[] = [];
    if (cRecord) {
      const tracts = getTractsForCounty(cRecord);
      pts = [...tracts].sort((a, b) => needOf(b, mKey) - needOf(a, mKey)).slice(0, 3).map((t: any) => ({ x: t.cx, y: t.cy }));
    } else {
      const allCounties = counties.length > 0 ? counties : countiesRef.current;
      const pool = scope.st ? (stateByRef.current[scope.st]?.counties || allCounties) : allCounties;
      pts = [...pool]
        .filter((c: any) => typeof c.cx === 'number' && !isNaN(c.cx) && typeof c.cy === 'number' && !isNaN(c.cy))
        .sort((a, b) => needOf(b, mKey) - needOf(a, mKey))
        .slice(0, scope.st ? 4 : 7)
        .map((c: any) => ({ x: c.cx, y: c.cy }));
    }

    const k = Math.max(0.1, zoomK);
    const m = gM.selectAll('g')
      .data(pts)
      .join('g')
      .attr('class', 'pulse-m')
      .attr('transform', d => `translate(${d.x},${d.y}) scale(${1 / k})`);

    m.append('circle').attr('class', 'ring').attr('r', 7);
    m.append('circle').attr('class', 'ring r2').attr('r', 7);
    m.append('circle').attr('class', 'core').attr('r', 3.5);
  }, [counties, getTractsForCounty, needOf, scope.st]);

  // Zoom bounds helper
  const zoomToBounds = useCallback((bounds: [[number, number], [number, number]], dur = 900, pad = 0.82) => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    const [[x0, y0], [x1, y1]] = bounds;
    const dx = Math.max(x1 - x0, 1);
    const dy = Math.max(y1 - y0, 1);
    const s = Math.min(90, pad / Math.max(dx / 975, dy / 610));
    const t = d3.zoomIdentity
      .translate(975 / 2, 610 / 2)
      .scale(s)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(dur).ease(d3.easeCubicInOut).call(zoom.transform, t);
  }, []);

  // Fit padding helper
  const fitPadding = useCallback((pad: { l: number; r: number; t: number; b: number }) => {
    const el = mapContainerRef.current;
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!el || !svg || !zoom) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!W || !H) return;
    const mm = Math.min(W / 975, H / 610);
    const ox = (W - 975 * mm) / 2;
    const oy = (H - 610 * mm) / 2;
    const r = [(pad.l - ox) / mm, (pad.t - oy) / mm, (W - pad.r - ox) / mm, (H - pad.b - oy) / mm];
    const s = Math.min((r[2] - r[0]) / 975, (r[3] - r[1]) / 610) * 0.97;
    const home = d3.zoomIdentity.translate((r[0] + r[2]) / 2 - s * 487.5, (r[1] + r[3]) / 2 - s * 305).scale(s);
    homeTransformRef.current = home;
    svg.call(zoom.transform, home);
  }, []);

  // Colorize Counties and Tracts helper matching prototype line 1315-1327
  const colorize = useCallback((mKey: string, lId: string, currentScope: { st: string | null; c: string | null; t: string | null }, animate = true) => {
    const countiesGroup = countiesGroupRef.current;
    const tractsGroup = tractsGroupRef.current;
    const allCounties = countiesRef.current;
    if (!countiesGroup || !allCounties.length) return;

    const t0 = performance.now();
    const lyr = LAYERS.find(l => l.id === lId) || LAYERS[0];
    const mMeta = METRICS[mKey] || { bad: 'high', label: mKey };

    // Domain & color scale matching prototype colorScale() line 1094-1104
    const values = allCounties.map(c => getV(c, mKey));
    const low = typeof window !== 'undefined'
      ? (getComputedStyle(document.documentElement).getPropertyValue('--map-low').trim() || '#101B45')
      : '#101B45';
    const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
      d3.interpolateRgb(low, lyr.ramp[0])(0.6),
      ...lyr.ramp
    ]);
    const qScale = d3.scaleQuantile().domain(values).range(d3.range(7));
    const flip = mMeta.bad === 'low';
    const tOf = (i: number) => {
      const t = (i + 0.5) / 7;
      return flip ? 1 - t : t;
    };
    const getColor = (v: number) => interp(tOf(qScale(v)));
    const bins = d3.range(7).map(i => interp(tOf(i)));
    const extent = d3.extent(values) as [number, number];

    // Colorize counties matching prototype line 1320-1321
    const countyPaths = countiesGroup.selectAll<SVGPathElement, CountyRecord>('path.county');
    if (animate) {
      countyPaths
        .transition('fill')
        .duration(520)
        .delay((d: any) => (d.cx / 975) * 650)
        .attr('fill', d => getColor(getV(d, mKey)));
    } else {
      countyPaths.attr('fill', d => getColor(getV(d, mKey)));
    }

    // If county selected, color tracts matching prototype line 1341-1345
    let tractScaleBins: string[] | null = null;
    let tractExt: [number, number] | null = null;

    if (currentScope.c && repoRef.current?.countyById.has(currentScope.c)) {
      const cRecord = repoRef.current.countyById.get(currentScope.c)!;
      const tracts = getTractsForCounty(cRecord);
      const tValues = tracts.map(t => getV(t, mKey));
      const tQScale = d3.scaleQuantile().domain(tValues).range(d3.range(7));
      const getTractColor = (v: number) => interp(tOf(tQScale(v)));
      tractScaleBins = d3.range(7).map(i => interp(tOf(i)));
      tractExt = d3.extent(tValues) as [number, number];

      const sel = tractsGroup?.selectAll<SVGPathElement, any>('path.tract');
      if (sel) {
        if (animate) {
          sel.transition('fill')
            .duration(500)
            .delay((_, i) => i * 6)
            .attr('fill', t => getTractColor(getV(t, mKey)));
        } else {
          sel.attr('fill', t => getTractColor(getV(t, mKey)));
        }
      }
    }

    const ms = Math.round(performance.now() - t0);
    setPerfInfo({ n: allCounties.length, ms: Math.max(8, ms) });

    // Update legend
    if (currentScope.c && tractScaleBins && tractExt) {
      setLegend({
        title: mMeta.label || lyr.name,
        bins: tractScaleBins,
        lo: mMeta.f ? mMeta.f(tractExt[0]) : `${tractExt[0].toFixed(1)}%`,
        hi: mMeta.f ? mMeta.f(tractExt[1]) : `${tractExt[1].toFixed(1)}%`,
        note: 'Tracts in county'
      });
    } else {
      setLegend({
        title: mMeta.label || lyr.name,
        bins,
        lo: mMeta.f ? mMeta.f(extent[0]) : `${extent[0].toFixed(1)}%`,
        hi: mMeta.f ? mMeta.f(extent[1]) : `${extent[1].toFixed(1)}%`,
        note: 'Quantile bins'
      });
    }
  }, [getTractsForCounty]);

  // Synchronize Hotspot heatmap and Highest-need markers
  useEffect(() => {
    if (!svgRef.current || (!counties.length && !countiesRef.current.length)) return;
    const cRecord = scope.c && repoRef.current?.countyById.has(scope.c)
      ? repoRef.current.countyById.get(scope.c)
      : null;
    const currentK = svgRef.current ? d3.zoomTransform(svgRef.current.node()!).k : 1;
    drawHeatmap(heat, curMetric, cRecord);
    drawMarkers(markers, curMetric, cRecord, currentK);
  }, [heat, markers, curMetric, scope.c, scope.st, counties, drawHeatmap, drawMarkers]);

  // Initialize Map
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!mapContainerRef.current) return;
      const el = mapContainerRef.current;
      el.innerHTML = '';
      el.classList.add('map-shell');

      // Map skeleton loader matching prototype line 1243
      const skel = document.createElement('div');
      skel.className = 'map-skel skeleton';
      el.appendChild(skel);
      setTimeout(() => {
        skel.classList.add('done');
        setTimeout(() => skel.remove(), 700);
      }, 450);

      const repo = await getCountyRepository();
      if (cancelled || !mapContainerRef.current) return;
      repoRef.current = repo;

      if (!topoCache) {
        try {
          const res = await fetch('/us-counties.json');
          if (!res.ok) throw new Error('Failed to load topology');
          topoCache = await res.json();
        } catch (e) {
          console.error(e);
          return;
        }
      }
      if (cancelled || !topoCache) return;

      const pathGen = d3.geoPath();
      pathGenRef.current = pathGen;

      // Extract features
      const statesMesh = topojson.mesh(topoCache, topoCache.objects.states, (a: any, b: any) => a !== b);
      const nationFeature = topojson.feature(topoCache, topoCache.objects.nation);
      const stateFeatures = (topojson.feature(topoCache, topoCache.objects.states) as any).features || [];

      const stateBy: Record<string, any> = {};
      stateFeatures.forEach((f: any) => {
        const m = STATE_META[f.id];
        if (m) {
          stateBy[f.id] = { id: f.id, abbr: m[0], name: m[1], region: m[2], feature: f, d: pathGen(f), counties: [] };
        }
      });
      stateByRef.current = stateBy;

      // Attach centroid, area, d to counties
      repo.counties.forEach((c: any) => {
        const f = c.feature;
        const centroid = pathGen.centroid(f);
        const area = pathGen.area(f);
        c.cx = centroid[0];
        c.cy = centroid[1];
        c.area = area;
        c.d = pathGen(f);
        if (stateBy[c.st]) {
          stateBy[c.st].counties.push(c);
        }
      });
      countiesRef.current = repo.counties;
      setCounties(repo.counties);

      // SVG
      const svg = d3.select(el)
        .append('svg')
        .attr('class', 'map-svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('role', 'img')
        .attr('aria-label', 'Interactive county map of the United States')
        .style('position', 'absolute')
        .style('inset', '0')
        .style('width', '100%')
        .style('height', '100%');

      svgRef.current = svg;

      const defs = svg.append('defs');

      // Heatmap radial gradient
      const rg = defs.append('radialGradient').attr('id', 'hm-heat');
      rg.append('stop').attr('offset', '0%').attr('stop-color', '#2584EB').attr('stop-opacity', 0.55);
      rg.append('stop').attr('offset', '55%').attr('stop-color', '#66B6F5').attr('stop-opacity', 0.2);
      rg.append('stop').attr('offset', '100%').attr('stop-color', '#66B6F5').attr('stop-opacity', 0);

      // County Tract Clip Path
      const clip = defs.append('clipPath').attr('id', 'hm-clip').append('path');
      clipPathRef.current = clip;

      // Root zoom group
      const g = svg.append('g');
      rootGroupRef.current = g;

      const gC = g.append('g');
      countiesGroupRef.current = gC;

      const gB = g.append('g');
      const gHeat = g.append('g').style('pointer-events', 'none').style('mix-blend-mode', 'multiply');
      heatGroupRef.current = gHeat;

      const gT = g.append('g').attr('clip-path', 'url(#hm-clip)');
      tractsGroupRef.current = gT;

      const gSel = g.append('g');
      selGroupRef.current = gSel;

      const gM = g.append('g').style('pointer-events', 'none');
      markersGroupRef.current = gM;

      // State and nation borders matching prototype line 1286
      const sb = gB.append('path').attr('class', 'state-b').attr('d', pathGen(statesMesh as any));
      const nb = gB.append('path').attr('class', 'nation-b').attr('d', pathGen(nationFeature as any));
      const borders: [d3.Selection<SVGPathElement, unknown, null, undefined>, number, number][] = [
        [nb, 0, 1700],
        [sb, 500, 1600]
      ];
      borders.forEach(([p, delay, dur]) => {
        const node = p.node() as SVGGeometryElement | null;
        const L = node && node.getTotalLength ? node.getTotalLength() : 0;
        if (L > 0) {
          p.attr('stroke-dasharray', `${L} ${L}`)
            .attr('stroke-dashoffset', L)
            .transition('draw')
            .delay(delay)
            .duration(dur)
            .ease(d3.easeCubicInOut)
            .attr('stroke-dashoffset', 0)
            .on('end', function () {
              d3.select(this).attr('stroke-dasharray', null);
            });
        }
      });

      // Zoom Behavior
      let currentK = 1;
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 90])
        .translateExtent([[-200, -200], [1175, 810]])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
          currentK = event.transform.k;
          gM.selectAll('.pulse-m').attr('transform', (d: any) => `translate(${d.x},${d.y}) scale(${1 / currentK})`);
        });

      svg.call(zoom).on('dblclick.zoom', null);
      zoomRef.current = zoom;

      // Fit padding: call immediately and also after sidebar collapse animation (prototype line 1977: setTimeout(fit, 420))
      const fit = () => {
        const mob = window.innerWidth <= 860;
        fitPadding(mob ? { l: 8, r: 8, t: 110, b: 70 } : { l: 330, r: window.innerWidth > 1180 ? 370 : 40, t: 60, b: 40 });
      };
      fit();
      setTimeout(fit, 120);
      setTimeout(fit, 420);

      // Render Counties
      const countiesSelection = gC.selectAll<SVGPathElement, CountyRecord>('path.county')
        .data(repo.counties, (d: any) => d.id)
        .join('path')
        .attr('class', 'county')
        .attr('d', (d: any) => d.d)
        .attr('fill', 'var(--map-low)')
        .attr('opacity', 0);

      // Entrance animation: fade in along west-to-east sweep
      countiesSelection.transition('in')
        .duration(600)
        .delay((d: any) => (d.cx / 975) * 700)
        .ease(d3.easeCubicOut)
        .attr('opacity', 1);

      // Immediately colorize counties with active metric (prototype lines 1415-1416: colorize(o.animateIn))
      colorize(curMetric, curLayerId, { st: null, c: null, t: null }, true);

      // County hover tooltip
      countiesSelection
        .on('pointerenter', (e: MouseEvent, d: CountyRecord) => {
          const currentM = curMetricRef.current || curMetric;
          const m = METRICS[currentM] || { short: currentM, f: (v: number) => String(v) };
          const tipHtml = `<b>${countyLabel(d)}</b>${tipRows([
            [m.short, m.f(getV(d, currentM))],
            ['Vulnerability', d.svi.toFixed(2)],
            ['Population', fmt.k(d.pop)]
          ])}<div class="note" style="margin-top:5px">Synthetic demo values</div>`;
          showTip(tipHtml, e);
        })
        .on('pointermove', (e: MouseEvent) => moveTip(e))
        .on('pointerleave', () => hideTip())
        .on('click', (e: MouseEvent, d: CountyRecord) => {
          e.stopPropagation();
          hideTip();
          // Drill into state on first click if zoomed out
          if (currentK < 2.2 && !scope.c) {
            handleZoomToState(d.st);
            return;
          }
          handleSelectCounty(d);
        });

      // Handle deep links if any
      const targetCounty = initialCountyId || (initialTractId && initialTractId.slice(0, 5));
      if (targetCounty && repo.countyById.has(targetCounty)) {
        setTimeout(() => {
          const c = repo.countyById.get(targetCounty)!;
          handleSelectCounty(c, initialTractId || null);
        }, 350);
      }
    }

    init();

    const handleResize = () => {
      const mob = window.innerWidth <= 860;
      fitPadding(mob ? { l: 8, r: 8, t: 110, b: 70 } : { l: 330, r: window.innerWidth > 1180 ? 370 : 40, t: 60, b: 40 });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      hideTip();
    };
  }, []); // Run once on mount

  // Theme change observer to smoothly recolor counties when theme toggles
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (countiesGroupRef.current && countiesRef.current.length) {
        colorize(curMetricRef.current, curLayerIdRef.current, scopeRef.current, true);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => observer.disconnect();
  }, [colorize]);

  // Update selection / comparison outline styles on tracts whenever compareSet or scope.t changes
  useEffect(() => {
    const tractsGroup = tractsGroupRef.current;
    if (!tractsGroup) return;
    tractsGroup.selectAll<SVGPathElement, any>('path.tract')
      .classed('cmp', d => compareSet.has(d.id))
      .classed('sel', d => d.id === scope.t);
  }, [compareSet, scope.t]);

  // Action handlers matching prototype line 1984
  const handleSelectLayer = (lyrId: string) => {
    const lyr = LAYERS.find(l => l.id === lyrId) || LAYERS[0];
    const newMetric = lyr.metrics[0];
    setCurLayerId(lyr.id);
    setCurMetric(newMetric);
    onLayerSelect?.();
    colorize(newMetric, lyr.id, scopeRef.current, true);
  };

  const handleSelectMetric = (mKey: string) => {
    setCurMetric(mKey);
    colorize(mKey, curLayerId, scopeRef.current, true);
  };

  const handleZoomToState = (st: string) => {
    const stateObj = stateByRef.current[st];
    if (!stateObj) return;
    setScope({ st, c: null, t: null });
    setCountyTracts([]);
    tractsGroupRef.current?.selectAll('*').remove();
    selGroupRef.current?.selectAll('*').remove();
    countiesGroupRef.current?.selectAll('path.county').classed('sel', false);
    svgRef.current?.classed('dim-others', false);

    const pathGen = pathGenRef.current;
    zoomToBounds(pathGen.bounds(stateObj.feature), 900, 0.9);
  };

  const handleSelectCounty = useCallback((cRecord: CountyRecord, tractIdToSelect: string | null = null) => {
    setScope({ st: cRecord.st, c: cRecord.id, t: tractIdToSelect });
    onCountySelect?.(cRecord);

    const pathGen = pathGenRef.current;
    zoomToBounds(pathGen.bounds(cRecord.feature), 900, 0.7);

    // Selected outline
    selGroupRef.current?.selectAll('*').remove();
    selGroupRef.current?.append('path')
      .attr('class', 'sel-outline')
      .attr('d', cRecord.d || pathGen(cRecord.feature));

    countiesGroupRef.current?.selectAll<SVGPathElement, CountyRecord>('path.county')
      .classed('sel', d => d.id === cRecord.id);

    svgRef.current?.classed('dim-others', true);

    // Clip path for county
    clipPathRef.current?.attr('d', cRecord.d || pathGen(cRecord.feature));

    // Render county tracts
    const tracts = getTractsForCounty(cRecord);
    setCountyTracts(tracts);

    const lyr = LAYERS.find(l => l.id === curLayerId) || LAYERS[0];
    const mMeta = METRICS[curMetric] || { bad: 'high' };
    const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
      d3.interpolateRgb('#101B45', lyr.ramp[0])(0.6),
      ...lyr.ramp
    ]);
    const tValues = tracts.map(t => getV(t, curMetric));
    const tQScale = d3.scaleQuantile().domain(tValues).range(d3.range(7));
    const flip = mMeta.bad === 'low';
    const tOf = (i: number) => {
      const t = (i + 0.5) / 7;
      return flip ? 1 - t : t;
    };
    const getTractColor = (v: number) => interp(tOf(tQScale(v)));

    const p = tractsGroupRef.current?.selectAll<SVGPathElement, any>('path.tract')
      .data(tracts, (d: any) => d.id)
      .join('path')
      .attr('class', 'tract')
      .attr('d', (d: any) => d.d)
      .attr('fill', (d: any) => getTractColor(getV(d, curMetric)))
      .attr('opacity', 0);

    p?.transition('tin')
      .delay((_: any, i: number) => 350 + i * 12)
      .duration(450)
      .attr('opacity', 1);

    // Boundary draw sweep matching prototype line 1353
    p?.each(function () {
      const node = this as SVGGeometryElement;
      const L = node && node.getTotalLength ? node.getTotalLength() : 0;
      if (L > 0) {
        d3.select(this)
          .attr('stroke-dasharray', `${L} ${L}`)
          .attr('stroke-dashoffset', L);
      }
    })
      .transition('tdraw')
      .delay((_: any, i: number) => 300 + i * 12)
      .duration(900)
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0)
      .on('end', function () {
        d3.select(this).attr('stroke-dasharray', null);
      });

    p?.on('pointerenter', (e: MouseEvent, d: any) => {
      const m = METRICS[curMetric] || { short: curMetric, f: (v: number) => String(v) };
      const tipHtml = `<b>${d.name}</b>${tipRows([
        ['GEOID', d.id],
        [m.short, m.f(getV(d, curMetric))],
        ['Vulnerability tier', TIER_LABELS[d.tier]],
        ['Population', fmt.int(d.pop)]
      ])}`;
      showTip(tipHtml, e);
    })
      .on('pointermove', (e: MouseEvent) => moveTip(e))
      .on('pointerleave', () => hideTip())
      .on('click', (e: MouseEvent, d: any) => {
        e.stopPropagation();
        hideTip();
        handleSelectTract(d);
      });

    if (tractIdToSelect) {
      const targetTract = tracts.find(t => t.id === tractIdToSelect);
      if (targetTract) handleSelectTract(targetTract);
    }
  }, [curLayerId, curMetric, getTractsForCounty, onCountySelect, zoomToBounds]);

  const handleSelectTract = useCallback((tract: any) => {
    setScope(prev => ({ ...prev, t: tract.id }));
    onTractSelect?.(tract);
  }, [onTractSelect]);

  const handleClearTract = () => {
    setScope(prev => ({ ...prev, t: null }));
  };

  const handleClearCounty = () => {
    const st = scope.st;
    if (st) {
      handleZoomToState(st);
    } else {
      handleResetHome();
    }
  };

  const handleResetHome = () => {
    setScope({ st: null, c: null, t: null });
    setCountyTracts([]);
    tractsGroupRef.current?.selectAll('*').remove();
    selGroupRef.current?.selectAll('*').remove();
    countiesGroupRef.current?.selectAll('path.county').classed('sel', false);
    svgRef.current?.classed('dim-others', false);

    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (svg && zoom) {
      svg.transition().duration(900).call(zoom.transform, homeTransformRef.current);
    }
  };

  const handleGoJurisdiction = () => {
    const defaultJurId = jurisdictionCountyId || initialCountyId || '53033';
    const c = repoRef.current?.countyById.get(defaultJurId);
    if (c) handleSelectCounty(c);
  };

  const handleZoomBy = (factor: number) => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (svg && zoom) {
      svg.transition().duration(350).call(zoom.scaleBy, factor);
    }
  };

  const handleToggleCompare = (t: any) => {
    onToggleCompare?.(t.id);
    const willBeIn = !compareSet.has(t.id);
    showToast(
      willBeIn
        ? `${t.name} added to comparison (${compareSet.size + 1})`
        : 'Removed from comparison'
    );
  };

  const handleToggleFlag = (t: any) => {
    onToggleFlag?.(t.id);
    showToast(`${t.name} flagged as underserved`, {
      label: 'Add to assessment',
      fn: () => setFindingModalTract(t)
    });
  };

  // Search hits
  const searchHits = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const all = counties.length > 0 ? counties : countiesRef.current;
    if (q.length < 2 || !all.length) return [];
    return all
      .filter(c => (c.name + ' ' + c.stateName + ' ' + c.stateAbbr).toLowerCase().includes(q))
      .slice(0, 8);
  }, [searchQuery, counties]);

  // Selected records
  const selectedCountyRecord = useMemo(() => {
    if (!scope.c || !repoRef.current) return null;
    return repoRef.current.countyById.get(scope.c) || null;
  }, [scope.c, counties]);

  const selectedTractRecord = useMemo(() => {
    if (!scope.t || countyTracts.length === 0) return null;
    return countyTracts.find(t => t.id === scope.t) || null;
  }, [scope.t, countyTracts]);

  // State metadata
  const stateMeta = useMemo(() => {
    if (!scope.st) return null;
    return STATE_META[scope.st] || null;
  }, [scope.st]);

  // Percentiles
  const tractPct = useMemo(() => {
    if (!selectedTractRecord || countyTracts.length === 0) return 0.5;
    const vals = countyTracts.map(x => getV(x, curMetric)).sort(d3.ascending);
    return pctRank(vals, getV(selectedTractRecord, curMetric));
  }, [selectedTractRecord, countyTracts, curMetric]);

  const countyPct = useMemo(() => {
    const all = counties.length > 0 ? counties : countiesRef.current;
    if (!selectedCountyRecord || all.length === 0) return 0.5;
    const vals = all.map(x => getV(x, curMetric)).sort(d3.ascending);
    return pctRank(vals, getV(selectedCountyRecord, curMetric));
  }, [selectedCountyRecord, curMetric, counties]);

  // Top tracts in county
  const topCountyTracts = useMemo(() => {
    if (!countyTracts.length) return [];
    const m = METRICS[curMetric] || { bad: 'high' };
    return [...countyTracts].sort((a, b) =>
      m.bad === 'low' ? getV(a, curMetric) - getV(b, curMetric) : getV(b, curMetric) - getV(a, curMetric)
    ).slice(0, 5);
  }, [countyTracts, curMetric]);

  // Top counties in national / state pool
  const topPoolCounties = useMemo(() => {
    const all = counties.length > 0 ? counties : countiesRef.current;
    if (!all.length) return [];
    const pool = scope.st ? (stateByRef.current[scope.st]?.counties || all) : all;
    const m = METRICS[curMetric] || { bad: 'high' };
    return [...pool].sort((a, b) =>
      m.bad === 'low' ? getV(a, curMetric) - getV(b, curMetric) : getV(b, curMetric) - getV(a, curMetric)
    ).slice(0, 8);
  }, [scope.st, curMetric, counties]);

  // Trendline for selected county
  const countyTrend = useMemo(() => {
    if (!selectedCountyRecord) return [];
    const val = getV(selectedCountyRecord, curMetric);
    return trendFor(selectedCountyRecord.id + curMetric, val);
  }, [selectedCountyRecord, curMetric]);

  // Finding modal submit
  const handleSubmitFinding = async () => {
    if (!findingModalTract) return;
    try {
      await fetch('/api/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: selectedAssessmentId === '__new' ? undefined : selectedAssessmentId,
          tractId: findingModalTract.id,
          tractName: findingModalTract.name,
          countyLabel: countyLabel(findingModalTract.county),
          note: findingNote
        })
      });
    } catch {}

    const aidName = selectedAssessmentId === '__new' ? 'new assessment' : 'assessment';
    showToast(`Finding added to ${aidName}`);
    setFindingModalTract(null);
  };

  // Sync Finding Modal open class on #modal-root
  useEffect(() => {
    const root = document.getElementById('modal-root');
    if (!root) return;
    if (findingModalTract) {
      root.classList.add('open');
      setFindingNote(
        `High-need tract: vulnerability ${findingModalTract.svi.toFixed(2)} (${TIER_LABELS[findingModalTract.tier].toLowerCase()} tier) with ${getV(findingModalTract, 'uninsured').toFixed(1)}% uninsured and ${getV(findingModalTract, 'diabetes').toFixed(1)}% diabetes prevalence. Candidate for targeted outreach.`
      );
      fetch('/api/assessments')
        .then(r => r.ok ? r.json() : [])
        .then(data => setAssessments(Array.isArray(data) ? data : data.data || []))
        .catch(() => {});
    } else {
      root.classList.remove('open');
    }
  }, [findingModalTract]);

  const inCmp = selectedTractRecord ? compareSet.has(selectedTractRecord.id) : false;
  const flagged = selectedTractRecord ? flaggedSet.has(selectedTractRecord.id) : false;

  return (
    <div className="hm">
      {/* Map Shell Viewport */}
      <div id="hm-map" ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Breadcrumbs matching prototype lines 1947 & 1987-1995 */}
      <div className="map-float hm-crumbs" id="hm-crumbs">
        <button
          data-c="us"
          className={!scope.st ? 'cur' : ''}
          onClick={handleResetHome}
        >
          United States
        </button>
        {scope.st && stateMeta && (
          <>
            <span className="sep">/</span>
            <button
              data-c="st"
              className={!scope.c ? 'cur' : ''}
              onClick={() => handleZoomToState(scope.st!)}
            >
              {stateMeta[1]}
            </button>
          </>
        )}
        {scope.c && selectedCountyRecord && (
          <>
            <span className="sep">/</span>
            <button
              data-c="c"
              className={!scope.t ? 'cur' : ''}
              onClick={() => handleSelectCounty(selectedCountyRecord)}
            >
              {selectedCountyRecord.name}
            </button>
          </>
        )}
        {scope.t && selectedTractRecord && (
          <>
            <span className="sep">/</span>
            <button className="cur">
              {selectedTractRecord.name.replace('Census ', '')}
            </button>
          </>
        )}
      </div>

      {/* Floating Left Layers & Indicators Panel matching prototype lines 1948-1960 */}
      <aside className={`map-float hm-layers ${mobileLayersOpen ? 'open' : ''}`} id="hm-layers">
        <button
          className="hm-sheet-handle"
          id="hm-handle"
          onClick={() => setMobileLayersOpen(!mobileLayersOpen)}
        >
          <span>
            <Icon name="layers" /> Layers and indicators
          </span>
          <Icon name="chevd" />
        </button>

        <div className="search" style={{ maxWidth: 'none', marginBottom: '12px' }}>
          <Icon name="search" />
          <input
            id="hm-q"
            placeholder="Search a county"
            autoComplete="off"
            aria-label="Search counties on the map"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchHits.length > 0) {
                handleSelectCounty(searchHits[0]);
                setSearchQuery('');
              }
            }}
          />
          <div className={`search-results ${searchQuery.trim().length >= 2 ? 'open' : ''}`} id="hm-qr">
            {searchQuery.trim().length >= 2 && (
              searchHits.length > 0 ? (
                searchHits.map((c) => (
                  <div
                    key={c.id}
                    className="sr-item"
                    data-c={c.id}
                    onClick={() => {
                      handleSelectCounty(c);
                      setSearchQuery('');
                    }}
                  >
                    <span>{countyLabel(c)}</span>
                    <small>{fmt.k(c.pop)}</small>
                  </div>
                ))
              ) : (
                <div className="sr-item">
                  <small>No county matches that name</small>
                </div>
              )
            )}
          </div>
        </div>

        <h3>Map layers</h3>
        <div id="hm-lb">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              className={`layer-btn ${l.id === curLayerId ? 'on' : ''}`}
              data-l={l.id}
              onClick={() => handleSelectLayer(l.id)}
            >
              <span
                className="sw"
                style={{ background: `linear-gradient(135deg,${l.ramp.join(',')})` }}
              />
              <span>
                <b>{l.name}</b>
                <small>{l.desc}</small>
              </span>
            </button>
          ))}
        </div>

        <h3 style={{ marginTop: '12px' }}>Indicator</h3>
        <div className="chips" id="hm-ind">
          {activeLayerDef.metrics.map((k) => (
            <button
              key={k}
              className={`chip ${k === curMetric ? 'on' : ''}`}
              data-k={k}
              onClick={() => handleSelectMetric(k)}
            >
              {METRICS[k]?.short || k}
            </button>
          ))}
        </div>

        <div style={{ marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '8px' }}>
          <div className="hm-toggle">
            <span>Hotspot heatmap</span>
            <button
              className={`switch ${heat ? 'on' : ''}`}
              id="sw-heat"
              role="switch"
              aria-checked={heat}
              aria-label="Hotspot heatmap"
              onClick={() => setHeat(prev => !prev)}
            />
          </div>
          <div className="hm-toggle">
            <span>Highest-need markers</span>
            <button
              className={`switch ${markers ? 'on' : ''}`}
              id="sw-mk"
              role="switch"
              aria-checked={markers}
              aria-label="Highest-need markers"
              onClick={() => setMarkers(prev => !prev)}
            />
          </div>
        </div>

        <div className="note mt">
          <span
            className="pill demo"
            title="Synthetic values generated for this demo. Not real surveillance or Census data."
          >
            <span className="dot" />Synthetic demo data
          </span>
        </div>
      </aside>

      {/* Floating Right Inspector Panel matching prototype lines 1961 & 1996-2043 */}
      <aside className={`map-float hm-right ${scope.c || scope.t ? 'has' : ''}`} id="hm-right">
        {scope.t && selectedTractRecord ? (
          <div className="sel-card">
            <div className="row between">
              <span className="pill violet">Census tract</span>
              <button
                className="icon-btn"
                style={{ width: '30px', height: '30px' }}
                id="hm-x"
                aria-label="Clear selection"
                onClick={handleClearTract}
              >
                <Icon name="x" />
              </button>
            </div>
            <h3 className="mt-s">{selectedTractRecord.name}</h3>
            <div className="note">
              {countyLabel(selectedTractRecord.county)}. GEOID {selectedTractRecord.id}
            </div>
            <div className="big-metric">
              <span className="v num">
                {curMetricObj.f(getV(selectedTractRecord, curMetric))}
              </span>
              <span className="muted">{curMetricObj.short}</span>
            </div>
            <div className="note">
              {Math.round(tractPct * 100)}th percentile of {countyTracts.length} tracts in the county
            </div>
            <div className="rank-bar">
              <i style={{ left: `calc(${tractPct * 100}% - 2px)` }} />
            </div>
            <div className="row between note">
              <span>Lowest</span>
              <span>Highest</span>
            </div>
            <div className="mini-metrics">
              {[
                ['svi', 'Vulnerability'],
                ['poverty', 'Poverty'],
                ['uninsured', 'Uninsured'],
                ['diabetes', 'Diabetes'],
                ['access', 'Access score'],
                ['lifeExp', 'Life expectancy']
              ].map(([k, l]) => (
                <div key={k} className="mm">
                  <small>{l}</small>
                  <b className="num">{METRICS[k]?.f(getV(selectedTractRecord, k))}</b>
                </div>
              ))}
            </div>
            <div className="row mt">
              <span className="pill" style={{ color: TIER_COLORS[selectedTractRecord.tier] }}>
                <span className="dot" />{TIER_LABELS[selectedTractRecord.tier]} vulnerability
              </span>
              <span className="pill">{fmt.int(selectedTractRecord.pop)} residents</span>
            </div>
            <div className="stack mt">
              <button
                className="btn primary"
                id="hm-open"
                onClick={() => router.push(`/census-tracts?county=${scope.c}&tract=${selectedTractRecord.id}`)}
              >
                <Icon name="grid" />Review in tract explorer
              </button>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  className="btn sm"
                  id="hm-cmp"
                  onClick={() => handleToggleCompare(selectedTractRecord)}
                >
                  <Icon name="compare" />{inCmp ? 'In comparison' : 'Compare'}
                </button>
                <button
                  className={`btn sm ${flagged ? 'danger' : ''}`}
                  id="hm-flag"
                  onClick={() => handleToggleFlag(selectedTractRecord)}
                >
                  <Icon name="flag" />{flagged ? 'Flagged' : 'Flag underserved'}
                </button>
              </div>
              <button
                className="btn"
                id="hm-find"
                onClick={() => setFindingModalTract(selectedTractRecord)}
              >
                <Icon name="clipboard" />Add finding to assessment
              </button>
            </div>
          </div>
        ) : scope.c && selectedCountyRecord ? (
          <div className="sel-card">
            <div className="row between">
              <span className="pill info">County</span>
              <button
                className="icon-btn"
                style={{ width: '30px', height: '30px' }}
                id="hm-x"
                aria-label="Clear selection"
                onClick={handleClearCounty}
              >
                <Icon name="x" />
              </button>
            </div>
            <h3 className="mt-s">{countyLabel(selectedCountyRecord)}</h3>
            <div className="note">
              FIPS {selectedCountyRecord.id}. {countyTracts.length} census tracts. {fmt.k(selectedCountyRecord.pop)} residents
            </div>
            <div className="big-metric">
              <span className="v num">
                {curMetricObj.f(getV(selectedCountyRecord, curMetric))}
              </span>
              <span className="muted">{curMetricObj.short}</span>
            </div>
            <div className="note">
              {Math.round(countyPct * 100)}th percentile of all US counties
            </div>
            <div className="rank-bar">
              <i style={{ left: `calc(${countyPct * 100}% - 2px)` }} />
            </div>
            <div className="row between note">
              <span>Lowest</span>
              <span>Highest</span>
            </div>
            <div className="mt">
              <SparkSVG vals={countyTrend} w={290} h={46} color="var(--cyan)" />
              <div className="note">Ten-year trend, 2016 to 2025</div>
            </div>
            <h4 className="mt" style={{ fontSize: '13px', marginBottom: '6px' }}>
              Tracts with the highest need
            </h4>
            <div className="list">
              {topCountyTracts.map((t) => (
                <button
                  key={t.id}
                  className="li"
                  style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%', cursor: 'pointer' }}
                  data-t={t.id}
                  onClick={() => handleSelectTract(t)}
                >
                  <span className="tier" style={{ background: TIER_COLORS[t.tier], width: '10px', height: '10px' }} />
                  <span className="b">
                    <b>{t.name}</b>
                    <small>{TIER_LABELS[t.tier]} vulnerability</small>
                  </span>
                  <b className="num">{curMetricObj.f(getV(t, curMetric))}</b>
                </button>
              ))}
            </div>
            <button
              className="btn mt"
              style={{ width: '100%' }}
              id="hm-exp"
              onClick={() => router.push(`/census-tracts?county=${selectedCountyRecord.id}`)}
            >
              <Icon name="grid" />Open all tracts in explorer
            </button>
          </div>
        ) : (
          <>
            <div className="panel-h" style={{ marginBottom: '6px' }}>
              <div>
                <h3>Highest need {scope.st && stateMeta ? 'in ' + stateMeta[1] : 'nationally'}</h3>
                <div className="sub">{curMetricObj.label}. Click a county to drill into its tracts</div>
              </div>
            </div>
            <div className="list">
              {topPoolCounties.map((c, i) => (
                <button
                  key={c.id}
                  className="li"
                  style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%', cursor: 'pointer' }}
                  data-c={c.id}
                  onClick={() => handleSelectCounty(c)}
                >
                  <span className="ic num" style={{ fontSize: '12px', fontWeight: 700 }}>
                    {i + 1}
                  </span>
                  <span className="b">
                    <b>{countyLabel(c)}</b>
                    <small>{fmt.k(c.pop)} residents</small>
                  </span>
                  <b className="num">{curMetricObj.f(getV(c, curMetric))}</b>
                </button>
              ))}
            </div>
            <div className="note mt">
              {scope.st
                ? 'Click any county on the map to load its census tracts.'
                : 'Click a state to zoom in, then click a county to load its census tracts.'}
            </div>
          </>
        )}
      </aside>

      {/* Floating Legend matching prototype lines 1426 & 1962 */}
      <div className="map-float legend hm-legend" id="hm-leg">
        {legend && (
          <>
            <div className="ttl">
              <span>{legend.title}</span>
            </div>
            <div className="ramp">
              {legend.bins.map((color, i) => (
                <i key={i} style={{ background: color }} />
              ))}
            </div>
            <div className="ends">
              <span>{legend.lo}</span>
              <span>{legend.note}</span>
              <span>{legend.hi}</span>
            </div>
          </>
        )}
      </div>

      {/* Floating Performance Readout matching prototype lines 1963 & 1966 */}
      <div className="map-float perf" id="hm-perf">
        <span className="dot" style={{ color: 'var(--teal)' }} />
        {perfInfo ? (
          <span>
            {perfInfo.n.toLocaleString()} counties recolored in <b className="num">{perfInfo.ms} ms</b> in this browser
          </span>
        ) : (
          <span>Ready</span>
        )}
      </div>

      {/* Floating Map Controls matching prototype lines 1964 */}
      <div className="map-float map-ctrls hm-ctrls">
        <button id="z-in" aria-label="Zoom in" onClick={() => handleZoomBy(1.6)}>
          <Icon name="plus" />
        </button>
        <button id="z-out" aria-label="Zoom out" onClick={() => handleZoomBy(1 / 1.6)}>
          <Icon name="minus" />
        </button>
        <button id="z-home" aria-label="Reset view" onClick={handleResetHome}>
          <Icon name="expand" />
        </button>
        <button id="z-jur" aria-label="Go to my jurisdiction" onClick={handleGoJurisdiction}>
          <Icon name="locate" />
        </button>
      </div>

      {/* Finding Modal rendered in #modal-root matching prototype lines 1784-1805 */}
      {findingModalTract && typeof document !== 'undefined' && document.getElementById('modal-root') && (
        createPortal(
          <>
            <div className="modal-scrim" onClick={() => setFindingModalTract(null)} />
            <div className="modal" role="dialog" aria-modal="true">
              <div className="modal-h">
                <div>
                  <h2>Add finding to an assessment</h2>
                  <p>{findingModalTract.name}, {countyLabel(findingModalTract.county)}. GEOID {findingModalTract.id}</p>
                </div>
                <button
                  className="icon-btn"
                  data-close
                  aria-label="Close"
                  onClick={() => setFindingModalTract(null)}
                >
                  <Icon name="x" />
                </button>
              </div>
              <div className="grid g-12">
                <div className="c-6 c-lg-6">
                  <div className="kv">
                    <dt>Vulnerability</dt>
                    <dd>{findingModalTract.svi.toFixed(2)} ({TIER_LABELS[findingModalTract.tier]})</dd>
                    <dt>Poverty</dt>
                    <dd>{getV(findingModalTract, 'poverty').toFixed(1)}%</dd>
                    <dt>Uninsured</dt>
                    <dd>{getV(findingModalTract, 'uninsured').toFixed(1)}%</dd>
                    <dt>Diabetes</dt>
                    <dd>{getV(findingModalTract, 'diabetes').toFixed(1)}%</dd>
                    <dt>Access score</dt>
                    <dd>{getV(findingModalTract, 'access').toFixed(0)}/100</dd>
                  </div>
                </div>
                <div className="c-6 c-lg-6 stack">
                  <label className="field">
                    Assessment
                    <select
                      className="input"
                      id="fa-a"
                      value={selectedAssessmentId}
                      onChange={(e) => setSelectedAssessmentId(e.target.value)}
                    >
                      {assessments.map((a: any) => (
                        <option key={a._id || a.id} value={a._id || a.id}>
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
                      onChange={(e) => setFindingNote(e.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="modal-f">
                <span className="note">Values are synthetic demo data captured at the time of the finding.</span>
                <button className="btn primary" id="fa-go" onClick={handleSubmitFinding}>
                  <Icon name="plus" />Add finding
                </button>
              </div>
            </div>
          </>,
          document.getElementById('modal-root')!
        )
      )}
    </div>
  );
}
