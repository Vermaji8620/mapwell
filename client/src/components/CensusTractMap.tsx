'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { TIER_COLORS, TIER_LABELS } from '@/config/metrics';
import { CountyRecord, getCountyRepository, STATE_META } from '@/utils/countyRepository';
import { useSession } from '@/context/SessionContext';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export interface CensusTractMapProps {
  countyFips: string;
  tracts: CensusTract[];
  selectedTractId?: string | null;
  compareTractIds?: string[];
  onSelectTract?: (tract: CensusTract) => void;
  onCountySelect?: (countyFips: string) => void;
  height?: number;
  showLegend?: boolean;
  theme?: 'light' | 'dark';
}

// Official Vulnerability Layer Ramp matching local prototype (line 1085: layer 'vuln')
export const VULN_RAMP = ['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E'];
export const MAP_LOW = '#101B45';

let topoCache: any = null;
const dynamicTractsCache = new Map<string, CensusTract[]>();

// Deterministic seed PRNG helpers matching prototype (demo folder/entire_website.html lines 975-977)
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

// Prototype color scale generator (lines 1094-1104) with dark navy base #0E2138 for dark mode
function createVulnColorScale(values: number[], isDark: boolean = true) {
  const lowColor = isDark ? '#0E2138' : '#F0F7FD';
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
    d3.interpolateRgb(lowColor, VULN_RAMP[0])(0.6),
    ...VULN_RAMP
  ]);
  const cleanVals = values.length > 0 ? values : [0, 0.2, 0.4, 0.6, 0.8, 1];
  const qScale = d3.scaleQuantile().domain(cleanVals).range(d3.range(7));
  const getColor = (v: number) => {
    const bin = qScale(v);
    return interp((bin + 0.5) / 7);
  };
  const bins = d3.range(7).map(i => interp((i + 0.5) / 7));
  const extent = (cleanVals.length > 0 ? d3.extent(cleanVals) : [0, 1]) as [number, number];
  return { getColor, bins, extent, qScale };
}

// Light mode surrounding counties matching Image 3: soft pastel blue palette
function createAmbientScale(values: number[], isDark: boolean = true) {
  if (isDark) {
    return createVulnColorScale(values, true);
  }
  const cleanVals = values.length > 0 ? values : [0, 0.2, 0.4, 0.6, 0.8, 1];
  const qScale = d3.scaleQuantile().domain(cleanVals).range(d3.range(5));
  const lightRamp = ['#EBF4FD', '#D7ECFC', '#C8E2FA', '#B9D7F6', '#A3CBF3'];
  const getColor = (v: number) => {
    const bin = qScale(v);
    return lightRamp[bin] || '#D7ECFC';
  };
  return { getColor };
}

// Generate Voronoi seeds strictly tested inside county SVG path via offscreen Canvas
function generateVoronoiSeeds(
  countyFeature: any,
  countyD: string,
  targetCount: number,
  countyRecord?: CountyRecord | null,
  cid?: string
): [number, number][] {
  const pathGen = d3.geoPath();
  const [[x0, y0], [x1, y1]] = pathGen.bounds(countyFeature);
  const centroid = pathGen.centroid(countyFeature);
  const width = Math.max(x1 - x0, 2);
  const height = Math.max(y1 - y0, 2);

  let ctx: CanvasRenderingContext2D | null = null;
  let path2d: Path2D | null = null;
  if (typeof document !== 'undefined' && typeof Path2D !== 'undefined') {
    const canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    try {
      path2d = new Path2D(countyD);
    } catch {
      path2d = null;
    }
  }

  const pts: [number, number][] = [];
  const seedStr = 't' + (cid || countyFeature?.id || 'seed');
  const r = rngGen(hashStr(seedStr));
  const urban = countyRecord?.urban ?? 0.65;
  const core: [number, number] = [
    x0 + width * (0.3 + r() * 0.4),
    y0 + height * (0.3 + r() * 0.4)
  ];

  let guard = 0;
  const maxGuard = Math.max(900, targetCount * 130);

  while (pts.length < targetCount && guard++ < maxGuard) {
    let x = x0 + r() * width;
    let y = y0 + r() * height;
    if (r() < urban * 0.7) {
      x = core[0] + gaussRand(r) * width * 0.16;
      y = core[1] + gaussRand(r) * height * 0.16;
    }
    if (ctx && path2d) {
      if (ctx.isPointInPath(path2d, x, y)) {
        pts.push([x, y]);
      }
    } else {
      pts.push([x, y]);
    }
  }

  // Backup grid search if random sampling didn't reach targetCount
  if (pts.length < targetCount && ctx && path2d) {
    const steps = 30;
    const dx = width / steps;
    const dy = height / steps;
    const grid: [number, number][] = [];
    for (let ix = 1; ix < steps; ix++) {
      for (let iy = 1; iy < steps; iy++) {
        const gx = x0 + ix * dx + (r() - 0.5) * dx * 0.5;
        const gy = y0 + iy * dy + (r() - 0.5) * dy * 0.5;
        if (ctx.isPointInPath(path2d, gx, gy)) {
          grid.push([gx, gy]);
        }
      }
    }
    grid.sort(() => r() - 0.5);
    for (const p of grid) {
      if (pts.length >= targetCount) break;
      pts.push(p);
    }
  }

  // Safety fallback for Delaunay (needs >= 3 points)
  if (pts.length === 0) {
    pts.push([centroid[0], centroid[1]]);
  }
  if (pts.length === 1) {
    pts.push([pts[0][0] + 0.15, pts[0][1] + 0.15]);
  }
  if (pts.length === 2) {
    pts.push([pts[0][0] - 0.15, pts[0][1] + 0.15]);
  }

  return pts.slice(0, Math.max(targetCount, 3));
}

// Synthetic tract generator matching prototype demo folder/entire_website.html lines 1113-1165
function generateSyntheticTracts(targetCid: string, countyRecord?: CountyRecord | null): CensusTract[] {
  if (dynamicTractsCache.has(targetCid)) {
    return dynamicTractsCache.get(targetCid)!;
  }

  const pop = countyRecord?.pop || 80000;
  const n = clamp(Math.round(Math.sqrt(pop) / 11), 6, 80);
  const cSvi = countyRecord?.svi ?? 0.4;
  const cPoverty = countyRecord?.indicators?.poverty ?? 12;
  const cUninsured = countyRecord?.indicators?.uninsured ?? 8;
  const cDiabetes = countyRecord?.indicators?.diabetes ?? 9;
  const cAccess = countyRecord?.indicators?.access ?? 65;

  const tracts: CensusTract[] = [];
  for (let i = 0; i < n; i++) {
    const rr = rngGen(hashStr(targetCid + ':' + i));
    const ln = () => gaussRand(rr);
    const k = ln() * 0.12;

    const tnum = 100 + i * 2 + Math.floor(rr() * 2);
    const suffix = rr() < 0.35 ? '.0' + (1 + Math.floor(rr() * 2)) : '';
    const geoid = targetCid + String(tnum).padStart(4, '0') + (suffix ? suffix.slice(1).padStart(2, '0') : '00');

    const tractSvi = clamp(cSvi + k * 1.1 + ln() * 0.05, 0.01, 0.99);
    const tier = clamp(Math.floor(tractSvi * 5), 0, 4);
    const tractPop = Math.round(clamp(2400 + rr() * 4800, 1200, 8200));

    tracts.push({
      _id: geoid,
      countyFips: targetCid,
      name: `Census Tract ${tnum}${suffix}`,
      population: tractPop,
      svi: parseFloat(tractSvi.toFixed(2)),
      tier,
      indicators: {
        poverty: parseFloat(clamp(cPoverty * (1 + k * 2.2) + ln() * 2, 1.5, 58).toFixed(1)),
        uninsured: parseFloat(clamp(cUninsured * (1 + k * 2) + ln() * 1.5, 1, 40).toFixed(1)),
        diabetes: parseFloat(clamp(cDiabetes * (1 + k * 1.2) + ln() * 0.6, 3.5, 24).toFixed(1)),
        access: Math.round(clamp(cAccess * (1 - k * 1.1) + ln() * 4, 4, 98)),
        lifeExp: parseFloat(clamp(78 - k * 9 + ln() * 0.7, 62, 88).toFixed(1))
      }
    } as any);
  }

  dynamicTractsCache.set(targetCid, tracts);
  return tracts;
}

export function CensusTractMap({
  countyFips,
  tracts,
  selectedTractId,
  compareTractIds = [],
  onSelectTract,
  onCountySelect,
  height = 300,
  showLegend = false,
  theme: customTheme
}: CensusTractMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionCtx = useSession();
  const activeTheme = customTheme || sessionCtx?.theme || 'light';
  const isDark = activeTheme === 'dark';
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  // Callbacks and refs kept across component renders
  const demonstrateCountyRef = useRef<((targetCid: string, animateCamera: boolean) => void) | null>(null);
  const updateTractsRef = useRef<((newTracts: CensusTract[]) => void) | null>(null);
  const updateSelectionRef = useRef<((selId?: string | null, cmpIds?: string[]) => void) | null>(null);
  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const resetZoomRef = useRef<(() => void) | null>(null);

  const activeCidRef = useRef<string>(countyFips);
  const [activeCountyId, setActiveCountyId] = useState<string>(countyFips);
  const [activeCountyName, setActiveCountyName] = useState<string>('');

  const [legendInfo, setLegendInfo] = useState<{
    title: string;
    loText: string;
    hiText: string;
    bins: string[];
  } | null>(null);

  // Floating rich dark tooltip state matching prototype lines 1228-1232 & 221-225
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    rows: [string, string][];
  }>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    rows: []
  });

  const positionTooltip = useCallback((e: MouseEvent | React.MouseEvent, title: string, rows: [string, string][]) => {
    const tipWidth = 230;
    const tipHeight = 120;
    let x = e.clientX + 16;
    let y = e.clientY + 14;
    if (x + tipWidth > window.innerWidth - 8) {
      x = e.clientX - tipWidth - 16;
    }
    if (y + tipHeight > window.innerHeight - 8) {
      y = e.clientY - tipHeight - 14;
    }
    setTooltip({
      visible: true,
      x,
      y,
      title,
      rows
    });
  }, []);

  const moveTooltip = useCallback((e: MouseEvent | React.MouseEvent) => {
    setTooltip(prev => {
      if (!prev.visible) return prev;
      const tipWidth = 230;
      const tipHeight = 120;
      let x = e.clientX + 16;
      let y = e.clientY + 14;
      if (x + tipWidth > window.innerWidth - 8) {
        x = e.clientX - tipWidth - 16;
      }
      if (y + tipHeight > window.innerHeight - 8) {
        y = e.clientY - tipHeight - 14;
      }
      return { ...prev, x, y };
    });
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip(prev => ({ ...prev, visible: false }));
  }, []);

  // Main Map Initializer - Runs once to create SVG canvas and persistent layers
  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';

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
      if (!isMounted || !containerRef.current || !topoCache) return;

      const countiesGeo = (topojson.feature(topoCache, topoCache.objects.counties) as any).features;
      const statesGeo = (topojson.feature(topoCache, topoCache.objects.states) as any).features;
      const pathGen = d3.geoPath();

      // Persistent SVG Canvas
      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none map-svg dim-others')
        .style('background', 'transparent');

      const defs = svg.append('defs');
      const clipId = `ct-clip-${Math.random().toString(36).substring(2, 8)}`;
      const clipPathElement = defs.append('clipPath')
        .attr('id', clipId)
        .append('path');

      const rootGroup = svg.append('g').attr('class', 'map-root');

      // Layer 1: Ambient neighboring counties (.dim-others .county)
      const gSurround = rootGroup.append('g').attr('class', 'surrounding-counties');

      // Layer 2: State boundary & coastline (.nation-b)
      const gStateBorder = rootGroup.append('g').attr('class', 'state-boundary-layer');
      const stateBorderPath = gStateBorder.append('path')
        .attr('class', 'nation-b')
        .attr('fill', 'none')
        .attr('stroke', '#9CC9EE')
        .attr('stroke-opacity', 0.95)
        .attr('stroke-width', 1.2)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('pointer-events', 'none');

      // Layer 3: Base silhouette of demonstrated active county
      const gTargetBase = rootGroup.append('g').attr('class', 'target-county-base');
      const baseCountyPath = gTargetBase.append('path')
        .attr('fill', isDarkRef.current ? '#101B45' : '#D7ECFC')
        .attr('opacity', 0.95);

      // Layer 4: Clipped Census Tracts Group
      const gTracts = rootGroup.append('g')
        .attr('class', 'tracts-group')
        .attr('clip-path', `url(#${clipId})`);

      // Layer 5: Selected Tract Overlay Outline (clipped to active county)
      const gTractHighlight = rootGroup.append('g')
        .attr('class', 'tract-highlight-layer')
        .attr('clip-path', `url(#${clipId})`)
        .style('pointer-events', 'none');

      // Layer 6: Active county contour border (.sel-outline with stroke #102A4C)
      const gSel = rootGroup.append('g').attr('class', 'target-county-outline');
      const outlineCountyPath = gSel.append('path')
        .attr('class', 'sel-outline')
        .attr('fill', 'none')
        .attr('stroke', '#102A4C')
        .attr('stroke-width', 1.8)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('filter', 'none')
        .style('pointer-events', 'none');

      // Zoom configuration
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 40])
        .on('zoom', (event) => {
          rootGroup.attr('transform', event.transform);
        });

      svg.call(zoom).on('dblclick.zoom', null);

      zoomInRef.current = () => {
        svg.transition().duration(350).call(zoom.scaleBy, 1.4);
      };

      zoomOutRef.current = () => {
        svg.transition().duration(350).call(zoom.scaleBy, 1 / 1.4);
      };

      let currentTractCells: { tract: CensusTract; d: string }[] = [];
      let currentCountyFeature: any = null;
      let currentCountyD = '';
      let currentCid = countyFips;

      // Update tract selection & comparison highlights
      function updateTractHighlights(selId?: string | null, cmpIds: string[] = []) {
        const cmpSet = new Set(cmpIds);
        gTracts.selectAll<SVGPathElement, CensusTract>('path.tract')
          .classed('sel', t => {
            const id = t._id || (t as any).id;
            return id === selId;
          })
          .classed('cmp', t => {
            const id = t._id || (t as any).id;
            return cmpSet.has(id);
          })
          .attr('stroke', t => {
            const id = t._id || (t as any).id;
            if (id === selId) return '#102A4C';
            if (cmpSet.has(id)) return '#F2B33D';
            return 'rgba(255, 255, 255, 0.55)';
          })
          .attr('stroke-width', t => {
            const id = t._id || (t as any).id;
            if (id === selId) return 2.2;
            if (cmpSet.has(id)) return 2.0;
            return 0.7;
          });

        gTractHighlight.selectAll('*').remove();
        if (selId) {
          gTracts.selectAll<SVGPathElement, CensusTract>('path.tract')
            .filter(t => (t._id || (t as any).id) === selId)
            .raise();

          const found = currentTractCells.find(c => (c.tract._id || (c.tract as any).id) === selId);
          if (found) {
            gTractHighlight.append('path')
              .attr('d', found.d)
              .attr('fill', 'none')
              .attr('stroke', '#102A4C')
              .attr('stroke-width', 2.2)
              .attr('vector-effect', 'non-scaling-stroke')
              .style('pointer-events', 'none')
              .style('filter', 'none');
          }
        }
      }
      updateSelectionRef.current = updateTractHighlights;

      // Render tracts into gTracts using Voronoi and clipPath
      function renderTracts(activeTracts: CensusTract[], targetFeature: any, targetD: string, cid: string) {
        gTracts.selectAll('*').remove();
        if (activeTracts.length === 0) return;

        const countyRecord = repo.countyById.get(cid);
        const [[cx0, cy0], [cx1, cy1]] = pathGen.bounds(targetFeature);

        // Quantile color scale for vulnerability
        const sviVals = activeTracts.map(t => t.svi ?? 0);
        const tractScale = createVulnColorScale(sviVals, isDarkRef.current);

        setLegendInfo({
          title: 'Tract vulnerability',
          loText: tractScale.extent[0].toFixed(2),
          hiText: tractScale.extent[1].toFixed(2),
          bins: tractScale.bins
        });

        // Generate seeds tested strictly inside county boundary
        const pts = generateVoronoiSeeds(targetFeature, targetD, activeTracts.length, countyRecord, cid);
        const voronoi = d3.Delaunay.from(pts).voronoi([cx0 - 8, cy0 - 8, cx1 + 8, cy1 + 8]);

        currentTractCells = activeTracts.map((tract, i) => ({
          tract,
          d: voronoi.renderCell(i) || ''
        }));

        const cmpSet = new Set(compareTractIds);

        const paths = gTracts.selectAll<SVGPathElement, CensusTract>('path.tract')
          .data(activeTracts)
          .enter()
          .append('path')
          .attr('class', t => {
            const id = t._id || (t as any).id;
            return `tract ${id === selectedTractId ? 'sel' : ''} ${cmpSet.has(id) ? 'cmp' : ''}`;
          })
          .attr('d', (_, i) => currentTractCells[i]?.d || '')
          .attr('fill', t => tractScale.getColor(t.svi ?? 0))
          .attr('stroke', t => {
            const id = t._id || (t as any).id;
            if (id === selectedTractId) return '#102A4C';
            if (cmpSet.has(id)) return '#F2B33D';
            return 'rgba(255, 255, 255, 0.55)';
          })
          .attr('stroke-width', t => {
            const id = t._id || (t as any).id;
            if (id === selectedTractId) return 2.2;
            if (cmpSet.has(id)) return 2.0;
            return 0.7;
          })
          .attr('vector-effect', 'non-scaling-stroke');

        // Entrance boundary draw / sweep animation matching prototype
        paths.attr('opacity', 0)
          .transition('tin')
          .delay((_, i) => 100 + i * 10)
          .duration(380)
          .attr('opacity', 1);

        paths
          .on('pointerenter', function (event, tract) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 1.6)
              .raise();

            const geoid = tract._id || (tract as any).id || '';
            const sviVal = (tract.svi ?? 0).toFixed(2);
            const tierIdx = tract.tier ?? Math.min(4, Math.floor((tract.svi ?? 0) * 5));
            const tierName = TIER_LABELS[tierIdx] || 'Moderate';
            const popVal = Number(tract.population || (tract as any).pop || 0).toLocaleString();

            positionTooltip(event, tract.name || `Census Tract ${geoid}`, [
              ['GEOID', geoid],
              ['Vulnerability', sviVal],
              ['Vulnerability tier', tierName],
              ['Population', popVal]
            ]);
          })
          .on('pointermove', function (event) {
            moveTooltip(event);
          })
          .on('pointerleave', function () {
            d3.select(this)
              .attr('stroke', (t: any) => {
                const id = t._id || t.id;
                if (id === selectedTractId) return '#102A4C';
                if (cmpSet.has(id)) return '#F2B33D';
                return 'rgba(255, 255, 255, 0.55)';
              })
              .attr('stroke-width', (t: any) => {
                const id = t._id || t.id;
                if (id === selectedTractId) return 2.2;
                if (cmpSet.has(id)) return 2.0;
                return 0.7;
              });

            hideTooltip();
          })
          .on('click', function (event, tract) {
            event.stopPropagation();
            hideTooltip();
            d3.select(this).raise();
            updateTractHighlights(tract._id || (tract as any).id, compareTractIds);
            if (onSelectTract) {
              onSelectTract(tract);
            }
          });

        updateTractHighlights(selectedTractId, compareTractIds);
      }
      updateTractsRef.current = (newTracts: CensusTract[]) => {
        if (currentCountyFeature && currentCountyD) {
          renderTracts(newTracts, currentCountyFeature, currentCountyD, currentCid);
        }
      };

      // Demonstrate County: Direct Camera Glide (850ms, d3.easeCubicInOut) without destroying canvas
      function demonstrateCounty(targetCid: string, animateCamera = true) {
        currentCid = targetCid;
        activeCidRef.current = targetCid;
        setActiveCountyId(targetCid);

        const targetFeature =
          countiesGeo.find((c: any) => c.id === targetCid) ||
          countiesGeo.find((c: any) => c.id === '53033') ||
          countiesGeo[0];

        if (!targetFeature) return;

        currentCountyFeature = targetFeature;
        const targetD = pathGen(targetFeature) || '';
        currentCountyD = targetD;

        const statePrefix = targetFeature.id ? targetFeature.id.slice(0, 2) : '53';
        const stateMeta = STATE_META[statePrefix] || ['WA', 'Washington', 'West'];
        const stateAbbr = stateMeta[0];
        const stateName = stateMeta[1];

        const countyRecord = repo.countyById.get(targetCid);
        const displayName = countyRecord
          ? `${countyRecord.name} ${statePrefix === '22' ? 'Parish' : statePrefix === '02' ? 'Borough' : 'County'}, ${stateAbbr}`
          : `${targetFeature.properties?.name || 'County'} County, ${stateAbbr}`;

        setActiveCountyName(displayName);

        // 1. Update Clip Path & Target County Outlines
        clipPathElement.attr('d', targetD);
        baseCountyPath
          .attr('d', targetD)
          .attr('fill', isDarkRef.current ? '#101B45' : '#D7ECFC');
        outlineCountyPath.attr('d', targetD);

        // 2. State Outer Boundary Line (.nation-b) tracing coastline
        const stateFeature = statesGeo.find((s: any) => s.id === statePrefix);
        const stateD = stateFeature ? pathGen(stateFeature) || '' : '';
        stateBorderPath.attr('d', stateD);

        // 3. Camera Glide Transition with Zoom Padding 0.78
        const [[cx0, cy0], [cx1, cy1]] = pathGen.bounds(targetFeature);
        const cWidth = Math.max(cx1 - cx0, 10);
        const cHeight = Math.max(cy1 - cy0, 10);
        const pad = 0.78;
        const s = Math.min(36, pad / Math.max(cWidth / 975, cHeight / 610));
        const targetTransform = d3.zoomIdentity
          .translate(975 / 2, 610 / 2)
          .scale(s)
          .translate(-(cx0 + cx1) / 2, -(cy0 + cy1) / 2);

        resetZoomRef.current = () => {
          svg.transition('camera-reset')
            .duration(650)
            .ease(d3.easeCubicInOut)
            .call(zoom.transform, targetTransform);
        };

        if (animateCamera) {
          svg.transition('camera-glide')
            .duration(850)
            .ease(d3.easeCubicInOut)
            .call(zoom.transform, targetTransform);
        } else {
          svg.call(zoom.transform, targetTransform);
        }

        // 4. Colorize Surrounding Ambient Counties by active SVI metric
        const stateCounties = repo.countiesByState.get(statePrefix) || [];
        const stateSvis = stateCounties.map(c => c.svi || c.indicators?.svi || 0);
        const isDark = isDarkRef.current;
        const countyScale = createVulnColorScale(stateSvis, isDark);
        const ambientScale = createAmbientScale(stateSvis, isDark);

        const ambientCounties = stateCounties.filter(c => c.id !== targetCid);
        const surroundSelection = gSurround.selectAll<SVGPathElement, CountyRecord>('path.county')
          .data(ambientCounties, d => d.id);

        surroundSelection.exit().remove();

        const enterAmbient = surroundSelection.enter()
          .append('path')
          .attr('class', 'county county-ambient')
          .attr('vector-effect', 'non-scaling-stroke')
          .style('cursor', 'pointer');

        const allAmbient = enterAmbient.merge(surroundSelection);

        allAmbient
          .attr('d', d => pathGen(d.feature) || '')
          .attr('fill', d => isDark ? countyScale.getColor(d.svi || d.indicators?.svi || 0) : ambientScale.getColor(d.svi || d.indicators?.svi || 0))
          .attr('fill-opacity', isDark ? 0.28 : 0.95)
          .attr('stroke', isDark ? 'rgba(141, 170, 200, 0.45)' : '#ffffff')
          .attr('stroke-width', isDark ? 0.75 : 0.8)
          .attr('vector-effect', 'non-scaling-stroke')
          .on('pointerenter', function (event, d) {
            d3.select(this)
              .attr('fill-opacity', isDark ? 0.75 : 1)
              .attr('stroke', isDark ? '#ffffff' : '#2584EB')
              .attr('stroke-width', 1.6)
              .raise();

            const cName = `${d.name} ${d.st === '22' ? 'Parish' : d.st === '02' ? 'Borough' : 'County'}, ${d.stateAbbr}`;
            positionTooltip(event, cName, [
              ['GEOID', d.id],
              ['Vulnerability', (d.svi || d.indicators?.svi || 0).toFixed(2)],
              ['Population', Number(d.pop || 0).toLocaleString()],
              ['Action', 'Click to switch county']
            ]);
          })
          .on('pointermove', function (event) {
            moveTooltip(event);
          })
          .on('pointerleave', function () {
            d3.select(this)
              .attr('fill-opacity', isDark ? 0.28 : 0.95)
              .attr('stroke', isDark ? 'rgba(141, 170, 200, 0.45)' : '#ffffff')
              .attr('stroke-width', isDark ? 0.75 : 0.8);
            hideTooltip();
          })
          .on('click', function (event, d) {
            event.stopPropagation();
            hideTooltip();
            demonstrateCounty(d.id, true);
            if (onCountySelect) {
              onCountySelect(d.id);
            }
          });

        // 5. Load or Generate Census Tracts for Demonstrated Region
        let activeTracts: CensusTract[] = [];
        if (targetCid === countyFips && tracts.length > 0) {
          activeTracts = tracts;
        } else {
          activeTracts = generateSyntheticTracts(targetCid, countyRecord);
        }

        renderTracts(activeTracts, targetFeature, targetD, targetCid);
      }
      demonstrateCountyRef.current = demonstrateCounty;

      // Initial demonstration
      demonstrateCounty(countyFips, false);
    }

    initMap();

    return () => {
      isMounted = false;
    };
  }, []); // Initialize canvas and layers once

  // React to county changes: smooth direct camera glide without recreating canvas
  useEffect(() => {
    if (countyFips && countyFips !== activeCidRef.current && demonstrateCountyRef.current) {
      demonstrateCountyRef.current(countyFips, true);
    }
  }, [countyFips]);

  // React to theme changes (light/dark switch)
  useEffect(() => {
    if (demonstrateCountyRef.current) {
      demonstrateCountyRef.current(activeCidRef.current, false);
    }
  }, [isDark]);

  // React to tracts prop update for current county
  useEffect(() => {
    if (tracts && tracts.length > 0 && updateTractsRef.current && countyFips === activeCidRef.current) {
      updateTractsRef.current(tracts);
    }
  }, [tracts, countyFips]);

  // React to selectedTractId or compareTractIds prop changes
  useEffect(() => {
    if (updateSelectionRef.current) {
      updateSelectionRef.current(selectedTractId, compareTractIds);
    }
  }, [selectedTractId, compareTractIds]);

  return (
    <div
      className={`census-tract-map-wrapper relative w-full h-full overflow-hidden select-none ${isDark ? 'dark' : 'light'}`}
      style={{
        minHeight: `${height}px`,
        background: isDark
          ? 'radial-gradient(ellipse at 50% 40%, rgba(55, 217, 245, 0.08), transparent 70%), #07111F'
          : '#F3F9FE'
      }}
    >
      {/* Scoped styles strictly enforcing target prototype rules */}
      <style jsx global>{`
        .census-tract-map-wrapper .map-svg {
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
        }
        .census-tract-map-wrapper.dark .map-svg .county {
          stroke: rgba(141, 170, 200, 0.45) !important;
          stroke-width: 0.75px !important;
          vector-effect: non-scaling-stroke;
          transition: fill-opacity 0.2s ease, stroke 0.2s ease;
        }
        .census-tract-map-wrapper.dark .map-svg .county:hover {
          stroke: #ffffff !important;
          stroke-width: 1.6px !important;
          fill-opacity: 0.75 !important;
        }
        .census-tract-map-wrapper.dark .map-svg.dim-others .county:not(.sel) {
          fill-opacity: 0.28 !important;
        }
        .census-tract-map-wrapper.light .map-svg .county {
          stroke: #ffffff !important;
          stroke-width: 0.8px !important;
          vector-effect: non-scaling-stroke;
          transition: fill-opacity 0.2s ease, stroke 0.2s ease;
        }
        .census-tract-map-wrapper.light .map-svg .county:hover {
          stroke: #2584EB !important;
          stroke-width: 1.6px !important;
          fill-opacity: 1 !important;
        }
        .census-tract-map-wrapper.light .map-svg.dim-others .county:not(.sel) {
          fill-opacity: 0.95 !important;
        }
        .census-tract-map-wrapper .map-svg .county.sel {
          stroke: #102A4C !important;
          stroke-width: 1.8px !important;
        }
        .census-tract-map-wrapper .map-svg .nation-b {
          fill: none;
          stroke: #9CC9EE !important;
          stroke-opacity: 0.95 !important;
          stroke-width: 1.2px !important;
          vector-effect: non-scaling-stroke;
          pointer-events: none;
        }
        .census-tract-map-wrapper .map-svg .sel-outline {
          fill: none;
          stroke: #102A4C !important;
          stroke-width: 1.8px !important;
          vector-effect: non-scaling-stroke;
          filter: none !important;
          pointer-events: none;
        }
        .census-tract-map-wrapper .map-svg .tract {
          stroke: rgba(255, 255, 255, 0.55);
          stroke-width: 0.7px;
          vector-effect: non-scaling-stroke;
          cursor: pointer;
          transition: stroke 0.15s ease;
        }
        .census-tract-map-wrapper .map-svg .tract:hover {
          stroke: #ffffff !important;
          stroke-width: 1.6px !important;
        }
        .census-tract-map-wrapper .map-svg .tract.sel {
          stroke: #102A4C !important;
          stroke-width: 2.2px !important;
        }
        .census-tract-map-wrapper .map-svg .tract.cmp {
          stroke: #F2B33D !important;
          stroke-width: 2px !important;
        }
      `}</style>

      {/* SVG Map Container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating Zoom & Pan HUD Controls (Top Right) */}
      <div
        className="absolute top-3 right-3 z-20 flex flex-col gap-1 p-1"
        style={
          isDark
            ? {
                background: 'rgba(11, 28, 50, 0.92)',
                border: '1px solid rgba(141, 170, 200, 0.25)',
                borderRadius: '12px',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 12px 30px -10px rgba(0,0,0,0.5)'
              }
            : {
                background: 'rgba(255, 255, 255, 0.92)',
                border: '1px solid #DCEAF5',
                borderRadius: '12px',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                boxShadow: '0 10px 30px -18px rgba(37,100,180,.35)'
              }
        }
      >
        <button
          onClick={() => zoomInRef.current?.()}
          aria-label="Zoom in"
          title="Zoom In"
          className={
            isDark
              ? 'w-7 h-7 rounded-lg flex items-center justify-center text-[rgba(141,170,200,0.9)] hover:text-white hover:bg-white/10 transition-colors'
              : 'w-7 h-7 rounded-lg flex items-center justify-center text-[#56628A] hover:text-[#102A4C] hover:bg-[#F0F7FD] transition-colors'
          }
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => zoomOutRef.current?.()}
          aria-label="Zoom out"
          title="Zoom Out"
          className={
            isDark
              ? 'w-7 h-7 rounded-lg flex items-center justify-center text-[rgba(141,170,200,0.9)] hover:text-white hover:bg-white/10 transition-colors'
              : 'w-7 h-7 rounded-lg flex items-center justify-center text-[#56628A] hover:text-[#102A4C] hover:bg-[#F0F7FD] transition-colors'
          }
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => resetZoomRef.current?.()}
          aria-label="Reset zoom"
          title="Reset to Full County"
          className={
            isDark
              ? 'w-7 h-7 rounded-lg flex items-center justify-center text-[rgba(141,170,200,0.9)] hover:text-white hover:bg-white/10 transition-colors'
              : 'w-7 h-7 rounded-lg flex items-center justify-center text-[#56628A] hover:text-[#102A4C] hover:bg-[#F0F7FD] transition-colors'
          }
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Optional In-Map Floating Legend (Bottom Left matching prototype line 2084) */}
      {showLegend && legendInfo && (
        <div
          className="map-float legend pointer-events-none absolute left-3 bottom-3 z-20 px-3 py-2 text-[10.5px] min-w-[175px]"
          style={
            isDark
              ? {
                  background: 'rgba(11, 28, 50, 0.92)',
                  border: '1px solid rgba(141, 170, 200, 0.25)',
                  borderRadius: '12px',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  boxShadow: '0 12px 30px -10px rgba(0,0,0,0.5)'
                }
              : {
                  background: 'rgba(255, 255, 255, 0.92)',
                  border: '1px solid #DCEAF5',
                  borderRadius: '12px',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  boxShadow: '0 10px 30px -18px rgba(37,100,180,.35)'
                }
          }
        >
          <div className={`flex justify-between items-center font-bold mb-1.5 text-[11px] ${isDark ? 'text-white' : 'text-[#0B1438]'}`}>
            <span>{legendInfo.title}</span>
          </div>
          <div className="flex h-2 rounded overflow-hidden mb-1">
            {legendInfo.bins.map((c, i) => (
              <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className={`flex justify-between items-center text-[10px] font-mono ${isDark ? 'text-[rgba(141,170,200,0.85)]' : 'text-[#56628A]'}`}>
            <span>{legendInfo.loText}</span>
            <span className="font-sans text-[9px] uppercase tracking-wider text-[rgba(141,170,200,0.6)]">Tiers</span>
            <span>{legendInfo.hiText}</span>
          </div>
        </div>
      )}

      {/* Rich Floating Tooltip Card matching prototype lines 221-225 & 1228-1232 */}
      {tooltip.visible && (
        <div
          className="pointer-events-none fixed z-50 text-left transition-opacity duration-100 ease-out"
          style={
            isDark
              ? {
                  left: `${tooltip.x}px`,
                  top: `${tooltip.y}px`,
                  minWidth: '200px',
                  maxWidth: '280px',
                  background: 'rgba(11, 28, 50, 0.95)',
                  border: '1px solid rgba(141, 170, 200, 0.25)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '12.5px',
                  boxShadow: '0 18px 50px -20px rgba(0, 0, 0, 0.6)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)'
                }
              : {
                  left: `${tooltip.x}px`,
                  top: `${tooltip.y}px`,
                  minWidth: '200px',
                  maxWidth: '280px',
                  background: '#ffffff',
                  border: '1px solid #DCEAF5',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '12.5px',
                  boxShadow: '0 10px 30px -18px rgba(37,100,180,.35)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)'
                }
          }
        >
          <b
            style={{
              display: 'block',
              fontSize: '13.5px',
              fontWeight: 600,
              color: isDark ? '#ffffff' : '#0B1438',
              marginBottom: '5px'
            }}
          >
            {tooltip.title}
          </b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {tooltip.rows.map(([label, val], idx) => (
              <div
                key={idx}
                className="tv"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '14px',
                  color: isDark ? 'rgba(141, 170, 200, 0.85)' : '#56628A',
                  fontSize: '12px'
                }}
              >
                <span>{label}</span>
                <span style={{ color: isDark ? '#ffffff' : '#0B1438', fontWeight: 700 }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
