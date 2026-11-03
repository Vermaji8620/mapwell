'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CountyRecord, getCountyRepository, STATE_META } from '@/utils/countyRepository';
import { TIER_LABELS, TIER_COLORS, METRICS_CONFIG } from '@/config/metrics';
import {
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Crosshair,
  X,
  FileText,
  Flag,
  Layers
} from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icons';

export interface LayerDef {
  id: string;
  name: string;
  desc: string;
  metrics: string[];
  ramp: string[];
}

export const HEALTH_MAP_LAYERS: LayerDef[] = [
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

export const MAP_LOW = '#101B45';

let topoCache: any = null;
const tractCache = new Map<string, any[]>();

export function getMetricValue(rec: any, key: string): number {
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
  const svi = rec.svi ?? (rec.indicators?.svi ?? 0.5);
  const mMeta = METRICS_CONFIG[key];
  if (mMeta?.bad === 'low') {
    return Math.max(50, 95 - svi * 35);
  }
  return Math.max(3, 12 + svi * 45);
}

export interface HealthMapCanvasProps {
  initialCountyId?: string;
  initialTractId?: string;
  onTractSelect?: (tract: any) => void;
  onCountySelect?: (county: CountyRecord) => void;
  onAddFinding?: (tract: any) => void;
  onToggleCompare?: (tractId: string) => void;
  onToggleFlag?: (tractId: string) => void;
  compareTractIds?: string[];
  flaggedTractIds?: string[];
}

export function HealthMapCanvas({
  initialCountyId,
  initialTractId,
  onTractSelect,
  onCountySelect,
  onAddFinding,
  onToggleCompare,
  onToggleFlag,
  compareTractIds = [],
  flaggedTractIds = []
}: HealthMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const rootGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const cachedRepoRef = useRef<any>(null);

  // Active Map Scope State
  const [activeLayerId, setActiveLayerId] = useState<string>('sdoh');
  const [activeMetricKey, setActiveMetricKey] = useState<string>('sdoh');
  const [selectedState, setSelectedState] = useState<{ abbr: string; name: string; fips: string } | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<CountyRecord | null>(null);
  const [selectedTract, setSelectedTract] = useState<any | null>(null);
  const [countyTracts, setCountyTracts] = useState<any[]>([]);

  // Toggles
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [markersEnabled, setMarkersEnabled] = useState(true);

  // UI state
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recolorPerf, setRecolorPerf] = useState<{ n: number; ms: number }>({ n: 3142, ms: 10 });
  const [legendInfo, setLegendInfo] = useState<{
    title: string;
    lo: string;
    hi: string;
    note: string;
    bins: string[];
  }>({
    title: 'SDOH composite burden',
    lo: '12%',
    hi: '68%',
    note: 'National quantiles',
    bins: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D']
  });

  // Tooltip
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    lines: { label: string; val: string }[];
  }>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    lines: []
  });

  const activeLayer = HEALTH_MAP_LAYERS.find(l => l.id === activeLayerId) || HEALTH_MAP_LAYERS[0];
  const activeMetricMeta = METRICS_CONFIG[activeMetricKey] || {
    label: activeMetricKey,
    short: activeMetricKey,
    unit: '%',
    bad: 'high'
  };

  const compareSet = useMemo(() => new Set(compareTractIds), [compareTractIds]);
  const flaggedSet = useMemo(() => new Set(flaggedTractIds), [flaggedTractIds]);

  // References for map callbacks
  const selectCountyFnRef = useRef<((cid: string, animate?: boolean) => void) | null>(null);
  const selectTractFnRef = useRef<((tid: string) => void) | null>(null);
  const zoomToStateFnRef = useRef<((st: string) => void) | null>(null);
  const resetMapFnRef = useRef<(() => void) | null>(null);
  const drawHeatFnRef = useRef<((heat: boolean, mKey: string, cid: string | null) => void) | null>(null);
  const drawMarkersFnRef = useRef<((mk: boolean, mKey: string, cid: string | null) => void) | null>(null);

  // Initialize Map and Render Counties
  useEffect(() => {
    let isCancelled = false;

    async function initHealthMap() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';

      const repo = await getCountyRepository();
      if (isCancelled || !containerRef.current) return;
      cachedRepoRef.current = repo;

      if (!topoCache) {
        try {
          const res = await fetch('/us-counties.json');
          if (!res.ok) throw new Error('Failed to load map geometry');
          topoCache = await res.json();
        } catch (e) {
          console.error(e);
          return;
        }
      }

      if (isCancelled || !topoCache) return;

      const statesMesh = topojson.mesh(topoCache, topoCache.objects.states, (a: any, b: any) => a !== b);
      const nationFeature = topojson.feature(topoCache, topoCache.objects.nation);
      const pathGen = d3.geoPath();

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none map-svg')
        .style('background', '#07111F');

      svgRef.current = svg;

      const defs = svg.append('defs');

      // Pulse Marker Animations
      const pulseStyle = defs.append('style');
      pulseStyle.text(`
        @keyframes mapPulse {
          0% { r: 3.5px; opacity: 0.95; }
          50% { r: 9px; opacity: 0.2; }
          100% { r: 3.5px; opacity: 0.95; }
        }
        .pulse-marker-ring {
          animation: mapPulse 2.2s ease-in-out infinite;
          transform-origin: center;
        }
        svg.dim-others path.county:not(.sel) {
          opacity: 0.45;
        }
        svg.dim-others path.county.sel {
          opacity: 1;
        }
      `);

      // Gentle, softened Radial Heatmap Gradient (not overly bright/blinding)
      const heatGrad = defs.append('radialGradient')
        .attr('id', 'hm-heat-glow')
        .attr('cx', '50%')
        .attr('cy', '50%')
        .attr('r', '50%');
      heatGrad.append('stop').attr('offset', '0%').attr('stop-color', '#2584EB').attr('stop-opacity', 0.42);
      heatGrad.append('stop').attr('offset', '40%').attr('stop-color', '#1E60BF').attr('stop-opacity', 0.22);
      heatGrad.append('stop').attr('offset', '75%').attr('stop-color', '#123A7D').attr('stop-opacity', 0.08);
      heatGrad.append('stop').attr('offset', '100%').attr('stop-color', '#07111F').attr('stop-opacity', 0);

      // County Tract Clip Path
      const clipPath = defs.append('clipPath').attr('id', 'hm-county-clip').append('path');

      // Root zoomable group
      const rootG = svg.append('g').attr('class', 'root-zoom-group');
      rootGroupRef.current = rootG;

      // Group Layers
      const gCounties = rootG.append('g').attr('class', 'counties-layer');
      const gBorders = rootG.append('g').attr('class', 'borders-layer').style('pointer-events', 'none');
      const gHeat = rootG.append('g').attr('class', 'heatmap-layer').style('pointer-events', 'none');
      const gTracts = rootG.append('g').attr('class', 'tracts-layer').attr('clip-path', 'url(#hm-county-clip)');
      const gSelCounty = rootG.append('g').attr('class', 'sel-county-layer').style('pointer-events', 'none');
      const gSelTract = rootG.append('g').attr('class', 'sel-tract-layer').style('pointer-events', 'none');
      const gMarkers = rootG.append('g').attr('class', 'markers-layer').style('pointer-events', 'none');

      // Borders
      gBorders.append('path')
        .datum(statesMesh)
        .attr('class', 'state-borders')
        .attr('d', pathGen as any)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255, 255, 255, 0.28)')
        .attr('stroke-width', 0.8)
        .attr('vector-effect', 'non-scaling-stroke');

      gBorders.append('path')
        .datum(nationFeature)
        .attr('class', 'nation-border')
        .attr('d', pathGen as any)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255, 255, 255, 0.45)')
        .attr('stroke-width', 1.2)
        .attr('vector-effect', 'non-scaling-stroke');

      // Zoom Behavior
      let currentK = 1;
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.45, 60])
        .translateExtent([[-600, -400], [1600, 1100]])
        .on('zoom', (event) => {
          rootG.attr('transform', event.transform);
          currentK = event.transform.k;
          gMarkers.selectAll('g.marker-pin').attr('transform', function (this: any) {
            const cx = d3.select(this).attr('data-cx');
            const cy = d3.select(this).attr('data-cy');
            return `translate(${cx}, ${cy}) scale(${1 / Math.sqrt(currentK)}) translate(${-cx}, ${-cy})`;
          });
        });

      svg.call(zoom).on('dblclick.zoom', null);
      zoomBehaviorRef.current = zoom;

      // Color Scale Builder
      function buildColorScale(layerId: string, metricKey: string) {
        const lyr = HEALTH_MAP_LAYERS.find(l => l.id === layerId) || HEALTH_MAP_LAYERS[0];
        const mMeta = METRICS_CONFIG[metricKey] || { bad: 'high' };
        const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
          d3.interpolateRgb(MAP_LOW, lyr.ramp[0])(0.6),
          ...lyr.ramp
        ]);
        const values = repo.counties.map(c => getMetricValue(c, metricKey));
        const qScale = d3.scaleQuantile().domain(values).range(d3.range(7));
        const flip = mMeta.bad === 'low';
        const tOf = (i: number) => {
          const t = (i + 0.5) / 7;
          return flip ? 1 - t : t;
        };

        const getColor = (v: number) => interp(tOf(qScale(v)));
        const bins = d3.range(7).map(i => interp(tOf(i)));
        const extent = d3.extent(values) as [number, number];

        return { getColor, bins, extent, qScale };
      }

      // Tract Generator for County
      function getTractsForCounty(cRecord: CountyRecord) {
        if (tractCache.has(cRecord.id)) {
          return tractCache.get(cRecord.id)!;
        }

        const [[bx0, by0], [bx1, by1]] = pathGen.bounds(cRecord.feature);
        const bw = Math.max(bx1 - bx0, 10);
        const bh = Math.max(by1 - by0, 10);
        const count = Math.max(8, Math.min(26, Math.round(cRecord.pop / 4500)));

        let seed = 0;
        for (let i = 0; i < cRecord.id.length; i++) seed += cRecord.id.charCodeAt(i) * (i + 1) * 31;
        const prng = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        const pts: [number, number][] = [];
        for (let i = 0; i < count; i++) {
          const r1 = prng();
          const r2 = prng();
          pts.push([bx0 + bw * (0.12 + r1 * 0.76), by0 + bh * (0.12 + r2 * 0.76)]);
        }

        if (pts.length < 3) {
          pts.push([bx0 + bw * 0.5, by0 + bh * 0.5], [bx0 + 1, by0 + 1], [bx0 + bw - 1, by0 + bh - 1]);
        }

        const delaunay = d3.Delaunay.from(pts);
        const voronoi = delaunay.voronoi([bx0 - 20, by0 - 20, bx0 + bw + 20, by0 + bh + 20]);

        const out = pts.map((pt, i) => {
          const r1 = prng();
          const r2 = prng();
          const svi = Math.max(0.02, Math.min(0.99, cRecord.svi + (r1 - 0.5) * 0.35));
          const tNum = 101 + i * 2;
          const tractId = `${cRecord.id}${String(tNum).padStart(4, '0')}00`;

          const ind: Record<string, number> = {
            sdoh: Math.round(cRecord.indicators.sdoh * (0.7 + r1 * 0.6)),
            incidence: Math.round(cRecord.indicators.incidence * (0.75 + r2 * 0.5)),
            utilization: Math.round(cRecord.indicators.utilization * (0.7 + prng() * 0.6)),
            poverty: Math.round(cRecord.indicators.poverty * (0.7 + r1 * 0.6) * 10) / 10,
            childPoverty: Math.round(cRecord.indicators.childPoverty * (0.7 + r1 * 0.6) * 10) / 10,
            uninsured: Math.round(cRecord.indicators.uninsured * (0.75 + r2 * 0.5) * 10) / 10,
            diabetes: Math.round(cRecord.indicators.diabetes * (0.8 + prng() * 0.4) * 10) / 10,
            asthma: Math.round(cRecord.indicators.asthma * (0.8 + prng() * 0.4) * 10) / 10,
            hypertension: Math.round(cRecord.indicators.hypertension * (0.85 + r1 * 0.3) * 10) / 10,
            obesity: Math.round(cRecord.indicators.obesity * (0.85 + r2 * 0.3) * 10) / 10,
            copd: Math.round(cRecord.indicators.copd * (0.8 + prng() * 0.4) * 10) / 10,
            noVehicle: Math.round(cRecord.indicators.noVehicle * (0.7 + r1 * 0.6) * 10) / 10,
            noDiploma: Math.round(cRecord.indicators.noDiploma * (0.7 + r2 * 0.6) * 10) / 10,
            unemployment: Math.round(cRecord.indicators.unemployment * (0.7 + prng() * 0.6) * 10) / 10,
            rentBurden: Math.round(cRecord.indicators.rentBurden * (0.8 + r1 * 0.4) * 10) / 10,
            crowding: Math.round(cRecord.indicators.crowding * (0.7 + r2 * 0.6) * 10) / 10,
            access: Math.round(cRecord.indicators.access * (0.8 + r2 * 0.4)),
            pcp: Math.round(cRecord.indicators.pcp * (0.8 + prng() * 0.4) * 10) / 10,
            driveTime: Math.round(cRecord.indicators.driveTime * (0.8 + r1 * 0.4)),
            lifeExp: Math.round((cRecord.indicators.lifeExp - (svi - 0.5) * 6) * 10) / 10,
            svi: Math.round(svi * 100) / 100,
            'prog.wic': Math.round(((cRecord.indicators as any)['prog.wic'] ?? 52) * (0.7 + r1 * 0.6)),
            'prog.imm': Math.round(((cRecord.indicators as any)['prog.imm'] ?? 64) * (0.7 + r2 * 0.6)),
            'prog.dpp': Math.round(((cRecord.indicators as any)['prog.dpp'] ?? 38) * (0.7 + prng() * 0.6)),
            'prog.tob': Math.round(((cRecord.indicators as any)['prog.tob'] ?? 45) * (0.7 + r1 * 0.6)),
            'prog.mhv': Math.round(((cRecord.indicators as any)['prog.mhv'] ?? 40) * (0.7 + r2 * 0.6)),
          };

          return {
            id: tractId,
            name: `Census Tract ${tNum}`,
            countyId: cRecord.id,
            countyName: cRecord.name,
            stateAbbr: cRecord.stateAbbr,
            pop: Math.round(Math.max(800, cRecord.pop / count * (0.6 + r2 * 0.8))),
            svi,
            tier: Math.min(4, Math.floor(svi * 5)),
            cx: pt[0],
            cy: pt[1],
            d: voronoi.renderCell(i) || '',
            indicators: ind
          };
        });

        tractCache.set(cRecord.id, out);
        return out;
      }

      // Initial Recolor of Counties
      const tStart = performance.now();
      const initialScale = buildColorScale('sdoh', 'sdoh');

      let activeCid: string | null = null;
      let activeTid: string | null = null;
      let activeSt: string | null = null;

      const countyPaths = gCounties.selectAll<SVGPathElement, CountyRecord>('path.county')
        .data(repo.counties, (c: any) => c.id)
        .enter()
        .append('path')
        .attr('class', 'county')
        .attr('data-id', c => c.id)
        .attr('d', c => pathGen(c.feature) || '')
        .attr('fill', c => initialScale.getColor(getMetricValue(c, 'sdoh')))
        .attr('stroke', 'rgba(255, 255, 255, 0.12)')
        .attr('stroke-width', 0.5)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('cursor', 'pointer');

      const msElapsed = Math.round(performance.now() - tStart);
      setRecolorPerf({ n: repo.counties.length, ms: Math.max(6, msElapsed) });

      setLegendInfo({
        title: 'SDOH composite burden',
        lo: `${initialScale.extent[0].toFixed(1)}%`,
        hi: `${initialScale.extent[1].toFixed(1)}%`,
        note: 'National quantiles',
        bins: initialScale.bins
      });

      // Counties Hover & Click
      countyPaths
        .on('pointerenter', function (event, c) {
          if (activeCid && c.id !== activeCid) {
            d3.select(this)
              .attr('stroke', '#38BDF8')
              .attr('stroke-width', 1.4)
              .attr('opacity', 0.85);
          }

          const cRect = container.getBoundingClientRect();
          const indVal = getMetricValue(c, activeMetricKey);
          const formattedVal = `${indVal.toFixed(1)}%`;

          setTooltip({
            visible: true,
            x: event.clientX - cRect.left + 14,
            y: event.clientY - cRect.top - 14,
            title: `${c.name} County, ${c.stateAbbr}`,
            lines: [
              { label: activeMetricMeta.short || 'Indicator', val: formattedVal },
              { label: 'Vulnerability', val: c.svi.toFixed(2) },
              { label: 'Population', val: `${Math.round(c.pop / 1000)}k` }
            ]
          });
        })
        .on('pointermove', function (event) {
          const cRect = container.getBoundingClientRect();
          setTooltip(prev => ({
            ...prev,
            x: event.clientX - cRect.left + 14,
            y: event.clientY - cRect.top - 14
          }));
        })
        .on('pointerleave', function (event, c) {
          if (activeCid && c.id !== activeCid) {
            d3.select(this)
              .attr('stroke', 'rgba(255, 255, 255, 0.08)')
              .attr('stroke-width', 0.4)
              .attr('opacity', 0.45);
          }
          setTooltip(prev => ({ ...prev, visible: false }));
        })
        .on('click', function (event, c) {
          event.stopPropagation();
          // If in national view (neither county nor state selected), zoom into state first
          if (!activeCid && !activeSt) {
            zoomToState(c.st);
          } else {
            drillIntoCounty(c.id, true);
          }
        });

      // Fit Padding Helper to reduce map size on load and keep it comfortably framed
      function fitPadding(pad = { l: 310, r: 350, t: 60, b: 40 }) {
        if (!containerRef.current || !svgRef.current) return;
        const W = containerRef.current.clientWidth;
        const H = containerRef.current.clientHeight;
        if (!W || !H) return;
        const mm = Math.min(W / 975, H / 610);
        const ox = (W - 975 * mm) / 2;
        const oy = (H - 610 * mm) / 2;
        const r = [(pad.l - ox) / mm, (pad.t - oy) / mm, (W - pad.r - ox) / mm, (H - pad.b - oy) / mm];
        const s = Math.min((r[2] - r[0]) / 975, (r[3] - r[1]) / 610) * 0.94;
        const home = d3.zoomIdentity.translate((r[0] + r[2]) / 2 - s * 487.5, (r[1] + r[3]) / 2 - s * 305).scale(s);
        svg.call(zoom.transform, home);
      }

      // Hotspot Heatmap Function (softened, reduced glare)
      function drawHeat(heatOn: boolean, mKey: string, cid: string | null) {
        gHeat.selectAll('*').remove();
        if (!heatOn) return;

        const mMeta = METRICS_CONFIG[mKey] || { bad: 'high' };
        const needOf = (d: any) => {
          const v = getMetricValue(d, mKey);
          return mMeta.bad === 'low' ? -v : v;
        };

        if (cid) {
          const tracts = tractCache.get(cid) || [];
          const sorted = [...tracts].sort((a, b) => needOf(b) - needOf(a));
          const top = sorted.slice(0, Math.max(3, Math.ceil(tracts.length * 0.35)));

          gHeat.selectAll('circle')
            .data(top)
            .join('circle')
            .attr('cx', (d: any) => d.cx)
            .attr('cy', (d: any) => d.cy)
            .attr('r', 0)
            .attr('fill', 'url(#hm-heat-glow)')
            .attr('opacity', 0.65)
            .transition()
            .duration(650)
            .attr('r', 16);
        } else {
          const sorted = [...repo.counties].sort((a, b) => needOf(b) - needOf(a));
          const top = sorted.slice(0, Math.ceil(repo.counties.length * 0.12));

          gHeat.selectAll('circle')
            .data(top)
            .join('circle')
            .attr('cx', (d: any) => d.cx)
            .attr('cy', (d: any) => d.cy)
            .attr('r', 0)
            .attr('fill', 'url(#hm-heat-glow)')
            .attr('opacity', 0.60)
            .transition()
            .duration(700)
            .delay((_, i) => Math.min(450, i * 1.5))
            .attr('r', (d: any) => Math.max(8, Math.sqrt(d.area || 60) * 1.3));
        }
      }
      drawHeatFnRef.current = drawHeat;

      // Highest-need Markers Function
      function renderNeedMarkers(mkOn: boolean, mKey: string, cid: string | null) {
        gMarkers.selectAll('*').remove();
        if (!mkOn) return;

        const mMeta = METRICS_CONFIG[mKey] || { bad: 'high' };
        const needOf = (d: any) => {
          const v = getMetricValue(d, mKey);
          return mMeta.bad === 'low' ? -v : v;
        };

        let pts: { x: number; y: number }[] = [];
        if (cid) {
          const tracts = tractCache.get(cid) || [];
          pts = [...tracts].sort((a, b) => needOf(b) - needOf(a)).slice(0, 3).map(t => ({ x: t.cx, y: t.cy }));
        } else {
          pts = [...repo.counties].sort((a, b) => needOf(b) - needOf(a)).slice(0, 7).map(c => {
            const cent = pathGen.centroid(c.feature);
            return { x: cent[0], y: cent[1] };
          }).filter(pt => !isNaN(pt.x));
        }

        pts.forEach(pt => {
          const mG = gMarkers.append('g')
            .attr('class', 'marker-pin')
            .attr('data-cx', pt.x)
            .attr('data-cy', pt.y)
            .attr('transform', `translate(${pt.x}, ${pt.y}) scale(${1 / Math.sqrt(currentK)}) translate(${-pt.x}, ${-pt.y})`);

          mG.append('circle')
            .attr('cx', pt.x)
            .attr('cy', pt.y)
            .attr('class', 'pulse-marker-ring')
            .attr('fill', '#FF5D8F')
            .attr('opacity', 0.65);

          mG.append('circle')
            .attr('cx', pt.x)
            .attr('cy', pt.y)
            .attr('r', 2.8)
            .attr('fill', '#ffffff')
            .attr('stroke', '#FF5D8F')
            .attr('stroke-width', 1.2);
        });
      }
      drawMarkersFnRef.current = renderNeedMarkers;

      // Drill into County
      function drillIntoCounty(cid: string, animate = true) {
        activeCid = cid;
        const targetCounty = repo.countyById.get(cid);
        if (!targetCounty) return;

        activeSt = targetCounty.st;
        setSelectedState({ abbr: targetCounty.stateAbbr, name: targetCounty.stateName, fips: targetCounty.st });
        setSelectedCounty(targetCounty);
        setSelectedTract(null);
        if (onCountySelect) onCountySelect(targetCounty);

        const countyD = pathGen(targetCounty.feature) || '';
        const bounds = pathGen.bounds(targetCounty.feature);

        // Zoom Camera to County with compact padding
        const [[x0, y0], [x1, y1]] = bounds;
        const dx = Math.max(x1 - x0, 10);
        const dy = Math.max(y1 - y0, 10);
        const pad = 0.22;
        const s = Math.min(5.8, Math.max(1.4, pad / Math.max(dx / 975, dy / 610)));
        const targetCenterX = 485;
        const targetCenterY = 305;
        const tx = targetCenterX - s * (x0 + x1) / 2;
        const ty = targetCenterY - s * (y0 + y1) / 2;
        const targetT = d3.zoomIdentity.translate(tx, ty).scale(s);

        if (animate) {
          svg.transition('zoom-camera')
            .duration(850)
            .ease(d3.easeCubicInOut)
            .call(zoom.transform, targetT);
        } else {
          svg.call(zoom.transform, targetT);
        }

        // Dim Other Counties to dark muted navy
        svg.classed('dim-others', true);
        gCounties.selectAll<SVGPathElement, CountyRecord>('path.county')
          .classed('sel', (c: any) => c.id === cid)
          .transition('dim-surround')
          .duration(350)
          .attr('fill', (c: any) => c.id === cid ? '#101B45' : '#0B1530')
          .attr('opacity', (c: any) => c.id === cid ? 1 : 0.45)
          .attr('stroke', (c: any) => c.id === cid ? 'var(--cyan, #37C8CF)' : 'rgba(255, 255, 255, 0.08)')
          .attr('stroke-width', (c: any) => c.id === cid ? 2.2 : 0.4);

        clipPath.attr('d', countyD);

        gSelCounty.selectAll('*').remove();
        gSelCounty.append('path')
          .attr('d', countyD)
          .attr('fill', 'none')
          .attr('stroke', 'var(--cyan, #37C8CF)')
          .attr('stroke-width', 2.2)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('filter', 'drop-shadow(0 0 8px rgba(55, 200, 207, 0.85))');

        // Draw Tracts Inside County
        const tractsList = getTractsForCounty(targetCounty);
        setCountyTracts(tractsList);

        gTracts.selectAll('*').remove();
        gSelTract.selectAll('*').remove();

        const currentScale = buildColorScale(activeLayerId, activeMetricKey);

        const tractPaths = gTracts.selectAll<SVGPathElement, any>('path.tract')
          .data(tractsList, (t: any) => t.id)
          .enter()
          .append('path')
          .attr('class', 'tract')
          .attr('d', (t: any) => t.d)
          .attr('data-id', (t: any) => t.id)
          .attr('fill', (t: any) => currentScale.getColor(getMetricValue(t, activeMetricKey)))
          .attr('stroke', 'rgba(255, 255, 255, 0.45)')
          .attr('stroke-width', 0.8)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('cursor', 'pointer');

        tractPaths.attr('opacity', 0)
          .transition('tract-in')
          .delay((_, i) => 100 + i * 14)
          .duration(380)
          .attr('opacity', 1);

        tractPaths
          .on('pointerenter', function (event, t: any) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 2.0)
              .raise();

            const cRect = container.getBoundingClientRect();
            const v = getMetricValue(t, activeMetricKey);
            setTooltip({
              visible: true,
              x: event.clientX - cRect.left + 14,
              y: event.clientY - cRect.top - 14,
              title: t.name,
              lines: [
                { label: 'GEOID', val: t.id },
                { label: activeMetricMeta.short || 'Value', val: `${v.toFixed(1)}%` },
                { label: 'Tier', val: TIER_LABELS[t.tier] },
                { label: 'Population', val: t.pop.toLocaleString() }
              ]
            });
          })
          .on('pointermove', function (event) {
            const cRect = container.getBoundingClientRect();
            setTooltip(prev => ({
              ...prev,
              x: event.clientX - cRect.left + 14,
              y: event.clientY - cRect.top - 14
            }));
          })
          .on('pointerleave', function (_, t: any) {
            d3.select(this)
              .attr('stroke', 'rgba(255, 255, 255, 0.45)')
              .attr('stroke-width', 0.8);
            setTooltip(prev => ({ ...prev, visible: false }));
          })
          .on('click', function (event, t: any) {
            event.stopPropagation();
            drillIntoTract(t);
          });

        // Highlight the tract with the highest need for this indicator
        const mMeta = METRICS_CONFIG[activeMetricKey] || { bad: 'high' };
        const sortedTracts = [...tractsList].sort((a, b) => {
          const va = getMetricValue(a, activeMetricKey);
          const vb = getMetricValue(b, activeMetricKey);
          return mMeta.bad === 'low' ? va - vb : vb - va;
        });
        if (sortedTracts.length > 0) {
          drillIntoTract(sortedTracts[0]);
        }

        drawHeat(heatmapEnabled, activeMetricKey, cid);
        renderNeedMarkers(markersEnabled, activeMetricKey, cid);
      }

      function drillIntoTract(tract: any) {
        activeTid = tract.id;
        setSelectedTract(tract);
        if (onTractSelect) onTractSelect(tract);

        // Highlight selected tract with cyan border & drop-shadow
        gSelTract.selectAll('*').remove();
        gSelTract.append('path')
          .attr('d', tract.d)
          .attr('fill', 'none')
          .attr('stroke', 'var(--cyan, #37C8CF)')
          .attr('stroke-width', 2.8)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('filter', 'drop-shadow(0 0 6px var(--cyan, #37C8CF))');
      }

      // Reset to National View
      function resetToNationalView() {
        activeCid = null;
        activeTid = null;
        activeSt = null;
        setSelectedState(null);
        setSelectedCounty(null);
        setSelectedTract(null);
        setCountyTracts([]);

        svg.classed('dim-others', false);
        const currentScale = buildColorScale(activeLayerId, activeMetricKey);

        gCounties.selectAll<SVGPathElement, CountyRecord>('path.county')
          .classed('sel', false)
          .transition('restore-counties')
          .duration(450)
          .attr('fill', c => currentScale.getColor(getMetricValue(c, activeMetricKey)))
          .attr('opacity', 1)
          .attr('stroke', 'rgba(255, 255, 255, 0.12)')
          .attr('stroke-width', 0.5);

        gTracts.selectAll('*').remove();
        gSelCounty.selectAll('*').remove();
        gSelTract.selectAll('*').remove();

        fitPadding();
        drawHeat(heatmapEnabled, activeMetricKey, null);
        renderNeedMarkers(markersEnabled, activeMetricKey, null);
      }

      // Zoom to State (generous framing, expanded view)
      function zoomToState(st: string) {
        activeCid = null;
        activeTid = null;
        activeSt = st;
        setSelectedCounty(null);
        setSelectedTract(null);
        setCountyTracts([]);
        gTracts.selectAll('*').remove();
        gSelCounty.selectAll('*').remove();
        gSelTract.selectAll('*').remove();

        const stMeta = STATE_META[st];
        setSelectedState(stMeta ? { abbr: stMeta[0], name: stMeta[1], fips: st } : { abbr: st, name: st, fips: st });

        const stateCounties = repo.countiesByState.get(st) || [];
        if (stateCounties.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        stateCounties.forEach(c => {
          const [[x0, y0], [x1, y1]] = pathGen.bounds(c.feature);
          if (x0 < minX) minX = x0;
          if (y0 < minY) minY = y0;
          if (x1 > maxX) maxX = x1;
          if (y1 > maxY) maxY = y1;
        });

        const dx = Math.max(maxX - minX, 10);
        const dy = Math.max(maxY - minY, 10);
        // Generous pad = 0.68 ensures the state appears significantly bigger and prominent
        const pad = 0.68;
        const s = Math.min(18, Math.max(1.8, pad / Math.max(dx / 975, dy / 610)));
        const tx = 485 - s * (minX + maxX) / 2;
        const ty = 305 - s * (minY + maxY) / 2;
        const targetT = d3.zoomIdentity.translate(tx, ty).scale(s);

        svg.classed('dim-others', true);
        const currentScale = buildColorScale(activeLayerId, activeMetricKey);

        gCounties.selectAll<SVGPathElement, CountyRecord>('path.county')
          .transition('state-focus')
          .duration(400)
          .attr('fill', c => c.st === st ? currentScale.getColor(getMetricValue(c, activeMetricKey)) : '#0B1530')
          .attr('opacity', c => c.st === st ? 1 : 0.35)
          .attr('stroke', c => c.st === st ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.05)')
          .attr('stroke-width', c => c.st === st ? 0.6 : 0.3);

        svg.transition('zoom-state')
          .duration(850)
          .ease(d3.easeCubicInOut)
          .call(zoom.transform, targetT);

        drawHeat(heatmapEnabled, activeMetricKey, null);
        renderNeedMarkers(markersEnabled, activeMetricKey, null);
      }

      selectCountyFnRef.current = (cid, anim = true) => drillIntoCounty(cid, anim);
      selectTractFnRef.current = (tid) => {
        const tr = tractCache.get(activeCid || '')?.find(x => x.id === tid);
        if (tr) drillIntoTract(tr);
      };
      zoomToStateFnRef.current = zoomToState;
      resetMapFnRef.current = resetToNationalView;

      // Handle Initial Load
      if (initialCountyId) {
        setTimeout(() => {
          if (!isCancelled) drillIntoCounty(initialCountyId, false);
        }, 150);
      } else {
        setTimeout(() => {
          if (!isCancelled) {
            fitPadding();
            renderNeedMarkers(markersEnabled, 'sdoh', null);
            drawHeat(heatmapEnabled, 'sdoh', null);
          }
        }, 150);
      }

      const handleResize = () => {
        if (!activeCid && !activeSt) fitPadding();
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }

    initHealthMap();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Update map colors, heat, markers, and highlight whenever activeLayerId or activeMetricKey changes
  useEffect(() => {
    if (!svgRef.current || !rootGroupRef.current) return;
    const svg = svgRef.current;
    const rootG = rootGroupRef.current;
    const lyr = HEALTH_MAP_LAYERS.find(l => l.id === activeLayerId) || HEALTH_MAP_LAYERS[0];
    const mMeta = METRICS_CONFIG[activeMetricKey] || { bad: 'high', label: activeMetricKey, short: activeMetricKey };

    const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
      d3.interpolateRgb(MAP_LOW, lyr.ramp[0])(0.6),
      ...lyr.ramp
    ]);

    getCountyRepository().then(repo => {
      const t0 = performance.now();
      const values = repo.counties.map(c => getMetricValue(c, activeMetricKey));
      const qScale = d3.scaleQuantile().domain(values).range(d3.range(7));
      const flip = mMeta.bad === 'low';
      const tOf = (i: number) => {
        const t = (i + 0.5) / 7;
        return flip ? 1 - t : t;
      };

      const getColor = (v: number) => interp(tOf(qScale(v)));
      const bins = d3.range(7).map(i => interp(tOf(i)));
      const extent = d3.extent(values) as [number, number];

      if (selectedCounty) {
        // In county view: Keep surrounding counties dimmed, recolor tracts
        svg.selectAll<SVGPathElement, CountyRecord>('path.county')
          .attr('fill', (c: any) => c.id === selectedCounty.id ? '#101B45' : '#0B1530')
          .attr('opacity', (c: any) => c.id === selectedCounty.id ? 1 : 0.45);

        rootG.selectAll<SVGPathElement, any>('path.tract')
          .transition('recolor-tracts')
          .duration(380)
          .attr('fill', t => getColor(getMetricValue(t, activeMetricKey)));

        // Highlight the tract with the highest need for this specific metric
        const tracts = tractCache.get(selectedCounty.id) || [];
        const sorted = [...tracts].sort((a, b) => {
          const va = getMetricValue(a, activeMetricKey);
          const vb = getMetricValue(b, activeMetricKey);
          return mMeta.bad === 'low' ? va - vb : vb - va;
        });

        if (sorted.length > 0) {
          const topTract = sorted[0];
          setSelectedTract(topTract);

          const gSelTract = rootG.select<SVGGElement>('g.sel-tract-layer');
          gSelTract.selectAll('*').remove();
          gSelTract.append('path')
            .attr('d', topTract.d)
            .attr('fill', 'none')
            .attr('stroke', 'var(--cyan, #37C8CF)')
            .attr('stroke-width', 2.8)
            .attr('vector-effect', 'non-scaling-stroke')
            .style('filter', 'drop-shadow(0 0 6px var(--cyan, #37C8CF))');
        }

        drawHeatFnRef.current?.(heatmapEnabled, activeMetricKey, selectedCounty.id);
        drawMarkersFnRef.current?.(markersEnabled, activeMetricKey, selectedCounty.id);
      } else if (selectedState) {
        // In state view: Recolor state counties, keep others dimmed
        svg.selectAll<SVGPathElement, CountyRecord>('path.county')
          .transition('recolor-state-counties')
          .duration(380)
          .attr('fill', c => c.st === selectedState.fips ? getColor(getMetricValue(c, activeMetricKey)) : '#0B1530')
          .attr('opacity', c => c.st === selectedState.fips ? 1 : 0.35);

        drawHeatFnRef.current?.(heatmapEnabled, activeMetricKey, null);
        drawMarkersFnRef.current?.(markersEnabled, activeMetricKey, null);
      } else {
        // In national view: Recolor all counties
        svg.selectAll<SVGPathElement, CountyRecord>('path.county')
          .transition('recolor-counties')
          .duration(420)
          .attr('fill', c => getColor(getMetricValue(c, activeMetricKey)));

        drawHeatFnRef.current?.(heatmapEnabled, activeMetricKey, null);
        drawMarkersFnRef.current?.(markersEnabled, activeMetricKey, null);
      }

      const ms = Math.round(performance.now() - t0);
      setRecolorPerf({ n: repo.counties.length, ms: Math.max(8, ms) });

      setLegendInfo({
        title: mMeta.label || lyr.name,
        lo: `${extent[0].toFixed(1)}%`,
        hi: `${extent[1].toFixed(1)}%`,
        note: selectedCounty ? 'Tracts in county' : 'National quantiles',
        bins
      });
    });
  }, [activeLayerId, activeMetricKey, selectedCounty, selectedState, heatmapEnabled, markersEnabled]);

  // Handler for Layer Selection
  const handleSelectLayer = (lyrId: string) => {
    const lyr = HEALTH_MAP_LAYERS.find(l => l.id === lyrId) || HEALTH_MAP_LAYERS[0];
    setActiveLayerId(lyr.id);
    setActiveMetricKey(lyr.metrics[0]);
  };

  // Filtered search results for county auto-complete
  const [searchResults, setSearchResults] = useState<CountyRecord[]>([]);
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.toLowerCase().trim();
    getCountyRepository().then(repo => {
      const matches = repo.counties
        .filter(c => c.name.toLowerCase().includes(q) || `${c.name} ${c.stateAbbr}`.toLowerCase().includes(q))
        .slice(0, 7);
      setSearchResults(matches);
    });
  }, [searchQuery]);

  // Percentile rank calculation for selected tract
  const tractPercentile = useMemo(() => {
    if (!selectedTract || countyTracts.length === 0) return 50;
    const vals = countyTracts.map(t => getMetricValue(t, activeMetricKey)).sort((a, b) => a - b);
    const targetVal = getMetricValue(selectedTract, activeMetricKey);
    const idx = vals.findIndex(v => v >= targetVal);
    const pct = Math.round(((idx === -1 ? vals.length : idx) / vals.length) * 100);
    return Math.max(1, Math.min(99, pct));
  }, [selectedTract, countyTracts, activeMetricKey]);

  // Top tracts in current county for active metric
  const topCountyTracts = useMemo(() => {
    if (!selectedCounty || countyTracts.length === 0) return [];
    const mMeta = METRICS_CONFIG[activeMetricKey] || { bad: 'high' };
    return [...countyTracts].sort((a, b) => {
      const va = getMetricValue(a, activeMetricKey);
      const vb = getMetricValue(b, activeMetricKey);
      return mMeta.bad === 'low' ? va - vb : vb - va;
    }).slice(0, 5);
  }, [selectedCounty, countyTracts, activeMetricKey]);

  // Top counties in current state for active metric
  const topStateCounties = useMemo(() => {
    if (!selectedState || selectedCounty || !cachedRepoRef.current) return [];
    const stateCounties = cachedRepoRef.current.countiesByState.get(selectedState.fips) || [];
    const mMeta = METRICS_CONFIG[activeMetricKey] || { bad: 'high' };
    return [...stateCounties].sort((a, b) => {
      const va = getMetricValue(a, activeMetricKey);
      const vb = getMetricValue(b, activeMetricKey);
      return mMeta.bad === 'low' ? va - vb : vb - va;
    }).slice(0, 8);
  }, [selectedState, selectedCounty, activeMetricKey, cachedRepoRef.current]);

  // Top national counties for active metric
  const topNationalCounties = useMemo(() => {
    if (selectedCounty || selectedState || !cachedRepoRef.current) return [];
    const repo = cachedRepoRef.current;
    const mMeta = METRICS_CONFIG[activeMetricKey] || { bad: 'high' };
    return [...repo.counties].sort((a, b) => {
      const va = getMetricValue(a, activeMetricKey);
      const vb = getMetricValue(b, activeMetricKey);
      return mMeta.bad === 'low' ? va - vb : vb - va;
    }).slice(0, 8);
  }, [selectedCounty, selectedState, activeMetricKey]);

  return (
    <div className="hm">
      {/* Full-bleed Map Viewport */}
      <div id="hm-map" ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Floating Top Breadcrumbs */}
      <div className="map-float hm-crumbs" id="hm-crumbs">
        <button
          onClick={() => resetMapFnRef.current?.()}
          className={!selectedState && !selectedCounty ? 'cur' : ''}
        >
          United States
        </button>

        {selectedState && (
          <>
            <span className="sep">/</span>
            <button
              onClick={() => zoomToStateFnRef.current?.(selectedState.fips)}
              className={!selectedCounty ? 'cur' : ''}
            >
              {selectedState.name}
            </button>
          </>
        )}

        {selectedCounty && (
          <>
            <span className="sep">/</span>
            <button
              onClick={() => selectCountyFnRef.current?.(selectedCounty.id, true)}
              className={!selectedTract ? 'cur' : ''}
            >
              {selectedCounty.name}
            </button>
          </>
        )}

        {selectedTract && (
          <>
            <span className="sep">/</span>
            <span className="cur">{selectedTract.name.replace('Census ', '')}</span>
          </>
        )}
      </div>

      {/* Floating Left Layers & Indicators Panel */}
      <aside className="map-float hm-layers" id="hm-layers">
        <button
          className="hm-sheet-handle"
          id="hm-handle"
          onClick={() => setMobileLayersOpen(!mobileLayersOpen)}
        >
          <span>
            <Icon name="layers" size={16} /> Layers and indicators
          </span>
          <Icon name="chevd" size={14} />
        </button>

        <div className="search" style={{ maxWidth: 'none', marginBottom: '12px' }}>
          <Icon name="search" size={15} />
          <input
            id="hm-q"
            type="text"
            placeholder="Search a county"
            autoComplete="off"
            aria-label="Search counties on the map"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchResults.length > 0 && (
            <div className="search-results show" id="hm-qr" style={{ display: 'block', maxHeight: '180px', overflowY: 'auto' }}>
              {searchResults.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    selectCountyFnRef.current?.(c.id, true);
                  }}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '6px 10px', fontSize: '12px', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }}
                >
                  <span style={{ fontWeight: 600 }}>{c.name} County</span>
                  <span className="note" style={{ color: 'var(--faint)', fontSize: '10.5px' }}>{c.stateAbbr}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <h3>Map layers</h3>
        <div id="hm-lb">
          {HEALTH_MAP_LAYERS.map((l) => {
            const isActive = l.id === activeLayerId;
            return (
              <button
                key={l.id}
                className={`layer-btn ${isActive ? 'on' : ''}`}
                onClick={() => handleSelectLayer(l.id)}
              >
                <span
                  className="sw"
                  style={{ background: `linear-gradient(135deg, ${l.ramp.join(',')})` }}
                />
                <span>
                  <b>{l.name}</b>
                  <small>{l.desc}</small>
                </span>
              </button>
            );
          })}
        </div>

        <h3 style={{ marginTop: '12px' }}>Indicator</h3>
        <div className="chips" id="hm-ind">
          {activeLayer.metrics.map((k) => {
            const meta = METRICS_CONFIG[k] || { short: k };
            const isChipActive = k === activeMetricKey;
            return (
              <button
                key={k}
                className={`chip ${isChipActive ? 'on' : ''}`}
                onClick={() => setActiveMetricKey(k)}
              >
                {meta.short || meta.label}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '8px' }}>
          <div className="hm-toggle">
            <span>Hotspot heatmap</span>
            <button
              className={`switch ${heatmapEnabled ? 'on' : ''}`}
              role="switch"
              aria-checked={heatmapEnabled}
              aria-label="Hotspot heatmap"
              onClick={() => setHeatmapEnabled(!heatmapEnabled)}
            />
          </div>
          <div className="hm-toggle">
            <span>Highest-need markers</span>
            <button
              className={`switch ${markersEnabled ? 'on' : ''}`}
              role="switch"
              aria-checked={markersEnabled}
              aria-label="Highest-need markers"
              onClick={() => setMarkersEnabled(!markersEnabled)}
            />
          </div>
        </div>

        <div className="note mt" style={{ marginTop: '12px' }}>
          <span className="pill demo">
            <span className="dot"></span>Demo environment
          </span>
        </div>
      </aside>

      {/* Floating Performance Readout */}
      <div className="map-float perf" id="hm-perf">
        <span className="dot" style={{ color: 'var(--teal)' }} />
        <span>
          <b className="num">{recolorPerf.n.toLocaleString()}</b> counties recolored in{' '}
          <b className="num">{recolorPerf.ms} ms</b> in this browser
        </span>
      </div>

      {/* Floating Legend */}
      <div className="map-float legend hm-legend" id="hm-leg">
        <span className="legend-title" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
          {legendInfo.title}
        </span>
        <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '3px' }}>
          {legendInfo.bins.map((c, i) => (
            <div key={i} style={{ flex: 1, height: '100%', backgroundColor: c }} />
          ))}
        </div>
        <div className="ends" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--faint)' }}>
          <span>{legendInfo.lo}</span>
          <span>{legendInfo.note}</span>
          <span>{legendInfo.hi}</span>
        </div>
      </div>

      {/* Floating Map Controls */}
      <div className="map-float map-ctrls hm-ctrls">
        <button
          onClick={() => svgRef.current?.transition().duration(300).call(zoomBehaviorRef.current!.scaleBy, 1.4)}
          aria-label="Zoom in"
          title="Zoom In"
        >
          <Icon name="plus" size={16} />
        </button>
        <button
          onClick={() => svgRef.current?.transition().duration(300).call(zoomBehaviorRef.current!.scaleBy, 1 / 1.4)}
          aria-label="Zoom out"
          title="Zoom Out"
        >
          <Icon name="minus" size={16} />
        </button>
        <button
          onClick={() => resetMapFnRef.current?.()}
          aria-label="Reset view"
          title="Reset to Full Country"
        >
          <Icon name="expand" size={16} />
        </button>
        <button
          onClick={() => selectCountyFnRef.current?.('17031', true)}
          aria-label="Go to my jurisdiction"
          title="Go to Jurisdiction"
        >
          <Icon name="locate" size={16} />
        </button>
      </div>

      {/* Floating Right Inspector Panel */}
      <aside className="map-float hm-right" id="hm-right">
        {selectedTract ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="pill info" style={{ fontSize: '10.5px' }}>Census tract</span>
              <button
                onClick={() => setSelectedTract(null)}
                className="icon-btn"
                style={{ width: '26px', height: '26px' }}
                aria-label="Close"
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{selectedTract.name}</h3>
              <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '2px' }}>
                {selectedCounty?.name} County, {selectedCounty?.stateAbbr}. GEOID {selectedTract.id}
              </div>
            </div>

            {/* Big Metric Display */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span className="num" style={{ fontSize: '30px', fontWeight: 700, color: 'var(--cyan)' }}>
                  {getMetricValue(selectedTract, activeMetricKey).toFixed(1)}%
                </span>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--muted)' }}>
                  {activeMetricMeta.short}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '2px' }}>
                {tractPercentile}th percentile within {selectedCounty?.name} County
              </div>
            </div>

            {/* Key Indicator Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              <div style={{ padding: '8px 10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Vulnerability (SVI)</small>
                <b className="num" style={{ fontSize: '13.5px' }}>{selectedTract.svi.toFixed(2)}</b>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Poverty rate</small>
                <b className="num" style={{ fontSize: '13.5px' }}>{getMetricValue(selectedTract, 'poverty').toFixed(1)}%</b>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Uninsured</small>
                <b className="num" style={{ fontSize: '13.5px' }}>{getMetricValue(selectedTract, 'uninsured').toFixed(1)}%</b>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Diabetes</small>
                <b className="num" style={{ fontSize: '13.5px' }}>{getMetricValue(selectedTract, 'diabetes').toFixed(1)}%</b>
              </div>
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                className="pill"
                style={{
                  background: `${TIER_COLORS[selectedTract.tier]}20`,
                  color: TIER_COLORS[selectedTract.tier]
                }}
              >
                {TIER_LABELS[selectedTract.tier]} vulnerability
              </span>
              <span className="pill sm" style={{ color: 'var(--muted)' }}>
                {selectedTract.pop.toLocaleString()} residents
              </span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '10px', borderTop: '1px solid var(--line)' }}>
              <Link
                href={`/census-tracts?county=${selectedCounty?.id}&tract=${selectedTract.id}`}
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <Icon name="file" size={14} />
                <span>Review in tract explorer</span>
              </Link>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => onToggleCompare?.(selectedTract.id)}
                  className="btn sm"
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  <span>{compareSet.has(selectedTract.id) ? 'Remove compare' : 'Compare'}</span>
                </button>
                <button
                  onClick={() => onToggleFlag?.(selectedTract.id)}
                  className="btn sm"
                  style={{ flex: 1, justifyContent: 'center', color: flaggedSet.has(selectedTract.id) ? 'var(--rose)' : undefined }}
                >
                  <Icon name="flag" size={14} />
                  <span>{flaggedSet.has(selectedTract.id) ? 'Flagged' : 'Flag tract'}</span>
                </button>
              </div>

              <button
                onClick={() => onAddFinding?.(selectedTract)}
                className="btn sm"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <span>+ Add finding to assessment</span>
              </button>
            </div>
          </div>
        ) : selectedCounty ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="pill ok" style={{ fontSize: '10.5px' }}>County Jurisdiction</span>
              <button
                onClick={() => {
                  setSelectedCounty(null);
                  if (selectedState) zoomToStateFnRef.current?.(selectedState.fips);
                  else resetMapFnRef.current?.();
                }}
                className="icon-btn"
                style={{ width: '26px', height: '26px' }}
                aria-label="Back to state"
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <div>
              <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0 }}>{selectedCounty.name} County</h3>
              <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '2px' }}>
                {selectedCounty.stateName}. FIPS {selectedCounty.id}
              </div>
            </div>

            {/* Quick Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              <div style={{ padding: '8px 10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Total population</small>
                <b className="num" style={{ fontSize: '14px' }}>{selectedCounty.pop.toLocaleString()}</b>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Census tracts</small>
                <b className="num" style={{ fontSize: '14px' }}>{countyTracts.length || (selectedCounty as any).tractsCount || (selectedCounty as any).tractCount || 0}</b>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Mean SVI vulnerability</small>
                <b className="num" style={{ fontSize: '14px', color: 'var(--amber)' }}>{selectedCounty.svi.toFixed(2)}</b>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>{activeMetricMeta.short}</small>
                <b className="num" style={{ fontSize: '14px', color: 'var(--cyan)' }}>
                  {getMetricValue(selectedCounty, activeMetricKey).toFixed(1)}%
                </b>
              </div>
            </div>

            {/* Top High Need Tracts */}
            <div>
              <b style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>Highest need tracts</b>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {topCountyTracts.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedTract(t);
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      border: '1px solid var(--line)',
                      background: 'var(--surface-solid)',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{t.name}</span>
                    <span className="num" style={{ fontWeight: 700, color: 'var(--cyan)' }}>
                      {getMetricValue(t, activeMetricKey).toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ paddingTop: '8px', borderTop: '1px solid var(--line)' }}>
              <Link
                href={`/census-tracts?county=${selectedCounty.id}`}
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <span>Explore all county tracts</span>
              </Link>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <span className="pill info" style={{ fontSize: '10.5px' }}>Overview</span>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '6px 0 2px' }}>National Overview</h3>
              <p style={{ fontSize: '11.5px', color: 'var(--muted)', margin: 0 }}>
                Click any county to zoom in and inspect tract-level health disparities.
              </p>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: '12px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: '11px', color: 'var(--faint)' }}>Active Indicator</div>
              <b style={{ fontSize: '14px', color: 'var(--text)' }}>{activeMetricMeta.label || activeMetricMeta.short}</b>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                Showing quantile distribution across 3,142 US counties
              </div>
            </div>

            {/* Top National Counties */}
            <div>
              <b style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>Highest burden counties</b>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {topNationalCounties.slice(0, 6).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectCountyFnRef.current?.(c.id, true)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      border: '1px solid var(--line)',
                      background: 'var(--surface-solid)',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <span>{c.name}, {c.stateAbbr}</span>
                    <span className="num" style={{ fontWeight: 700, color: 'var(--cyan)' }}>
                      {getMetricValue(c, activeMetricKey).toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
