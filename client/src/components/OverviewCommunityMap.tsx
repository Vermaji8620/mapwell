'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { getCountyRepository, CountyRecord } from '@/utils/countyRepository';
import { TIER_LABELS } from '@/config/metrics';

interface OverviewCommunityMapProps {
  countyFips: string;
  activeLayer: 'sdoh' | 'disease' | 'program' | 'access';
  onSelectTract?: (tract: any) => void;
  onSelectCounty?: (county: CountyRecord) => void;
  selectedTractId?: string;
}

let topoCache: any = null;
const TRACT_CACHE: Record<string, any[]> = {};

/* ===== Math helpers from prototype ===== */
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const BLOBS = [
  [610, 390, 85, 0.55],
  [740, 240, 110, 0.45],
  [210, 410, 75, 0.4],
  [180, 520, 90, 0.5],
  [480, 480, 80, 0.45],
  [820, 180, 60, 0.35]
];

function needField(x: number, y: number): number {
  let v = 0.32;
  for (const [bx, by, r, w] of BLOBS) {
    const rr = Math.abs(r);
    v += w * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (rr * rr));
  }
  v += 0.06 * Math.sin(x / 47) * Math.cos(y / 39) + 0.04 * Math.sin((x + y) / 23);
  return v;
}

const LAYER_CONFIG: Record<
  string,
  {
    name: string;
    metricName: string;
    ramp: string[];
    format: (v: number) => string;
  }
> = {
  sdoh: {
    name: 'SDOH composite burden',
    metricName: 'SDOH burden',
    ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'],
    format: (v: number) => Math.round(v).toString()
  },
  disease: {
    name: 'Disease incidence',
    metricName: 'Diabetes rate',
    ramp: ['#BDEFF0', '#37C8CF', '#2A9FD6', '#2565C8', '#173F8A'],
    format: (v: number) => v.toFixed(1) + '%'
  },
  program: {
    name: 'Program utilization',
    metricName: 'Utilization',
    ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'],
    format: (v: number) => Math.round(v).toString() + '%'
  },
  access: {
    name: 'Healthcare access',
    metricName: 'Uninsured rate',
    ramp: ['#C6EAF7', '#7FC6F2', '#3B97E6', '#1F63C6', '#143F86'],
    format: (v: number) => v.toFixed(1) + '%'
  }
};

function getTractLayerVal(t: any, layerKey: string): number {
  switch (layerKey) {
    case 'sdoh':
      return t.sdoh ?? Math.round((t.svi || 0.4) * 45);
    case 'disease':
      return t.incidence ?? t.diabetes ?? 10;
    case 'program':
      return t.utilization ?? 60;
    case 'access':
      return t.uninsured ?? 8;
    default:
      return t.sdoh ?? 20;
  }
}

function makeColorScale(layerKey: string, tractList: any[]) {
  const cfg = LAYER_CONFIG[layerKey] || LAYER_CONFIG.sdoh;
  const ramp = cfg.ramp;
  const vals = tractList.map((t) => getTractLayerVal(t, layerKey));
  const minVal = d3.min(vals) ?? 0;
  const maxVal = d3.max(vals) ?? 100;

  if (minVal === maxVal) {
    return () => ramp[Math.floor(ramp.length / 2)];
  }

  const q = d3.scaleQuantile<string>().domain(vals).range(ramp);
  return (val: number) => q(val);
}

function getCountyLayerVal(c: CountyRecord, layerKey: string): number {
  if (layerKey === 'sdoh') return c.indicators?.poverty ?? (c.svi ? c.svi * 100 : 20);
  if (layerKey === 'disease') return c.indicators?.diabetes ?? 10;
  if (layerKey === 'program') return c.indicators?.uninsured ? 100 - c.indicators.uninsured * 2 : 60;
  return c.indicators?.uninsured ?? 12;
}

function makeCountyColorScale(layerKey: string, countyList: CountyRecord[]) {
  const ramp = LAYER_CONFIG[layerKey]?.ramp || LAYER_CONFIG.sdoh.ramp;
  const low = '#0E2138';
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [d3.interpolateRgb(low, ramp[0])(0.6), ...ramp]);
  const vals = countyList.map((c) => getCountyLayerVal(c, layerKey));
  const q = d3.scaleQuantile().domain(vals).range(d3.range(7));
  return (c: CountyRecord) => {
    const v = getCountyLayerVal(c, layerKey);
    const t = (q(v) + 0.5) / 7;
    return interp(t);
  };
}

// Strict Voronoi tract generator with offscreen canvas isPointInPath boundary checking
function getTracts(c: CountyRecord, pathGen: d3.GeoPath<any, d3.GeoPermissibleObjects>) {
  if (TRACT_CACHE[c.id]) return TRACT_CACHE[c.id];
  const bounds = pathGen.bounds(c.feature);
  const [[x0, y0], [x1, y1]] = bounds;
  const bw = Math.max(x1 - x0, 10);
  const bh = Math.max(y1 - y0, 10);

  const count = clamp(Math.round(Math.sqrt(c.pop) / 11), 12, 120);
  const r = rng(hash('t' + c.id));
  const pts: [number, number][] = [];

  // Offscreen canvas boundary testing strictly against active county polygon
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const p2 = new Path2D(c.d || pathGen(c.feature) || '');

  const core = [x0 + bw * (0.3 + r() * 0.4), y0 + bh * (0.3 + r() * 0.4)];
  let guard = 0;
  while (pts.length < count && guard++ < count * 80) {
    let px = x0 + r() * bw;
    let py = y0 + r() * bh;
    if (r() < (c.urban || 0.6) * 0.7) {
      px = core[0] + gauss(r) * bw * 0.16;
      py = core[1] + gauss(r) * bh * 0.16;
    }
    if (ctx && ctx.isPointInPath(p2, px, py)) {
      pts.push([px, py]);
    }
  }

  // Fallback along centroid if points < 3
  if (pts.length < 3) {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    pts.push([cx, cy], [cx + 0.1, cy], [cx, cy + 0.1]);
  }

  const vor = d3.Delaunay.from(pts).voronoi([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
  const out = pts.map((p, i) => {
    const rr = rng(hash(c.id + ':' + i));
    const ln = () => gauss(rr);
    const cD = c.svi || 0.4;
    const local = clamp(cD + (needField((p[0] * 7) % 975, (p[1] * 7) % 610) - 0.4) * 0.5 + ln() * 0.12, 0.02, 0.99);
    const k = local - cD;
    const tnum = 100 + i * 2 + Math.floor(rr() * 2);
    const suffix = rr() < 0.35 ? '.0' + (1 + Math.floor(rr() * 2)) : '';
    const geoid = c.id + String(tnum).padStart(4, '0') + (suffix ? suffix.slice(1).padStart(2, '0') : '00');

    const cSdoh = (c as any).sdoh ?? c.indicators?.sdoh ?? Math.round(c.svi * 45);
    const cDiabetes = c.indicators?.diabetes ?? 10;
    const cUninsured = c.indicators?.uninsured ?? 8;

    const t: any = {
      id: geoid,
      _id: geoid,
      name: 'Census Tract ' + tnum + suffix,
      county: c,
      cx: p[0],
      cy: p[1],
      d: vor.renderCell(i),
      pop: Math.round(clamp(2400 + rr() * 4800, 1200, 8200)),
      svi: clamp(c.svi + k * 1.1 + ln() * 0.05, 0.01, 0.99),
      sdoh: Math.round(clamp(cSdoh * (1 + k * 1.5) + ln() * 3, 10, 95)),
      incidence: clamp(cDiabetes * (1 + k * 1.2) + ln() * 0.6, 3.5, 24),
      utilization: Math.round(clamp(60 * (1 - k * 0.4), 10, 95)),
      uninsured: clamp(cUninsured * (1 + k * 2) + ln() * 1.5, 1, 40)
    };
    t.tier = Math.min(4, Math.floor(t.svi * 5));
    return t;
  });

  TRACT_CACHE[c.id] = out;
  return out;
}

export function OverviewCommunityMap({
  countyFips = '53033',
  activeLayer = 'sdoh',
  onSelectTract,
  onSelectCounty,
  selectedTractId
}: OverviewCommunityMapProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [clickedTract, setClickedTract] = useState<any>(null);
  const [veryHighCount, setVeryHighCount] = useState<number>(3);
  const [legendInfo, setLegendInfo] = useState<{
    title: string;
    ramp: string[];
    lo: string;
    hi: string;
  }>({
    title: LAYER_CONFIG.sdoh.name,
    ramp: LAYER_CONFIG.sdoh.ramp,
    lo: '10',
    hi: '29'
  });

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    geoid: string;
    metricLabel: string;
    metricVal: string;
    tier: string;
    pop: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    geoid: '',
    metricLabel: '',
    metricVal: '',
    tier: '',
    pop: ''
  });

  // SVG, Zoom & Layer References for direct in-place updates without DOM destruction
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const rootGRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gCountiesRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gTractsRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gSelOutlineRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gMarkersRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const countyClipRef = useRef<d3.Selection<SVGClipPathElement, unknown, null, undefined> | null>(null);
  const pathGenRef = useRef<d3.GeoPath<any, d3.GeoPermissibleObjects> | null>(null);
  const currentCountyRef = useRef<CountyRecord | null>(null);

  const stateCountiesRef = useRef<CountyRecord[]>([]);
  const tractsRef = useRef<any[]>([]);
  const cfgRef = useRef(LAYER_CONFIG[activeLayer]);
  const activeLayerRef = useRef(activeLayer);
  const selectedTractIdRef = useRef(selectedTractId);
  selectedTractIdRef.current = selectedTractId;

  // Tract tooltip & interaction handlers
  const handleTractHover = (e: any, t: any) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const activeCfg = cfgRef.current;
    const val = activeCfg.format(getTractLayerVal(t, activeLayerRef.current));

    setTooltip({
      visible: true,
      x: e.clientX - rect.left + 14,
      y: e.clientY - rect.top - 20,
      title: t.name,
      geoid: t.id,
      metricLabel: activeCfg.metricName,
      metricVal: val,
      tier: TIER_LABELS[t.tier] || 'Moderate',
      pop: (t.pop || 0).toLocaleString('en-US')
    });
  };

  const handleTractMove = (e: any) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTooltip((prev) => ({
      ...prev,
      x: e.clientX - rect.left + 14,
      y: e.clientY - rect.top - 20
    }));
  };

  const handleTractLeave = () => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  const handleTractClick = (e: any, t: any) => {
    e.stopPropagation();
    setClickedTract(t);
    if (gTractsRef.current) {
      gTractsRef.current.selectAll('path.tract').classed('sel', (d: any) => d.id === t.id);
    }
    if (onSelectTract) onSelectTract(t);
  };

  // Direct In-Place County Selection (Fluid Glide, No State Zoom-Out, In-Place Tract Updating)
  const selectCounty = (targetCounty: CountyRecord, animate = true) => {
    if (!targetCounty || currentCountyRef.current?.id === targetCounty.id) return;
    currentCountyRef.current = targetCounty;
    setClickedTract(null);
    const pathGen = pathGenRef.current || d3.geoPath();
    const targetPathD = targetCounty.d || (targetCounty.feature ? pathGen(targetCounty.feature) : '') || '';

    // 1. Update selection classes on neighboring counties
    if (gCountiesRef.current) {
      gCountiesRef.current
        .selectAll<SVGPathElement, CountyRecord>('path.county')
        .classed('sel', (c) => c.id === targetCounty.id);
    }

    // 2. Update active county outline in-place
    if (gSelOutlineRef.current) {
      gSelOutlineRef.current.select('path.sel-outline').attr('d', targetPathD);
    }

    // 3. Update clipPath to new county boundary
    if (countyClipRef.current) {
      countyClipRef.current.select('path').attr('d', targetPathD);
    }

    // 4. Generate new tracts & render inside clipPath
    const newTracts = getTracts(targetCounty, pathGen);
    tractsRef.current = newTracts;
    const currentLayer = activeLayerRef.current;
    const tractScale = makeColorScale(currentLayer, newTracts);
    if (gTractsRef.current) {
      const tractPaths = gTractsRef.current
        .selectAll<SVGPathElement, any>('path.tract')
        .data(newTracts, (t) => t.id)
        .join('path')
        .attr('class', 'tract')
        .attr('d', (t) => t.d)
        .attr('fill', (t) => tractScale(getTractLayerVal(t, currentLayer)));

      if (animate) {
        tractPaths
          .attr('opacity', 0)
          .transition('tract-fade')
          .delay((_, i) => 200 + i * 10)
          .duration(400)
          .attr('opacity', 1);
      } else {
        tractPaths.attr('opacity', 1);
      }

      tractPaths
        .on('pointerenter', handleTractHover)
        .on('pointermove', handleTractMove)
        .on('pointerleave', handleTractLeave)
        .on('click', handleTractClick);
    }

    // 5. Calculate target county transform
    const [[x0, y0], [x1, y1]] = pathGen.bounds(targetCounty.feature);
    const pad = 0.65;
    const sTarget = Math.min(90, pad / Math.max((x1 - x0) / 975, (y1 - y0) / 610));
    const targetTransform = d3.zoomIdentity
      .translate(975 / 2, 610 / 2)
      .scale(sTarget)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

    // 6. DIRECT GLIDE: Smoothly interpolate directly from current zoom to target county
    if (svgRef.current && zoomRef.current) {
      svgRef.current
        .transition('camera-glide')
        .duration(850)
        .ease(d3.easeCubicInOut)
        .call(zoomRef.current.transform, targetTransform);
    }

    // 7. Update pulse markers for top 3 tracts of the new county
    const topTracts = newTracts
      .slice()
      .sort((a, b) => (b.sdoh ?? b.svi) - (a.sdoh ?? a.svi))
      .slice(0, 3);

    if (gMarkersRef.current) {
      gMarkersRef.current.selectAll('*').remove();
      const mGroups = gMarkersRef.current
        .selectAll('g.pulse-m')
        .data(topTracts, (d: any) => d.id)
        .join('g')
        .attr('class', 'pulse-m')
        .attr('transform', (d: any) => `translate(${d.cx},${d.cy}) scale(${1 / sTarget})`)
        .attr('opacity', 0);

      mGroups.append('circle').attr('class', 'ring').attr('r', 7);
      mGroups.append('circle').attr('class', 'ring r2').attr('r', 7);
      mGroups.append('circle').attr('core', '').attr('class', 'core').attr('r', 3.5);

      mGroups
        .transition('markers-in')
        .delay(450)
        .duration(400)
        .attr('opacity', 1);
    }

    // 8. Update floating cards
    const veryHigh = newTracts.filter((t) => t.tier === 4);
    setVeryHighCount(Math.max(1, veryHigh.length));
    const vals = newTracts.map((t) => getTractLayerVal(t, currentLayer));
    const cfg = cfgRef.current;
    setLegendInfo({
      title: cfg.name,
      ramp: cfg.ramp,
      lo: cfg.format(d3.min(vals) ?? 10),
      hi: cfg.format(d3.max(vals) ?? 29)
    });
  };

  // 1. Initial Map Creation or Jurisdiction Change
  useEffect(() => {
    let isMounted = true;
    setClickedTract(null);

    async function init() {
      const el = containerRef.current;
      if (!el) return;
      el.innerHTML = '';

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

      const repo = await getCountyRepository();
      if (!isMounted || !topoCache || !containerRef.current) return;

      const currentCounty = repo.countyById.get(countyFips) || repo.counties[0];
      if (!currentCounty) return;
      currentCountyRef.current = currentCounty;

      const pathGen = d3.geoPath();
      pathGenRef.current = pathGen;

      if (!currentCounty.d && currentCounty.feature) {
        currentCounty.d = pathGen(currentCounty.feature) || '';
      }
      const countyPathD = currentCounty.d || (currentCounty.feature ? pathGen(currentCounty.feature) : '') || '';

      const stateCounties = repo.countiesByState.get(currentCounty.st) || [currentCounty];
      stateCounties.forEach((c) => {
        if (!c.d && c.feature) {
          c.d = pathGen(c.feature) || '';
        }
      });
      stateCountiesRef.current = stateCounties;

      const tracts = getTracts(currentCounty, pathGen);
      tractsRef.current = tracts;
      const veryHighTracts = tracts.filter((t) => t.tier === 4);
      setVeryHighCount(Math.max(1, veryHighTracts.length));

      // Config and dynamic legend data
      const currentLayer = activeLayerRef.current;
      const cfg = LAYER_CONFIG[currentLayer] || LAYER_CONFIG.sdoh;
      cfgRef.current = cfg;

      const layerVals = tracts.map((t) => getTractLayerVal(t, currentLayer));
      const loStr = cfg.format(d3.min(layerVals) ?? 10);
      const hiStr = cfg.format(d3.max(layerVals) ?? 29);

      setLegendInfo({
        title: cfg.name,
        ramp: cfg.ramp,
        lo: loStr,
        hi: hiStr
      });

      const tractScale = makeColorScale(currentLayer, tracts);

      // SVG root creation
      const svg = d3
        .select(el)
        .append('svg')
        .attr('class', 'map-svg dim-others')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('role', 'img')
        .attr('aria-label', 'Interactive county map of the United States')
        .style('display', 'block')
        .style('width', '100%')
        .style('height', '100%')
        .style('touch-action', 'none');

      svgRef.current = svg;

      const defs = svg.append('defs');

      // Keyframes & cyan sonar styling
      defs.append('style').text(`
        @keyframes pulseRing {
          0% { transform: scale(0.6); opacity: 0.95; }
          100% { transform: scale(3.2); opacity: 0; }
        }
        .pulse-m {
          filter: drop-shadow(0 0 6px var(--cyan)) drop-shadow(0 0 10px rgba(56, 225, 255, 0.45));
        }
        .pulse-m .ring {
          fill: none;
          stroke: var(--cyan);
          stroke-width: 1.5;
          vector-effect: non-scaling-stroke;
          transform-box: fill-box;
          transform-origin: center;
          animation: pulseRing 2.4s ease-out infinite;
        }
        .pulse-m .ring.r2 {
          animation-delay: 1.2s;
        }
        .pulse-m .core {
          fill: #FFFFFF;
          stroke: var(--cyan);
          stroke-width: 2;
          vector-effect: non-scaling-stroke;
        }
        /* Neighboring counties: dim the fill while keeping borders prominent & visible */
        .dim-others .county:not(.sel) {
          opacity: 1 !important;
          fill-opacity: 0.28 !important;
          stroke: rgba(141, 170, 200, 0.45) !important;
          stroke-width: 0.75px !important;
          vector-effect: non-scaling-stroke;
          transition: fill-opacity 0.4s ease, stroke 0.4s ease;
        }
        .county:not(.sel) {
          stroke: rgba(141, 170, 200, 0.45);
          stroke-width: 0.75px;
          vector-effect: non-scaling-stroke;
          transition: fill-opacity 0.4s ease;
        }
        /* Marion County (hotspot county) remains untouched with its prominent dark navy outline */
        .county.sel {
          stroke: #102A4C !important;
          stroke-width: 1.8px !important;
          opacity: 1 !important;
          fill-opacity: 1 !important;
        }
        .sel-outline {
          fill: none;
          stroke: #102A4C !important;
          stroke-width: 1.8px !important;
          vector-effect: non-scaling-stroke;
          filter: none !important;
          pointer-events: none;
        }
        /* State & coastal boundary line matching prototype line 804 */
        .nation-b {
          fill: none;
          stroke: #9CC9EE !important;
          stroke-opacity: 0.95 !important;
          stroke-width: 1.2px !important;
          vector-effect: non-scaling-stroke;
          filter: drop-shadow(0 0 3px rgba(156, 201, 238, 0.45));
          pointer-events: none;
        }
        /* Internal census tracts borders */
        .tract {
          stroke: rgba(255, 255, 255, 0.55);
          stroke-width: 0.7px;
          vector-effect: non-scaling-stroke;
          cursor: pointer;
          transition: stroke 0.2s ease, stroke-width 0.2s ease;
        }
        .tract:hover {
          stroke: #FFFFFF;
          stroke-width: 1.8px;
        }
        .tract.sel {
          stroke: #102A4C;
          stroke-width: 2.2px;
        }
      `);

      // Unique instance clipPath ID per render
      const clipId = `ov-map-clip-${currentCounty.id}`;
      const countyClip = defs.append('clipPath').attr('id', clipId);
      countyClip.append('path').attr('d', countyPathD);
      countyClipRef.current = countyClip;

      /*
        SVG Layer Hierarchy:
        svg.map-svg.dim-others
          ├── defs
          └── g.map-root-g
                ├── g.state-counties (neighboring counties colorized with active metric, stroke var(--map-line))
                ├── g.state-boundary-layer (path.nation-b with delicate state border)
                ├── g.tracts-layer (clipped to active county clipPath; tract paths with stroke rgba(255,255,255,0.55))
                ├── g.sel-outline-group (path.sel-outline with dark navy border)
                └── g.markers-layer (pulse-m markers on top 3 highest SDOH/vulnerability tracts)
      */
      const rootG = svg.append('g').attr('class', 'map-root-g');
      rootGRef.current = rootG;

      const gCounties = rootG.append('g').attr('class', 'state-counties');
      gCountiesRef.current = gCounties;

      const gBoundary = rootG.append('g').attr('class', 'state-boundary-layer');

      const gTracts = rootG.append('g').attr('class', 'tracts-layer').attr('clip-path', `url(#${clipId})`);
      gTractsRef.current = gTracts;

      const gSelOutline = rootG.append('g').attr('class', 'sel-outline-group');
      gSelOutlineRef.current = gSelOutline;

      const gMarkers = rootG.append('g').attr('class', 'markers-layer').style('pointer-events', 'none');
      gMarkersRef.current = gMarkers;

      // Draw state boundary path (matching prototype line 1281)
      try {
        const stateFeatures = (topojson.feature(topoCache, topoCache.objects.states) as any).features;
        const stFeature = stateFeatures?.find(
          (f: any) => String(f.id).padStart(2, '0') === currentCounty.st
        );
        if (stFeature) {
          const stD = pathGen(stFeature);
          if (stD) {
            gBoundary
              .append('path')
              .attr('class', 'nation-b')
              .attr('d', stD)
              .attr('fill', 'none')
              .attr('stroke', '#9CC9EE')
              .attr('stroke-opacity', 0.95)
              .attr('stroke-width', 1.2)
              .attr('vector-effect', 'non-scaling-stroke')
              .style('pointer-events', 'none');
          }
        }
      } catch (err) {
        console.warn('Could not extract state boundary:', err);
      }

      // 1. Draw state counties (colorized by active metric, dimmed outside target county via .dim-others)
      const countyScale = makeCountyColorScale(currentLayer, stateCounties);
      gCounties
        .selectAll<SVGPathElement, CountyRecord>('path.county')
        .data(stateCounties, (c) => c.id)
        .join('path')
        .attr('class', (c) => `county ${c.id === currentCounty.id ? 'sel' : ''}`)
        .attr('d', (c) => c.d || (c.feature ? pathGen(c.feature) : '') || '')
        .attr('fill', (c) => countyScale(c))
        .style('cursor', 'pointer')
        .on('click', (e, c) => {
          e.stopPropagation();
          if (c.id !== currentCountyRef.current?.id) {
            selectCounty(c, true);
          }
        });

      // 2. Draw tracts clipped to county boundary
      const tractPaths = gTracts
        .selectAll<SVGPathElement, any>('path.tract')
        .data(tracts, (t) => t.id)
        .join('path')
        .attr('class', (t) => `tract ${t.id === selectedTractIdRef.current ? 'sel' : ''}`)
        .attr('d', (t) => t.d)
        .attr('fill', (t) => tractScale(getTractLayerVal(t, currentLayer)));

      // Staggered boundary sweep & fade-in matching prototype MapView lines 1357-1362
      tractPaths
        .attr('opacity', 0)
        .transition('tin')
        .delay((_, i) => 350 + i * 10)
        .duration(450)
        .attr('opacity', 1);

      tractPaths
        .each(function () {
          const totalLen = (this as SVGPathElement).getTotalLength ? (this as SVGPathElement).getTotalLength() : 0;
          d3.select(this).attr('stroke-dasharray', `${totalLen} ${totalLen}`).attr('stroke-dashoffset', totalLen);
        })
        .transition('tdraw')
        .delay((_, i) => 300 + i * 10)
        .duration(900)
        .ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0)
        .on('end', function () {
          d3.select(this).attr('stroke-dasharray', null);
        });

      // Tract hover & click interactions
      tractPaths
        .on('pointerenter', handleTractHover)
        .on('pointermove', handleTractMove)
        .on('pointerleave', handleTractLeave)
        .on('click', handleTractClick);

      // Background click clears selection
      svg.on('click', () => {
        setClickedTract(null);
        if (gTractsRef.current) {
          gTractsRef.current.selectAll('path.tract').classed('sel', false);
        }
      });

      // 3. Draw county selection outline with smooth fade-in
      gSelOutline
        .append('path')
        .attr('class', 'sel-outline')
        .attr('d', countyPathD)
        .attr('opacity', 0)
        .transition('outline-in')
        .delay(350)
        .duration(500)
        .attr('opacity', 1);

      // 4. Smooth Camera Glide: State bounding box to County bounding box over 950ms
      let currentK = 1;
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 90])
        .translateExtent([
          [-200, -200],
          [1175, 810]
        ])
        .on('zoom', (e) => {
          rootG.attr('transform', e.transform);
          currentK = e.transform.k;
          if (gMarkersRef.current) {
            gMarkersRef.current
              .selectAll('g.pulse-m')
              .attr('transform', (d: any) => `translate(${d.cx},${d.cy}) scale(${1 / currentK})`);
          }
        });

      zoomRef.current = zoom;
      svg.call(zoom).on('dblclick.zoom', null);

      // State bounding box
      let sx0 = Infinity,
        sy0 = Infinity,
        sx1 = -Infinity,
        sy1 = -Infinity;
      stateCounties.forEach((c) => {
        if (c.feature) {
          const [[bx0, by0], [bx1, by1]] = pathGen.bounds(c.feature);
          if (bx0 < sx0) sx0 = bx0;
          if (by0 < sy0) sy0 = by0;
          if (bx1 > sx1) sx1 = bx1;
          if (by1 > sy1) sy1 = by1;
        }
      });
      if (sx0 === Infinity || isNaN(sx0)) {
        sx0 = 0;
        sy0 = 0;
        sx1 = 975;
        sy1 = 610;
      }
      const sState = Math.min(90, 0.88 / Math.max((sx1 - sx0) / 975, (sy1 - sy0) / 610));
      const stateTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(sState)
        .translate(-(sx0 + sx1) / 2, -(sy0 + sy1) / 2);

      // Target County bounding box with padding 0.65 (giving breathing room for county tail)
      const [[x0, y0], [x1, y1]] = pathGen.bounds(currentCounty.feature);
      const pad = 0.65;
      const sCounty = Math.min(90, pad / Math.max((x1 - x0) / 975, (y1 - y0) / 610));
      const countyTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(sCounty)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

      // Center state immediately, glide to county over 950ms using d3.easeCubicInOut
      svg.call(zoom.transform, stateTransform);
      svg
        .transition('camera-zoom')
        .duration(950)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, countyTransform);

      // 5. Pulsating radar markers on the top 3 highest SDOH / vulnerability tracts
      const topTracts = tracts
        .slice()
        .sort((a, b) => (b.sdoh ?? b.svi) - (a.sdoh ?? a.svi))
        .slice(0, 3);

      const mGroups = gMarkers
        .selectAll('g.pulse-m')
        .data(topTracts, (d: any) => d.id)
        .join('g')
        .attr('class', 'pulse-m')
        .attr('transform', (d: any) => `translate(${d.cx},${d.cy}) scale(${1 / sCounty})`)
        .attr('opacity', 0);

      mGroups.append('circle').attr('class', 'ring').attr('r', 7);
      mGroups.append('circle').attr('class', 'ring r2').attr('r', 7);
      mGroups.append('circle').attr('class', 'core').attr('r', 3.5);

      mGroups
        .transition('markers-in')
        .delay(700)
        .duration(450)
        .attr('opacity', 1);
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [countyFips]);

  // 2. Reactive Smooth Layer Toggling (Zero Flicker, Zero Jump)
  useEffect(() => {
    activeLayerRef.current = activeLayer;
    const cfg = LAYER_CONFIG[activeLayer] || LAYER_CONFIG.sdoh;
    cfgRef.current = cfg;

    if (tractsRef.current && tractsRef.current.length > 0) {
      const vals = tractsRef.current.map((t) => getTractLayerVal(t, activeLayer));
      const lo = cfg.format(d3.min(vals) ?? 10);
      const hi = cfg.format(d3.max(vals) ?? 29);

      setLegendInfo({
        title: cfg.name,
        ramp: cfg.ramp,
        lo,
        hi
      });

      if (gTractsRef.current) {
        const tractScale = makeColorScale(activeLayer, tractsRef.current);
        gTractsRef.current
          .selectAll<SVGPathElement, any>('path.tract')
          .transition('fill')
          .duration(500)
          .delay((_, i) => i * 6)
          .attr('fill', (t) => tractScale(getTractLayerVal(t, activeLayer)));
      }
    }

    // Update neighboring counties fill according to the active layer
    if (gCountiesRef.current && stateCountiesRef.current.length > 0) {
      const newCountyScale = makeCountyColorScale(activeLayer, stateCountiesRef.current);
      gCountiesRef.current
        .selectAll<SVGPathElement, CountyRecord>('path.county')
        .transition('county-fill')
        .duration(500)
        .attr('fill', (c) => newCountyScale(c));
    }
  }, [activeLayer]);

  // Sync selected tract outline
  useEffect(() => {
    if (gTractsRef.current) {
      gTractsRef.current
        .selectAll('path.tract')
        .classed('sel', (d: any) => d.id === selectedTractId || d.id === clickedTract?.id);
    }
  }, [selectedTractId, clickedTract]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        borderRadius: '14px',
        background: 'transparent'
      }}
    >
      <div ref={containerRef} className="map-shell" style={{ position: 'absolute', inset: 0 }} />

      {/* Floating Legend Card (Bottom-Left) matching prototype #d-leg */}
      <div
        className="map-float legend"
        id="d-leg"
        style={{
          position: 'absolute',
          left: '12px',
          bottom: '12px',
          minWidth: '200px',
          zIndex: 5
        }}
      >
        <div className="ttl">
          <span>{legendInfo.title}</span>
        </div>
        <div className="ramp">
          {legendInfo.ramp.map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </div>
        <div className="ends">
          <span>{legendInfo.lo}</span>
          <span>Tracts</span>
          <span>{legendInfo.hi}</span>
        </div>
      </div>

      {/* Floating Selection Card (Top-Right) matching prototype #d-sel */}
      <div
        className="map-float"
        id="d-sel"
        style={{
          position: 'absolute',
          right: '12px',
          top: '12px',
          padding: '10px 12px',
          fontSize: '12px',
          maxWidth: '220px',
          zIndex: 5
        }}
      >
        {clickedTract ? (
          <div>
            <b>{clickedTract.name}</b>
            <div className="note" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
              {TIER_LABELS[clickedTract.tier] || 'Moderate'} vulnerability. {(clickedTract.pop || 3200).toLocaleString()} residents
            </div>
            <button
              className="btn sm primary mt-s"
              id="d-open"
              style={{ width: '100%' }}
              onClick={() => router.push(`/census-tracts?county=${currentCountyRef.current?.id || countyFips}&tract=${clickedTract.id}`)}
            >
              Open in tract explorer
            </button>
          </div>
        ) : (
          <div>
            <b>{veryHighCount} very high vulnerability tracts</b>
            <div className="note" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
              Highlighted with markers
            </div>
          </div>
        )}
      </div>

      {/* Tract Hover Tooltip */}
      {tooltip.visible && (
        <div
          id="tooltip"
          className="on"
          style={{
            position: 'absolute',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            display: 'block',
            zIndex: 100,
            pointerEvents: 'none'
          }}
        >
          <b>{tooltip.title}</b>
          <div className="tv">
            <span>GEOID</span>
            <span>{tooltip.geoid}</span>
          </div>
          <div className="tv">
            <span>{tooltip.metricLabel}</span>
            <span>{tooltip.metricVal}</span>
          </div>
          <div className="tv">
            <span>Vulnerability tier</span>
            <span>{tooltip.tier}</span>
          </div>
          <div className="tv">
            <span>Population</span>
            <span>{tooltip.pop}</span>
          </div>
        </div>
      )}
    </div>
  );
}
