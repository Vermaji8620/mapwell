'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as d3 from 'd3';
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
  { name: string; metricName: string; ramp: string[]; ext: [string, string]; format: (v: number) => string }
> = {
  sdoh: {
    name: 'Social determinants of health',
    metricName: 'SDOH Need',
    ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'],
    ext: ['0.05', '0.96'],
    format: (v: number) => (v * 100).toFixed(0) + '%'
  },
  disease: {
    name: 'Disease incidence',
    metricName: 'Diabetes rate',
    ramp: ['#BDEFF0', '#37C8CF', '#2A9FD6', '#2565C8', '#173F8A'],
    ext: ['5.2%', '18.4%'],
    format: (v: number) => v.toFixed(1) + '%'
  },
  program: {
    name: 'Program utilization',
    metricName: 'Program utilization',
    ramp: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'],
    ext: ['24%', '88%'],
    format: (v: number) => v.toFixed(0) + '%'
  },
  access: {
    name: 'Healthcare access',
    metricName: 'Uninsured rate',
    ramp: ['#C6EAF7', '#7FC6F2', '#3B97E6', '#1F63C6', '#143F86'],
    ext: ['3.4%', '24.1%'],
    format: (v: number) => v.toFixed(1) + '%'
  }
};

function getTractLayerVal(t: any, layerKey: string): number {
  return layerKey === 'sdoh'
    ? t.svi
    : layerKey === 'disease'
    ? t.diabetes
    : layerKey === 'program'
    ? t.utilization
    : t.uninsured;
}

function makeColorScale(layerKey: string, tractList: any[]) {
  const ramp = LAYER_CONFIG[layerKey]?.ramp || LAYER_CONFIG.sdoh.ramp;
  const low = '#E4ECFA';
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [d3.interpolateRgb(low, ramp[0])(0.6), ...ramp]);

  const vals = tractList.map((t) => getTractLayerVal(t, layerKey));
  const q = d3.scaleQuantile().domain(vals).range(d3.range(7));
  return (val: number) => {
    const t = (q(val) + 0.5) / 7;
    return interp(t);
  };
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
    lo: LAYER_CONFIG.sdoh.ext[0],
    hi: LAYER_CONFIG.sdoh.ext[1]
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

  // Track map DOM elements for smooth layer changes without rebuild
  const gTractsRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const tractsRef = useRef<any[]>([]);
  const cfgRef = useRef(LAYER_CONFIG[activeLayer]);
  const activeLayerRef = useRef(activeLayer);
  const selectedTractIdRef = useRef(selectedTractId);
  selectedTractIdRef.current = selectedTractId;

  // 1. Initial Map Creation or County Change
  useEffect(() => {
    let isMounted = true;

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

      const pathGen = d3.geoPath();
      const stateCounties = repo.countiesByState.get(currentCounty.st) || [currentCounty];

      // Voronoi tract generator matching prototype tractsFor(cid)
      function getTracts(c: CountyRecord) {
        if (TRACT_CACHE[c.id]) return TRACT_CACHE[c.id];
        const bounds = pathGen.bounds(c.feature);
        const [[x0, y0], [x1, y1]] = bounds;
        const bw = Math.max(x1 - x0, 10);
        const bh = Math.max(y1 - y0, 10);

        const count = clamp(Math.round(Math.sqrt(c.pop) / 11), 12, 120);
        const r = rng(hash('t' + c.id));
        const pts: [number, number][] = [];

        const core = [x0 + bw * (0.3 + r() * 0.4), y0 + bh * (0.3 + r() * 0.4)];
        let guard = 0;
        while (pts.length < count && guard++ < count * 40) {
          let px = x0 + r() * bw;
          let py = y0 + r() * bh;
          if (r() < (c.urban || 0.6) * 0.7) {
            px = core[0] + gauss(r) * bw * 0.16;
            py = core[1] + gauss(r) * bh * 0.16;
          }
          pts.push([px, py]);
        }

        if (pts.length < 3) {
          pts.push([x0 + bw * 0.5, y0 + bh * 0.5], [x0 + 1, y0 + 1], [x1 - 1, y1 - 1]);
        }

        const vor = d3.Delaunay.from(pts).voronoi([x0 - 2, y0 - 2, x1 + 2, y1 + 2]);
        const out = pts.map((p, i) => {
          const rr = rng(hash(c.id + ':' + i));
          const ln = () => gauss(rr);
          const cD = c.svi || 0.4;
          const local = clamp(cD + (needField((p[0] * 7) % 975, (p[1] * 7) % 610) - 0.4) * 0.5 + ln() * 0.12, 0.02, 0.99);
          const k = local - cD;
          const tnum = 100 + i * 2 + Math.floor(rr() * 2);
          const suffix = rr() < 0.35 ? '.0' + (1 + Math.floor(rr() * 2)) : '';
          const geoid = c.id + String(tnum).padStart(4, '0') + (suffix ? suffix.slice(1).padStart(2, '0') : '00');

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
            poverty: clamp((c.indicators?.poverty || 14) * (1 + k * 2.2) + ln() * 2, 1.5, 58),
            uninsured: clamp((c.indicators?.uninsured || 8) * (1 + k * 2) + ln() * 1.5, 1, 40),
            diabetes: clamp((c.indicators?.diabetes || 10) * (1 + k * 1.2) + ln() * 0.6, 3.5, 24),
            asthma: clamp((c.indicators?.asthma || 9) * (1 + k * 0.7) + ln() * 0.4, 5.5, 17),
            hypertension: clamp((c.indicators?.hypertension || 28) * (1 + k * 0.8) + ln() * 1.4, 18, 52),
            lifeExp: clamp((c.indicators?.lifeExp || 78) - k * 3.8 + ln() * 0.8, 68, 86)
          };
          t.tier = Math.min(4, Math.floor(t.svi * 5));
          t.sdoh = t.svi;
          t.incidence = t.diabetes;
          t.utilization = clamp(60 * (1 - k * 0.4), 10, 95);
          t.access = clamp(100 - t.uninsured * 2.2, 10, 95);
          return t;
        });

        TRACT_CACHE[c.id] = out;
        return out;
      }

      const tracts = getTracts(currentCounty);
      tractsRef.current = tracts;
      const veryHighTracts = tracts.filter((t) => t.tier === 4);
      setVeryHighCount(Math.max(1, veryHighTracts.length));

      // Config and legend data
      const currentLayer = activeLayerRef.current;
      const cfg = LAYER_CONFIG[currentLayer] || LAYER_CONFIG.sdoh;
      cfgRef.current = cfg;
      setLegendInfo({
        title: cfg.name,
        ramp: cfg.ramp,
        lo: cfg.ext[0],
        hi: cfg.ext[1]
      });

      const tractScale = makeColorScale(currentLayer, tracts);

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
        .style('border-radius', '14px');

      const defs = svg.append('defs');

      // Keyframes for rose pulsating radar hotspot markers & styling
      defs.append('style').text(`
        @keyframes pulseRing {
          0% { transform: scale(0.6); opacity: 0.95; }
          100% { transform: scale(3.2); opacity: 0; }
        }
        .pulse-m {
          filter: drop-shadow(0 0 6px var(--rose)) drop-shadow(0 0 10px rgba(224, 51, 106, 0.55));
        }
        .pulse-m .ring {
          fill: none;
          stroke: var(--rose);
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
          fill: var(--rose);
          stroke: #FFFFFF;
          stroke-width: 2;
          vector-effect: non-scaling-stroke;
        }
        .dim-others .county:not(.sel) {
          opacity: 0.28;
          transition: opacity 0.4s ease;
        }
        .county {
          stroke: var(--map-line);
          stroke-width: 0.5px;
          vector-effect: non-scaling-stroke;
        }
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
          stroke: var(--cyan);
          stroke-width: 2.2px;
        }
        .sel-outline {
          fill: none;
          stroke: var(--cyan);
          stroke-width: 2px;
          vector-effect: non-scaling-stroke;
          filter: drop-shadow(0 0 6px var(--cyan));
          pointer-events: none;
        }
      `);

      const countyClip = defs.append('clipPath').attr('id', 'ov-map-clip');
      countyClip.append('path').attr('d', currentCounty.d || pathGen(currentCounty.feature) || '');

      const rootG = svg.append('g').attr('class', 'map-root-g');
      const gCounties = rootG.append('g').attr('class', 'state-counties');
      const gTracts = rootG.append('g').attr('class', 'tracts-layer').attr('clip-path', 'url(#ov-map-clip)');
      gTractsRef.current = gTracts;
      const gSelOutline = rootG.append('g').attr('class', 'sel-outline-group');
      const gMarkers = rootG.append('g').attr('class', 'markers-layer').style('pointer-events', 'none');

      // 1. Draw state counties (dimmed outside target county)
      gCounties
        .selectAll<SVGPathElement, CountyRecord>('path.county')
        .data(stateCounties, (c) => c.id)
        .join('path')
        .attr('class', (c) => `county ${c.id === currentCounty.id ? 'sel' : ''}`)
        .attr('d', (c) => c.d || pathGen(c.feature) || '')
        .attr('fill', 'var(--map-low)')
        .style('cursor', 'pointer')
        .on('click', (_, c) => {
          if (c.id !== currentCounty.id && onSelectCounty) {
            onSelectCounty(c);
          }
        });

      // 2. Draw tracts clipped to county boundary
      const tractPaths = gTracts
        .selectAll<SVGPathElement, any>('path.tract')
        .data(tracts, (t) => t.id)
        .join('path')
        .attr('class', (t) => `tract ${t.id === selectedTractIdRef.current || t.id === clickedTract?.id ? 'sel' : ''}`)
        .attr('d', (t) => t.d)
        .attr('fill', (t) => tractScale(getTractLayerVal(t, currentLayer)));

      // Staggered boundary sweep & fade-in matching prototype
      tractPaths
        .attr('opacity', 0)
        .transition('tin')
        .delay((_, i) => 350 + i * 10)
        .duration(450)
        .attr('opacity', 1);

      tractPaths.each(function () {
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
        .on('pointerenter', function (e, t) {
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
            tier: TIER_LABELS[t.tier],
            pop: (t.pop || 0).toLocaleString('en-US')
          });
        })
        .on('pointermove', function (e) {
          const rect = el.getBoundingClientRect();
          setTooltip((prev) => ({
            ...prev,
            x: e.clientX - rect.left + 14,
            y: e.clientY - rect.top - 20
          }));
        })
        .on('pointerleave', function () {
          setTooltip((prev) => ({ ...prev, visible: false }));
        })
        .on('click', function (e, t) {
          e.stopPropagation();
          setClickedTract(t);
          gTracts.selectAll('path.tract').classed('sel', (d: any) => d.id === t.id);
          if (onSelectTract) onSelectTract(t);
        });

      // 3. Draw cyan glowing county selection outline with smooth fade-in
      gSelOutline
        .append('path')
        .attr('class', 'sel-outline')
        .attr('d', currentCounty.d || pathGen(currentCounty.feature) || '')
        .attr('opacity', 0)
        .transition('outline-in')
        .delay(350)
        .duration(500)
        .attr('opacity', 1);

      // 4. Smooth State-to-County Camera Glide matching prototype MapView lines 1311 & 1424
      // D3 Zoom & Pan behavior
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
          gMarkers
            .selectAll('g.pulse-m')
            .attr('transform', (d: any) => `translate(${d.cx},${d.cy}) scale(${1 / currentK})`);
        });

      svg.call(zoom).on('dblclick.zoom', null);

      // Calculate initial State bounding box
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
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
        sx0 = 0; sy0 = 0; sx1 = 975; sy1 = 610;
      }
      const sState = Math.min(90, 0.88 / Math.max((sx1 - sx0) / 975, (sy1 - sy0) / 610));
      const stateTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(sState)
        .translate(-(sx0 + sx1) / 2, -(sy0 + sy1) / 2);

      // Calculate target County bounding box
      const [[x0, y0], [x1, y1]] = pathGen.bounds(currentCounty.feature);
      const pad = 0.72;
      const sCounty = Math.min(90, pad / Math.max((x1 - x0) / 975, (y1 - y0) / 610));
      const countyTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(sCounty)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

      // Frame state immediately, then glide into county over 950ms with easeCubicInOut
      svg.call(zoom.transform, stateTransform);
      svg
        .transition('camera-zoom')
        .duration(950)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, countyTransform);

      // 5. Draw pulsating radar markers on the top 3 highest vulnerability tracts
      const topTracts = tracts
        .slice()
        .sort((a, b) => b.svi - a.svi)
        .slice(0, 3);

      const mGroups = gMarkers
        .selectAll('g.pulse-m')
        .data(topTracts)
        .join('g')
        .attr('class', 'pulse-m')
        .attr('transform', (d) => `translate(${d.cx},${d.cy}) scale(${1 / sCounty})`)
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
    setLegendInfo({
      title: cfg.name,
      ramp: cfg.ramp,
      lo: cfg.ext[0],
      hi: cfg.ext[1]
    });

    if (gTractsRef.current && tractsRef.current.length > 0) {
      const tractScale = makeColorScale(activeLayer, tractsRef.current);
      gTractsRef.current
        .selectAll<SVGPathElement, any>('path.tract')
        .transition('fill')
        .duration(500)
        .delay((_, i) => i * 6)
        .attr('fill', (t) => tractScale(getTractLayerVal(t, activeLayer)));
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
        background:
          'radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--cyan) 8%, transparent), transparent 70%), var(--map-shell-bg, #F3F9FE)'
      }}
    >
      <div ref={containerRef} className="map-shell" style={{ position: 'absolute', inset: 0 }} />

      {/* Floating Legend Card (Bottom-Left) matching #d-leg */}
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

      {/* Floating Selection Card (Top-Right) matching #d-sel */}
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
              {TIER_LABELS[clickedTract.tier]} vulnerability. {(clickedTract.pop || 3200).toLocaleString()} residents
            </div>
            <button
              className="btn sm primary mt-s"
              id="d-open"
              style={{ width: '100%' }}
              onClick={() => router.push(`/census-tracts?county=${countyFips}&tract=${clickedTract.id}`)}
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
