'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { TIER_COLORS, TIER_LABELS } from '@/config/metrics';
import { STATE_META } from '@/utils/countyRepository';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export interface CensusTractMapProps {
  countyFips: string;
  tracts: CensusTract[];
  selectedTractId?: string | null;
  compareTractIds?: string[];
  onSelectTract?: (tract: CensusTract) => void;
  onCountySelect?: (countyFips: string) => void;
  height?: number;
}

// Official Vulnerability Layer Ramp matching local prototype (line 1085: layer 'vuln')
export const VULN_RAMP = ['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E'];
export const MAP_LOW = '#101B45';

let topoCache: any = null;
const dynamicTractsCache = new Map<string, CensusTract[]>();

export function CensusTractMap({
  countyFips,
  tracts,
  selectedTractId,
  compareTractIds = [],
  onSelectTract,
  onCountySelect,
  height = 290
}: CensusTractMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const switchCountyRef = useRef<((targetCid: string) => void) | null>(null);
  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const resetZoomRef = useRef<(() => void) | null>(null);

  const [activeCountyId, setActiveCountyId] = useState<string>(countyFips);
  const [activeCountyName, setActiveCountyName] = useState<string>('');

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
    title: string;
    subtitle: string;
    metricLabel: string;
    metricVal: string;
    tier?: string;
    tierColor?: string;
    pop?: string;
    isNeighbour?: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    subtitle: '',
    metricLabel: '',
    metricVal: '',
    isNeighbour: false
  });

  const compareSet = new Set(compareTractIds);

  // Sync prop changes
  useEffect(() => {
    setActiveCountyId(countyFips);
    if (switchCountyRef.current) {
      switchCountyRef.current(countyFips);
    }
  }, [countyFips]);

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
        counties.find((c: any) => c.id === '53033') ||
        counties.find((c: any) => c.id === '21027') ||
        counties[0];

      if (!initialTarget) return;

      const statePrefix = initialTarget.id ? initialTarget.id.slice(0, 2) : '53';
      const stateAbbr = STATE_META[statePrefix]?.[0] || 'WA';
      const stateCounties = counties.filter((c: any) => c.id && c.id.slice(0, 2) === statePrefix);

      const pathGen = d3.geoPath();
      const initialName = `${initialTarget.properties?.name || 'County'} County, ${stateAbbr}`;
      setActiveCountyName(initialName);

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none map-svg dim-others')
        .style('background', 'transparent');

      const defs = svg.append('defs');
      const clipId = `ct-clip-active-${Math.random().toString(36).substring(2, 6)}`;

      const clipPathElement = defs.append('clipPath')
        .attr('id', clipId)
        .append('path');

      const rootGroup = svg.append('g').attr('class', 'map-root');

      // Layers:
      // 1. Surrounding Ambient Neighbour Counties
      const gSurround = rootGroup.append('g').attr('class', 'surrounding-counties');
      // 2. Base dark silhouette for demonstrated county
      const gTargetBase = rootGroup.append('g').attr('class', 'target-county-base');
      const baseCountyPath = gTargetBase.append('path').attr('fill', '#101B45').attr('opacity', 0.88);
      // 3. Clipped Tracts Group
      const gTracts = rootGroup.append('g').attr('class', 'tracts-group').attr('clip-path', `url(#${clipId})`);
      // 4. Glowing Cyan Boundary of Demonstrated County
      const gSel = rootGroup.append('g').attr('class', 'target-county-outline');
      const outlineCountyPath = gSel.append('path')
        .attr('fill', 'none')
        .attr('stroke', 'var(--cyan, #37C8CF)')
        .attr('stroke-width', 2.2)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('filter', 'drop-shadow(0 0 8px rgba(55, 200, 207, 0.7))')
        .style('pointer-events', 'none');

      // Active selected tract outline layer
      const gTractHighlight = rootGroup.append('g').attr('class', 'tract-highlight-layer').style('pointer-events', 'none');

      // Zoom behavior
      let currentTransform = d3.zoomIdentity;
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 35])
        .on('zoom', (event) => {
          rootGroup.attr('transform', event.transform);
          currentTransform = event.transform;
        });

      svg.call(zoom).on('dblclick.zoom', null);

      zoomInRef.current = () => {
        svg.transition().duration(350).call(zoom.scaleBy, 1.4);
      };

      zoomOutRef.current = () => {
        svg.transition().duration(350).call(zoom.scaleBy, 1 / 1.4);
      };

      // Synthetic Tract Generator for any outside clicked county
      function getOrGenerateTracts(targetCid: string, targetFeature: any): CensusTract[] {
        if (targetCid === countyFips && tracts.length > 0) {
          return tracts;
        }
        if (dynamicTractsCache.has(targetCid)) {
          return dynamicTractsCache.get(targetCid)!;
        }

        const count = 18;
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
          const sviVal = 0.12 + r1 * 0.84;
          const tractId = `${targetCid}${String(101 + i).padStart(4, '0')}00`;
          generated.push({
            _id: tractId,
            countyFips: targetCid,
            name: `Census Tract ${101 + i}`,
            population: Math.round(2400 + prng() * 4600),
            svi: Math.round(sviVal * 100) / 100,
            tier: Math.min(4, Math.floor(sviVal * 5)),
            indicators: {
              poverty: Math.round((7.5 + r2 * 18) * 10) / 10,
              uninsured: Math.round((6.5 + prng() * 11) * 10) / 10,
              diabetes: Math.round((9 + prng() * 13) * 10) / 10,
              access: Math.round(45 + prng() * 45),
              lifeExp: Math.round((74 + prng() * 10) * 10) / 10
            }
          } as any);
        }

        dynamicTractsCache.set(targetCid, generated);
        return generated;
      }

      let currentCid = countyFips;
      let tractVoronoiCells: { tract: CensusTract; d: string }[] = [];

      function updateTractHighlight() {
        gTractHighlight.selectAll('*').remove();
        if (!selectedTractId) return;

        const found = tractVoronoiCells.find(c => c.tract._id === selectedTractId);
        if (found) {
          gTractHighlight.append('path')
            .attr('d', found.d)
            .attr('fill', 'none')
            .attr('stroke', 'var(--cyan, #37C8CF)')
            .attr('stroke-width', 2.8)
            .attr('vector-effect', 'non-scaling-stroke')
            .style('filter', 'drop-shadow(0 0 6px var(--cyan, #37C8CF))');
        }
      }

      // Shifts demonstrating county with smooth camera zoom & tract generation
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
        const pad = 0.72;
        const s = Math.min(26, pad / Math.max(cWidth / 975, cHeight / 610));
        const targetTransform = d3.zoomIdentity
          .translate(975 / 2, 610 / 2)
          .scale(s)
          .translate(-(cx0 + cx1) / 2, -(cy0 + cy1) / 2);

        resetZoomRef.current = () => {
          svg.transition().duration(650).ease(d3.easeCubicInOut).call(zoom.transform, targetTransform);
        };

        if (animateCamera) {
          svg.transition('camera-zoom')
            .duration(850)
            .ease(d3.easeCubicInOut)
            .call(zoom.transform, targetTransform);
        } else {
          svg.call(zoom.transform, targetTransform);
        }

        // 3. Render Ambient Neighbour Counties
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
              title: hoverName,
              subtitle: 'Neighbour Region',
              metricLabel: 'Action',
              metricVal: 'Click to demonstrate region',
              isNeighbour: true
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

        // Color scale: SVI quantile scale with prototype vuln ramp & dark baseline
        const sviVals = activeTracts.map(t => t.svi || 0);
        const extent = d3.extent(sviVals) as [number, number];
        const minVal = extent[0] ?? 0;
        const maxVal = extent[1] ?? 1;

        const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
          d3.interpolateRgb(MAP_LOW, VULN_RAMP[0])(0.6),
          ...VULN_RAMP
        ]);
        const qScale = d3.scaleQuantile().domain(sviVals).range(d3.range(7));

        const getColor = (v: number) => {
          const bin = qScale(v);
          const t = (bin + 0.5) / 7;
          return interp(t);
        };

        const binColors = d3.range(7).map(i => interp((i + 0.5) / 7));

        setLegendInfo({
          title: 'Tract vulnerability',
          loText: minVal.toFixed(2),
          hiText: maxVal.toFixed(2),
          bins: binColors
        });

        // Voronoi Cell Generation
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

        tractVoronoiCells = activeTracts.map((tract, i) => ({
          tract,
          d: voronoi.renderCell(i) || ''
        }));

        // Render Tract Polygons
        const paths = gTracts.selectAll<SVGPathElement, CensusTract>('path.tract-cell')
          .data(activeTracts)
          .enter()
          .append('path')
          .attr('d', (_, i) => voronoi.renderCell(i) || '')
          .attr('data-id', t => t._id)
          .attr('fill', t => getColor(t.svi || 0))
          .attr('stroke', t => {
            if (t._id === selectedTractId) return 'var(--cyan, #37C8CF)';
            if (compareSet.has(t._id)) return '#FFB648';
            return 'rgba(255, 255, 255, 0.45)';
          })
          .attr('stroke-width', t => (t._id === selectedTractId ? 2.5 : compareSet.has(t._id) ? 2.0 : 0.8))
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('class', t => `tract-cell cursor-pointer transition-colors duration-150 hover:brightness-125 ${compareSet.has(t._id) ? 'cmp' : ''}`)
          .classed('sel', t => t._id === selectedTractId);

        // Animate entrance
        paths.attr('opacity', 0)
          .transition('tin')
          .delay((_, i) => 120 + i * 12)
          .duration(380)
          .attr('opacity', 1);

        paths
          .on('pointerenter', function (event, tract) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 2.0)
              .raise();

            const cRect = container.getBoundingClientRect();
            setTooltip({
              visible: true,
              x: event.clientX - cRect.left + 14,
              y: event.clientY - cRect.top - 14,
              title: tract.name || `Tract ${tract._id}`,
              subtitle: `GEOID ${tract._id}`,
              metricLabel: 'SVI Vulnerability',
              metricVal: tract.svi.toFixed(2),
              tier: TIER_LABELS[tract.tier],
              tierColor: TIER_COLORS[tract.tier],
              pop: `${(tract.population || 0).toLocaleString()} residents`,
              isNeighbour: false
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
            d3.select(this)
              .attr('stroke', (t: any) => {
                if (t._id === selectedTractId) return 'var(--cyan, #37C8CF)';
                if (compareSet.has(t._id)) return '#FFB648';
                return 'rgba(255, 255, 255, 0.45)';
              })
              .attr('stroke-width', (t: any) => (t._id === selectedTractId ? 2.5 : compareSet.has(t._id) ? 2.0 : 0.8));

            setTooltip(prev => ({ ...prev, visible: false }));
          })
          .on('click', function (event, tract) {
            event.stopPropagation();
            paths.classed('sel', (t: any) => t._id === tract._id)
              .attr('stroke', (t: any) => (t._id === tract._id ? 'var(--cyan, #37C8CF)' : compareSet.has(t._id) ? '#FFB648' : 'rgba(255, 255, 255, 0.45)'))
              .attr('stroke-width', (t: any) => (t._id === tract._id ? 2.5 : compareSet.has(t._id) ? 2.0 : 0.8));

            updateTractHighlight();

            if (onSelectTract) {
              onSelectTract(tract);
            }
          });

        updateTractHighlight();
      }

      switchCountyRef.current = (cid: string) => {
        if (cid !== currentCid) {
          demonstrateCounty(cid, true);
        }
      };

      // Initial demonstration
      demonstrateCounty(countyFips, false);
    }

    renderMap();

    return () => {
      isMounted = false;
    };
  }, [countyFips, tracts, height]);

  // Update selection highlight when selectedTractId prop changes
  useEffect(() => {
    if (!containerRef.current) return;
    const svg = d3.select(containerRef.current).select('svg');
    if (svg.empty()) return;

    svg.selectAll<SVGPathElement, CensusTract>('path.tract-cell')
      .classed('sel', t => t._id === selectedTractId)
      .attr('stroke', t => {
        if (t._id === selectedTractId) return 'var(--cyan, #37C8CF)';
        if (compareSet.has(t._id)) return '#FFB648';
        return 'rgba(255, 255, 255, 0.45)';
      })
      .attr('stroke-width', t => (t._id === selectedTractId ? 2.5 : compareSet.has(t._id) ? 2.0 : 0.8));
  }, [selectedTractId, compareSet]);

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating Zoom & Pan HUD Controls (Top Right) */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1 bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] rounded-xl p-1 shadow-md">
        <button
          onClick={() => zoomInRef.current?.()}
          aria-label="Zoom in"
          title="Zoom In"
          className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => zoomOutRef.current?.()}
          aria-label="Zoom out"
          title="Zoom Out"
          className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => resetZoomRef.current?.()}
          aria-label="Reset zoom"
          title="Reset to Full County"
          className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Floating Legend (Bottom Left matching prototype) */}
      {legendInfo && (
        <div className="absolute left-3 bottom-3 z-20 px-3 py-2 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-md text-[10.5px] min-w-[170px]">
          <span className="font-bold text-[var(--text)] block mb-1">{legendInfo.title}</span>
          <div className="flex h-2 rounded overflow-hidden mb-1">
            {legendInfo.bins.map((c, i) => (
              <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex justify-between items-center text-[9.5px] text-[var(--faint)]">
            <span>{legendInfo.loText}</span>
            <span>Tiers</span>
            <span>{legendInfo.hiText}</span>
          </div>
        </div>
      )}

      {/* Hover Floating Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left text-[11px] animate-in fade-in duration-100"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="font-bold text-[var(--text)] text-[12px] flex items-center gap-1.5">
            {tooltip.tierColor && (
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tooltip.tierColor }} />
            )}
            <span>{tooltip.title}</span>
          </div>
          {tooltip.subtitle && (
            <div className="text-[10px] text-[var(--faint)] font-mono mt-0.5">{tooltip.subtitle}</div>
          )}
          {tooltip.pop && (
            <div className="text-[10px] text-[var(--muted)] mt-0.5">{tooltip.pop}</div>
          )}
          <div className="flex items-center justify-between gap-3 mt-1 pt-1 border-t border-[var(--line)]">
            <span className="text-[var(--faint)]">{tooltip.metricLabel}:</span>
            <span className="font-bold text-[var(--cyan)] num">{tooltip.metricVal}</span>
          </div>
        </div>
      )}
    </div>
  );
}
