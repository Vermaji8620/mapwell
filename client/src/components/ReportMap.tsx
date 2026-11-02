'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { METRICS_CONFIG, MAP_LAYERS } from '@/config/metrics';
import { STATE_META } from '@/utils/countyRepository';

export interface ReportMapProps {
  countyFips: string;
  tracts: CensusTract[];
  metric?: string;
  focusTractIds?: string[];
  height?: number;
  onCountySelect?: (countyFips: string) => void;
}

let topoCache: any = null;
const dynamicTractsCache = new Map<string, CensusTract[]>();

export function ReportMap({
  countyFips,
  tracts,
  metric = 'svi',
  focusTractIds = [],
  height = 280,
  onCountySelect
}: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const switchCountyRef = useRef<((targetCid: string) => void) | null>(null);

  const [activeCountyId, setActiveCountyId] = useState<string>(countyFips);
  const [activeCountyName, setActiveCountyName] = useState<string>('');
  const [primaryCountyName, setPrimaryCountyName] = useState<string>('');

  const [legendInfo, setLegendInfo] = useState<{
    title: string;
    loText: string;
    hiText: string;
    bins: string[];
  } | null>(null);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    name: string;
    metricLabel: string;
    metricVal: string;
    isFocus: boolean;
    geoid: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    name: '',
    metricLabel: '',
    metricVal: '',
    isFocus: false,
    geoid: ''
  });

  // Sync when parent prop changes
  useEffect(() => {
    setActiveCountyId(countyFips);
    if (switchCountyRef.current) {
      switchCountyRef.current(countyFips);
    }
  }, [countyFips]);

  const focusSet = new Set(focusTractIds);

  useEffect(() => {
    let isMounted = true;

    async function renderMap() {
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

      if (!isMounted || !topoCache) return;

      const counties = (topojson.feature(topoCache, topoCache.objects.counties) as any).features;
      const initialTarget =
        counties.find((c: any) => c.id === countyFips) ||
        counties.find((c: any) => c.id === '21027') ||
        counties.find((c: any) => c.id === '53033') ||
        counties[0];

      if (!initialTarget) return;

      const statePrefix = initialTarget.id ? initialTarget.id.slice(0, 2) : '21';
      const stateAbbr = STATE_META[statePrefix]?.[0] || 'KY';
      const stateCounties = counties.filter((c: any) => c.id && c.id.slice(0, 2) === statePrefix);

      const pathGen = d3.geoPath();
      const initialName = `${initialTarget.properties?.name || 'County'} County, ${stateAbbr}`;
      setPrimaryCountyName(initialName);
      setActiveCountyName(initialName);

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none map-svg dim-others')
        .style('background', 'transparent');

      const defs = svg.append('defs');
      const clipId = `rp-clip-active-${Math.random().toString(36).substring(2, 6)}`;

      const clipPathElement = defs.append('clipPath')
        .attr('id', clipId)
        .append('path');

      const rootGroup = svg.append('g').attr('class', 'map-root');

      // Layers:
      // 1. Surrounding Ambient Counties
      const gSurround = rootGroup.append('g').attr('class', 'surrounding-counties');
      // 2. Base dark silhouette for demonstrated county
      const gTargetBase = rootGroup.append('g').attr('class', 'target-county-base');
      const baseCountyPath = gTargetBase.append('path').attr('fill', '#101B45').attr('opacity', 0.85);
      // 3. Clipped Tracts Group
      const gTracts = rootGroup.append('g').attr('class', 'tracts-group').attr('clip-path', `url(#${clipId})`);
      // 4. Glowing Cyan Boundary of Demonstrated County
      const gSel = rootGroup.append('g').attr('class', 'target-county-outline');
      const outlineCountyPath = gSel.append('path')
        .attr('fill', 'none')
        .attr('stroke', '#0284c7')
        .attr('stroke-width', 2.0)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('filter', 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.7))')
        .style('pointer-events', 'none');

      // Metric Metadata
      const meta = METRICS_CONFIG[metric] || {
        label: metric,
        short: metric,
        unit: '%',
        bad: 'high',
        format: (v: number) => `${v.toFixed(1)}%`
      };

      const formatFn = meta.format || ((v: number) => (meta.unit ? `${v.toFixed(1)}${meta.unit}` : v.toFixed(1)));
      const layerObj = MAP_LAYERS.find(l => l.metrics.includes(metric)) || MAP_LAYERS[0];
      const ramp = layerObj?.ramp || ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'];

      // Synthetic Tract Generator for any outside county
      function getOrGenerateTracts(targetCid: string, targetFeature: any): CensusTract[] {
        if (targetCid === countyFips && tracts.length > 0) {
          return tracts;
        }
        if (dynamicTractsCache.has(targetCid)) {
          return dynamicTractsCache.get(targetCid)!;
        }

        const [[bx0, by0], [bx1, by1]] = pathGen.bounds(targetFeature);
        const bw = Math.max(bx1 - bx0, 10);
        const bh = Math.max(by1 - by0, 10);
        const count = 15;

        let seed = 0;
        for (let i = 0; i < targetCid.length; i++) seed += targetCid.charCodeAt(i) * (i + 1) * 37;
        const prng = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        const generated: CensusTract[] = [];
        for (let i = 0; i < count; i++) {
          const r1 = prng();
          const r2 = prng();
          const sviVal = 0.12 + r1 * 0.82;
          const metricVal = 8.5 + r2 * 24.5;
          const tractId = `${targetCid}${String(101 + i).padStart(4, '0')}00`;
          generated.push({
            _id: tractId,
            countyFips: targetCid,
            name: `Census Tract ${101 + i}`,
            population: Math.round(2200 + prng() * 4800),
            svi: Math.round(sviVal * 100) / 100,
            tier: Math.min(4, Math.floor(sviVal * 5)),
            indicators: {
              [metric]: Math.round(metricVal * 10) / 10,
              uninsured: Math.round((6.5 + prng() * 11) * 10) / 10,
              poverty: Math.round((7.5 + prng() * 18) * 10) / 10,
              noVehicle: Math.round((7 + prng() * 16) * 10) / 10,
              diabetes: Math.round((9 + prng() * 13) * 10) / 10,
              asthma: Math.round((8 + prng() * 10) * 10) / 10,
              hypertension: Math.round((27 + prng() * 18) * 10) / 10
            }
          } as any);
        }

        dynamicTractsCache.set(targetCid, generated);
        return generated;
      }

      // Main function: Shifts demonstrating county with smooth camera zoom & tract generation
      let currentCid = countyFips;

      async function demonstrateCounty(targetCid: string, animateCamera = true) {
        currentCid = targetCid;
        setActiveCountyId(targetCid);

        const targetFeature =
          counties.find((c: any) => c.id === targetCid) ||
          initialTarget;

        const countyName = `${targetFeature.properties?.name || 'County'} County, ${stateAbbr}`;
        setActiveCountyName(countyName);

        const countyD = pathGen(targetFeature) || '';
        const [[cx0, cy0], [cx1, cy1]] = pathGen.bounds(targetFeature);
        const cWidth = Math.max(cx1 - cx0, 10);
        const cHeight = Math.max(cy1 - cy0, 10);

        // 1. Update Clip Path & Target County Outlines
        clipPathElement.attr('d', countyD);
        baseCountyPath.attr('d', countyD);
        outlineCountyPath.attr('d', countyD);

        // 2. Camera Zoom Transition
        const pad = 0.68;
        const s = Math.min(24, pad / Math.max(cWidth / 975, cHeight / 610));
        const targetTransform = d3.zoomIdentity
          .translate(975 / 2, 610 / 2)
          .scale(s)
          .translate(-(cx0 + cx1) / 2, -(cy0 + cy1) / 2);

        if (animateCamera) {
          rootGroup
            .transition('camera-zoom')
            .duration(850)
            .ease(d3.easeCubicInOut)
            .attr('transform', targetTransform.toString());
        } else {
          rootGroup.attr('transform', targetTransform.toString());
        }

        // 3. Render Ambient Surrounding Counties (all counties other than demonstrated one)
        const ambientCounties = stateCounties.filter((c: any) => c.id !== targetCid);
        const surroundSelection = gSurround.selectAll<SVGPathElement, any>('path.county-ambient')
          .data(ambientCounties, (d: any) => d.id);

        surroundSelection.exit().remove();

        const enterAmbient = surroundSelection.enter()
          .append('path')
          .attr('class', 'county-ambient')
          .attr('d', (d: any) => pathGen(d))
          .attr('fill', '#dbeafe')
          .attr('opacity', 0.42)
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 0.8)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('cursor', 'pointer')
          .style('transition', 'fill 0.2s ease, opacity 0.2s ease, stroke 0.2s ease');

        const allAmbient = enterAmbient.merge(surroundSelection as any);

        allAmbient
          .attr('d', (d: any) => pathGen(d))
          .attr('fill', '#dbeafe')
          .attr('opacity', 0.42)
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 0.8)
          .on('pointerenter', function (event, d: any) {
            d3.select(this)
              .attr('fill', 'rgba(56, 189, 248, 0.28)')
              .attr('opacity', 0.88)
              .attr('stroke', '#38BDF8')
              .attr('stroke-width', 1.6);

            const cRect = container.getBoundingClientRect();
            const hoverName = `${d.properties?.name || 'County'} County, ${stateAbbr}`;

            setTooltip({
              visible: true,
              x: event.clientX - cRect.left + 14,
              y: event.clientY - cRect.top - 14,
              name: hoverName,
              metricLabel: 'Region',
              metricVal: 'Click to demonstrate region',
              isFocus: false,
              geoid: d.id
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
          .on('pointerleave', function () {
            d3.select(this)
              .attr('fill', '#dbeafe')
              .attr('opacity', 0.42)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 0.8);

            setTooltip(prev => ({ ...prev, visible: false }));
          })
          .on('click', function (event, d: any) {
            event.stopPropagation();
            demonstrateCounty(d.id, true);
            if (onCountySelect) {
              onCountySelect(d.id);
            }
          });

        // 4. Load or Generate Census Tracts for Demonstrated Region
        let activeTracts = getOrGenerateTracts(targetCid, targetFeature);

        // Fetch server tracts asynchronously if not yet cached
        if (targetCid !== countyFips && !dynamicTractsCache.has(targetCid)) {
          fetch(`/api/tracts?county=${targetCid}`)
            .then(res => (res.ok ? res.json() : null))
            .then(json => {
              if (json && Array.isArray(json.data) && json.data.length > 0) {
                dynamicTractsCache.set(targetCid, json.data);
                if (currentCid === targetCid) {
                  renderTractCells(json.data, targetFeature, cx0, cy0, cWidth, cHeight);
                }
              }
            })
            .catch(() => {});
        }

        renderTractCells(activeTracts, targetFeature, cx0, cy0, cWidth, cHeight);
      }

      function renderTractCells(
        activeTracts: CensusTract[],
        targetFeature: any,
        cx0: number,
        cy0: number,
        cWidth: number,
        cHeight: number
      ) {
        gTracts.selectAll('*').remove();
        if (activeTracts.length === 0) return;

        const getVal = (t: CensusTract): number => {
          if (metric.startsWith('prog.')) {
            const pk = metric.replace('prog.', '');
            return (t.prog as any)?.[pk] ?? 50;
          }
          const val = (t.indicators as any)?.[metric] ?? (t as any)[metric] ?? t.svi;
          return typeof val === 'number' ? val : 0;
        };

        const vals = activeTracts.map(getVal);
        const extent = d3.extent(vals) as [number, number];
        const minVal = extent[0] ?? 0;
        const maxVal = extent[1] ?? 1;

        const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), ramp);
        const qScale = d3.scaleQuantile().domain(vals).range(d3.range(7));
        const flip = meta.bad === 'low';

        const getColor = (v: number) => {
          const bin = qScale(v);
          const t = (bin + 0.5) / 7;
          return interp(flip ? 1 - t : t);
        };

        const binColors = d3.range(7).map(i => {
          const t = (i + 0.5) / 7;
          return interp(flip ? 1 - t : t);
        });

        // Update Legend
        setLegendInfo({
          title: meta.short || meta.label,
          loText: formatFn(minVal),
          hiText: formatFn(maxVal),
          bins: binColors
        });

        // Generate Voronoi Polygons for Tracts
        const points: [number, number][] = [];
        let seed = 0;
        for (let i = 0; i < currentCid.length; i++) seed += currentCid.charCodeAt(i) * (i + 1) * 37;
        const prng = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        for (let i = 0; i < activeTracts.length; i++) {
          const r1 = prng();
          const r2 = prng();
          const px = cx0 + cWidth * (0.12 + r1 * 0.76);
          const py = cy0 + cHeight * (0.12 + r2 * 0.76);
          points.push([px, py]);
        }

        if (points.length < 3) {
          points.push([cx0 + cWidth * 0.5, cy0 + cHeight * 0.5], [cx0 + 1, cy0 + 1], [cx0 + cWidth - 1, cy0 + cHeight - 1]);
        }

        const delaunay = d3.Delaunay.from(points);
        const voronoi = delaunay.voronoi([cx0 - 20, cy0 - 20, cx0 + cWidth + 20, cy0 + cHeight + 20]);

        // Draw Tract Elements
        const paths = gTracts.selectAll<SVGPathElement, CensusTract>('path.tract-cell')
          .data(activeTracts)
          .enter()
          .append('path')
          .attr('d', (_, i) => voronoi.renderCell(i) || '')
          .attr('data-id', t => t._id)
          .attr('fill', t => getColor(getVal(t)))
          .attr('stroke', t => (focusSet.has(t._id) ? '#FFB648' : 'rgba(255, 255, 255, 0.65)'))
          .attr('stroke-width', t => (focusSet.has(t._id) ? 2.4 : 0.75))
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('class', t => `tract-cell cursor-pointer ${focusSet.has(t._id) ? 'cmp' : ''}`)
          .style('filter', t => (focusSet.has(t._id) ? 'drop-shadow(0 0 4px rgba(255, 182, 72, 0.7))' : 'none'));

        paths.filter(t => focusSet.has(t._id)).raise();

        // Staggered Entrance Fade-in & Outline Draw Sweep
        paths.attr('opacity', 0)
          .transition('tin')
          .delay((_, i) => 180 + i * 14)
          .duration(450)
          .attr('opacity', 1);

        paths.each(function () {
          const elNode = this as SVGPathElement;
          const L = elNode.getTotalLength ? elNode.getTotalLength() : 120;
          d3.select(this)
            .attr('stroke-dasharray', `${L} ${L}`)
            .attr('stroke-dashoffset', L);
        })
        .transition('tdraw')
        .delay((_, i) => 150 + i * 14)
        .duration(800)
        .ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0)
        .on('end', function () {
          d3.select(this).attr('stroke-dasharray', null);
        });

        // Hover Tooltips on Demonstrated Tracts
        paths
          .on('pointerenter', function (event, tract) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 2.2)
              .raise();

            const cRect = container.getBoundingClientRect();
            const v = getVal(tract);
            const isFocus = focusSet.has(tract._id);

            setTooltip({
              visible: true,
              x: event.clientX - cRect.left + 14,
              y: event.clientY - cRect.top - 14,
              name: tract.name || `Tract ${tract._id}`,
              metricLabel: meta.short || meta.label,
              metricVal: formatFn(v),
              isFocus,
              geoid: tract._id
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
          .on('pointerleave', function (_, tract) {
            const isFocus = focusSet.has(tract._id);
            d3.select(this)
              .attr('stroke', isFocus ? '#FFB648' : 'rgba(255, 255, 255, 0.65)')
              .attr('stroke-width', isFocus ? 2.4 : 0.75);

            if (isFocus) {
              d3.select(this).raise();
            }

            setTooltip(prev => ({ ...prev, visible: false }));
          });
      }

      switchCountyRef.current = (cid: string) => {
        demonstrateCounty(cid, true);
      };

      // Initial demonstration
      demonstrateCounty(countyFips, false);
    }

    renderMap();

    return () => {
      isMounted = false;
    };
  }, [countyFips, tracts, metric, focusTractIds, height, onCountySelect]);

  const isDemonstratingOutside = activeCountyId !== countyFips;

  const handleResetToPrimary = useCallback(() => {
    setActiveCountyId(countyFips);
    if (switchCountyRef.current) {
      switchCountyRef.current(countyFips);
    }
  }, [countyFips]);

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Active Demonstration Region Badge with Reset Button */}
      {isDemonstratingOutside && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-[#0f172a]/92 backdrop-blur-md border border-cyan-400/50 text-cyan-300 text-[11px] font-semibold shadow-xl animate-in fade-in zoom-in-95 duration-150">
          <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8] animate-pulse" />
          <span>Demonstrating: {activeCountyName}</span>
          <button
            type="button"
            onClick={handleResetToPrimary}
            className="ml-1 px-2 py-0.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 hover:text-white transition-colors text-[10.5px] border border-cyan-400/40"
            title={`Return to ${primaryCountyName}`}
          >
            Reset
          </button>
        </div>
      )}

      {/* Floating Legend Bottom-Left Matching Prototype */}
      {legendInfo && (
        <div className="absolute bottom-3 left-3 z-20 px-3.5 py-2 rounded-xl bg-[#0f172a]/90 backdrop-blur-md border border-white/10 shadow-xl text-white min-w-[170px] select-none transition-all duration-300">
          <div className="text-[12px] font-bold text-white mb-1.5 flex items-center justify-between gap-4">
            <span>{legendInfo.title}</span>
            {isDemonstratingOutside && (
              <span className="text-[9.5px] text-cyan-400 font-semibold tracking-wide uppercase">
                Exploring Region
              </span>
            )}
          </div>

          {/* 7 Color Quantile Swatches */}
          <div className="flex h-2 rounded overflow-hidden mb-1.5">
            {legendInfo.bins.map((color, idx) => (
              <div key={idx} className="flex-1" style={{ background: color }} />
            ))}
          </div>

          {/* Min, Category, Max */}
          <div className="flex items-center justify-between text-[10px] text-slate-300 font-medium font-mono">
            <span>{legendInfo.loText}</span>
            <span className="text-slate-400 font-sans text-[9.5px]">Tracts</span>
            <span>{legendInfo.hiText}</span>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-30 pointer-events-none px-3.5 py-2.5 rounded-xl bg-[#0b1329]/95 backdrop-blur-md border border-white/15 shadow-2xl text-[11.5px] text-white animate-in fade-in zoom-in-95 duration-100"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-bold text-white mb-1 flex items-center justify-between gap-3">
            <span>{tooltip.name}</span>
            {tooltip.isFocus && (
              <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                ★ Focus Area
              </span>
            )}
          </div>
          <div className="space-y-0.5 text-[11px] text-slate-300">
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">GEOID:</span>
              <span className="font-mono text-white">{tooltip.geoid}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">{tooltip.metricLabel}:</span>
              <strong className="text-cyan-400 font-mono">{tooltip.metricVal}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
