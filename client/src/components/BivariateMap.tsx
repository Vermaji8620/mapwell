'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { STATE_META } from '@/utils/countyRepository';

export interface BivariateMapProps {
  countyFips: string;
  countyName?: string;
  tracts: CensusTract[];
  programKey: string;
  programLabel: string;
  selectedTractId?: string | null;
  onSelectTract?: (tract: CensusTract) => void;
  onCountySelect?: (countyFips: string) => void;
  height?: number;
}

// 3x3 Bivariate Matrix Palette: [Need (0=Low, 1=Mid, 2=High)][Low Utilization (0=High Util, 1=Mid Util, 2=Low Util)]
export const BIV_MATRIX = [
  ['#E4F1FB', '#B9D7F0', '#8FB8E3'],
  ['#BDEDEF', '#8FC3DE', '#4F86CF'],
  ['#5DD0D5', '#2E93C9', '#173F8A']
];

let topoCache: any = null;
const dynamicTractsCache = new Map<string, CensusTract[]>();

export function BivariateMap({
  countyFips,
  countyName = 'County',
  tracts,
  programKey,
  programLabel,
  selectedTractId,
  onSelectTract,
  onCountySelect,
  height = 460
}: BivariateMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const switchCountyRef = useRef<((targetCid: string) => void) | null>(null);
  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const resetZoomRef = useRef<(() => void) | null>(null);

  const [activeCountyId, setActiveCountyId] = useState<string>(countyFips);
  const [activeCountyName, setActiveCountyName] = useState<string>(countyName);
  const [primaryCountyName, setPrimaryCountyName] = useState<string>(countyName);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    tractName: string;
    svi: number;
    utilization: number;
    gapScore: number;
    category: string;
    isHotspot: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    tractName: '',
    svi: 0,
    utilization: 0,
    gapScore: 0,
    category: '',
    isHotspot: false
  });

  const getTractUtil = (t: CensusTract, key: string): number => {
    if (key === 'all') {
      const prog = t.prog;
      if (!prog) return 50;
      const vals = Object.values(prog);
      return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    }
    const val = t.prog ? (t.prog as any)[key] : (t.indicators as any)?.[`prog.${key}`];
    return typeof val === 'number' ? val : 50;
  };

  const computeBivColor = (u: number, svi: number, uq: [number, number], sq: [number, number]) => {
    const nb = svi < sq[0] ? 0 : svi < sq[1] ? 1 : 2;
    const ub = u > uq[1] ? 0 : u > uq[0] ? 1 : 2;
    return BIV_MATRIX[nb][ub];
  };

  const getCategoryLabel = (u: number, svi: number, uq: [number, number], sq: [number, number]) => {
    const needLabel = svi >= sq[1] ? 'High Need' : svi >= sq[0] ? 'Moderate Need' : 'Low Need';
    const utilLabel = u <= uq[0] ? 'Low Util' : u <= uq[1] ? 'Moderate Util' : 'High Util';
    return `${needLabel} / ${utilLabel}`;
  };

  // Sync prop changes
  useEffect(() => {
    setActiveCountyId(countyFips);
    if (switchCountyRef.current) {
      switchCountyRef.current(countyFips);
    }
  }, [countyFips]);

  useEffect(() => {
    let isMounted = true;

    async function renderBivariate() {
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
      const initialName = `${initialTarget.properties?.name || countyName} County, ${stateAbbr}`;
      setPrimaryCountyName(initialName);
      setActiveCountyName(initialName);

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none map-svg dim-others')
        .style('background', 'transparent');

      // Defs
      const defs = svg.append('defs');
      const clipId = `biv-clip-active-${Math.random().toString(36).substring(2, 6)}`;

      const clipPathElement = defs.append('clipPath')
        .attr('id', clipId)
        .append('path');

      const pulseStyle = defs.append('style');
      pulseStyle.text(`
        @keyframes hotspotGlow {
          0%, 100% {
            stroke-opacity: 0.7;
            stroke-width: 1.8px;
          }
          50% {
            stroke-opacity: 1;
            stroke-width: 2.4px;
          }
        }
        .hotspot-tract {
          animation: hotspotGlow 2.8s ease-in-out infinite;
        }
      `);

      const rootGroup = svg.append('g').attr('class', 'map-root');

      // Layers:
      // 1. Ambient surrounding counties
      const gSurround = rootGroup.append('g').attr('class', 'surrounding-counties');
      // 2. Base dark silhouette of demonstrated county
      const gTargetBase = rootGroup.append('g').attr('class', 'target-county-base');
      const baseCountyPath = gTargetBase.append('path').attr('fill', '#101B45').attr('opacity', 0.85);
      // 3. Clipped Tracts Group
      const gTracts = rootGroup.append('g').attr('class', 'tracts-group').attr('clip-path', `url(#${clipId})`);
      // 4. Glowing Cyan Boundary
      const gSel = rootGroup.append('g').attr('class', 'target-county-outline');
      const outlineCountyPath = gSel.append('path')
        .attr('fill', 'none')
        .attr('stroke', '#0284c7')
        .attr('stroke-width', 2.0)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('filter', 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.7))')
        .style('pointer-events', 'none');

      // Synthetic Tract Generator for outside counties
      function getOrGenerateTracts(targetCid: string, targetFeature: any): CensusTract[] {
        if (targetCid === countyFips && tracts.length > 0) {
          return tracts;
        }
        if (dynamicTractsCache.has(targetCid)) {
          return dynamicTractsCache.get(targetCid)!;
        }

        const count = 16;
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
          const sviVal = 0.14 + r1 * 0.8;
          const utilVal = 25 + r2 * 60;
          const tractId = `${targetCid}${String(101 + i).padStart(4, '0')}00`;
          generated.push({
            _id: tractId,
            countyFips: targetCid,
            name: `Census Tract ${101 + i}`,
            population: Math.round(2400 + prng() * 4600),
            svi: Math.round(sviVal * 100) / 100,
            tier: Math.min(4, Math.floor(sviVal * 5)),
            prog: {
              all: Math.round(utilVal),
              wic: Math.round(utilVal * (0.8 + prng() * 0.4)),
              imm: Math.round(utilVal * (0.85 + prng() * 0.3)),
              dpp: Math.round(utilVal * (0.75 + prng() * 0.5)),
              tob: Math.round(utilVal * (0.9 + prng() * 0.3)),
              mhv: Math.round(utilVal * (0.7 + prng() * 0.5))
            },
            indicators: {
              svi: Math.round(sviVal * 100) / 100,
              uninsured: Math.round((6.5 + prng() * 11) * 10) / 10,
              poverty: Math.round((7.5 + prng() * 18) * 10) / 10,
              noVehicle: Math.round((7 + prng() * 16) * 10) / 10
            }
          } as any);
        }

        dynamicTractsCache.set(targetCid, generated);
        return generated;
      }

      // Main demonstration switcher function
      let currentCid = countyFips;

      async function demonstrateCounty(targetCid: string, animateCamera = true) {
        currentCid = targetCid;
        setActiveCountyId(targetCid);

        const targetFeature =
          counties.find((c: any) => c.id === targetCid) ||
          initialTarget;

        const cName = `${targetFeature.properties?.name || 'County'} County, ${stateAbbr}`;
        setActiveCountyName(cName);

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

        // Zoom controls handlers
        zoomInRef.current = () => {
          rootGroup.transition().duration(300).call(d3.zoom().scaleBy as any, 1.3);
        };
        zoomOutRef.current = () => {
          rootGroup.transition().duration(300).call(d3.zoom().scaleBy as any, 0.77);
        };
        resetZoomRef.current = () => {
          rootGroup.transition().duration(500).attr('transform', targetTransform.toString());
        };

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
              tractName: hoverName,
              svi: 0,
              utilization: 0,
              gapScore: 0,
              category: 'Adjacent Jurisdiction (Click to demonstrate)',
              isHotspot: false
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

        // Tertiles calculation
        const utils = activeTracts.map(t => getTractUtil(t, programKey)).sort(d3.ascending);
        const svis = activeTracts.map(t => t.svi).sort(d3.ascending);

        const uq: [number, number] = [
          d3.quantile(utils, 1 / 3) ?? 40,
          d3.quantile(utils, 2 / 3) ?? 60
        ];
        const sq: [number, number] = [
          d3.quantile(svis, 1 / 3) ?? 0.33,
          d3.quantile(svis, 2 / 3) ?? 0.66
        ];

        // Identify top coverage gaps
        const topGapIds = new Set(
          [...activeTracts]
            .sort((a, b) => {
              const gapA = a.svi * (100 - getTractUtil(a, programKey));
              const gapB = b.svi * (100 - getTractUtil(b, programKey));
              return gapB - gapA;
            })
            .slice(0, 6)
            .map(t => t._id)
        );

        // Voronoi Mesh Generation
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
          .attr('fill', t => {
            const util = getTractUtil(t, programKey);
            return computeBivColor(util, t.svi, uq, sq);
          })
          .attr('stroke', t => {
            if (t._id === selectedTractId) return 'var(--cyan)';
            if (topGapIds.has(t._id)) return 'var(--cyan)';
            return 'rgba(255, 255, 255, 0.65)';
          })
          .attr('stroke-width', t => {
            if (t._id === selectedTractId) return 2.6;
            if (topGapIds.has(t._id)) return 2.0;
            return 0.75;
          })
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('class', t => {
            const isHot = topGapIds.has(t._id);
            return `tract-cell cursor-pointer ${isHot ? 'hotspot-tract' : ''}`;
          })
          .style('filter', t => (topGapIds.has(t._id) ? 'drop-shadow(0 0 5px rgba(56, 189, 248, 0.65))' : 'none'));

        paths.filter(t => topGapIds.has(t._id)).raise();

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

        // Hover Tooltips on Tracts
        paths
          .on('pointerenter', function (event, tract) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 2.4)
              .raise();

            const cRect = container.getBoundingClientRect();
            const util = getTractUtil(tract, programKey);
            const gap = tract.svi * (100 - util);
            const isHot = topGapIds.has(tract._id);

            setTooltip({
              visible: true,
              x: event.clientX - cRect.left + 14,
              y: event.clientY - cRect.top - 14,
              tractName: tract.name || `Tract ${tract._id}`,
              svi: tract.svi,
              utilization: util,
              gapScore: Math.round(gap),
              category: getCategoryLabel(util, tract.svi, uq, sq),
              isHotspot: isHot
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
            const isHot = topGapIds.has(tract._id);
            const isSelected = tract._id === selectedTractId;

            d3.select(this)
              .attr('stroke', isSelected || isHot ? 'var(--cyan)' : 'rgba(255, 255, 255, 0.65)')
              .attr('stroke-width', isSelected ? 2.6 : isHot ? 2.0 : 0.75);

            if (isHot || isSelected) {
              d3.select(this).raise();
            }

            setTooltip(prev => ({ ...prev, visible: false }));
          })
          .on('click', function (_, tract) {
            if (onSelectTract) {
              onSelectTract(tract);
            }
          });
      }

      switchCountyRef.current = (cid: string) => {
        demonstrateCounty(cid, true);
      };

      // Initial demonstration
      demonstrateCounty(countyFips, false);
    }

    renderBivariate();

    return () => {
      isMounted = false;
    };
  }, [countyFips, tracts, programKey, selectedTractId, onSelectTract, onCountySelect, height]);

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

      {/* Top Left Floating Header */}
      <div className="absolute top-4 left-4 z-20 px-3.5 py-2.5 rounded-xl bg-[var(--surface-solid)]/90 backdrop-blur-md border border-[var(--line-strong)] shadow-lg select-none">
        <h4 className="text-[12.5px] font-bold text-[var(--text)]">Community coverage gaps</h4>
        <p className="text-[10.5px] text-[var(--muted)]">Tract need against program utilization</p>
      </div>

      {/* Top Right Zoom & Navigation Controls */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {isDemonstratingOutside && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0f172a]/92 backdrop-blur-md border border-cyan-400/50 text-cyan-300 text-[11px] font-semibold shadow-xl animate-in fade-in zoom-in-95 duration-150">
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

        <div className="flex flex-col bg-[var(--surface-solid)]/90 backdrop-blur-md border border-[var(--line-strong)] rounded-xl shadow-md p-1 gap-1">
          <button
            onClick={() => zoomInRef.current?.()}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => zoomOutRef.current?.()}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => resetZoomRef.current?.()}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
            title="Reset zoom"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3x3 Bivariate Legend Matrix (Bottom Right) */}
      <div className="absolute bottom-4 right-4 z-20 p-3 rounded-2xl bg-[var(--surface-solid)]/92 backdrop-blur-md border border-[var(--line-strong)] shadow-xl flex items-center gap-3 select-none">
        <div className="flex flex-col items-center">
          <div className="grid grid-cols-3 gap-1">
            {[2, 1, 0].map(needIdx =>
              [0, 1, 2].map(utilIdx => (
                <div
                  key={`${needIdx}-${utilIdx}`}
                  className="w-4 h-4 rounded-sm transition-transform hover:scale-110 shadow-xs"
                  style={{ backgroundColor: BIV_MATRIX[needIdx][utilIdx] }}
                  title={`Need: ${needIdx === 2 ? 'High' : needIdx === 1 ? 'Mid' : 'Low'}, Util: ${utilIdx === 2 ? 'Low' : utilIdx === 1 ? 'Mid' : 'High'}`}
                />
              ))
            )}
          </div>
          <span className="text-[9.5px] font-bold text-[var(--faint)] mt-1.5 uppercase tracking-wider">
            Lower utilization →
          </span>
        </div>
        <span
          className="text-[9.5px] font-bold text-[var(--faint)] uppercase tracking-wider"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          Higher need →
        </span>
      </div>

      {/* Interactive Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-30 pointer-events-none px-3.5 py-2.5 rounded-xl bg-[#0b1329]/95 backdrop-blur-md border border-white/15 shadow-2xl text-[11.5px] text-white animate-in fade-in zoom-in-95 duration-100"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-bold text-white mb-1 flex items-center justify-between gap-3">
            <span>{tooltip.tractName}</span>
            {tooltip.isHotspot && (
              <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                Top Gap
              </span>
            )}
          </div>

          <div className="space-y-1 text-[11px] text-slate-300">
            {tooltip.category.includes('Adjacent Jurisdiction') ? (
              <div className="text-cyan-400 font-semibold">{tooltip.category}</div>
            ) : (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Vulnerability (SVI):</span>
                  <span className="font-mono text-cyan-400 font-bold">{tooltip.svi.toFixed(2)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Utilization:</span>
                  <strong className="font-mono text-white">{tooltip.utilization.toFixed(1)}%</strong>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Gap Priority Score:</span>
                  <span className="font-mono font-bold text-rose-400">{tooltip.gapScore}</span>
                </div>
                <div className="pt-1 mt-1 border-t border-white/10 flex justify-between gap-3 text-[10px]">
                  <span className="text-slate-400">{tooltip.category}</span>
                  <span className="text-cyan-400 font-semibold">Click to open tract</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
