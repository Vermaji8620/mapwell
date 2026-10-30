'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export interface BivariateMapProps {
  countyFips: string;
  countyName?: string;
  tracts: CensusTract[];
  programKey: string;
  programLabel: string;
  selectedTractId?: string | null;
  onSelectTract?: (tract: CensusTract) => void;
  height?: number;
}

// 3x3 Bivariate Matrix Palette: [Need (0=Low, 1=Mid, 2=High)][Low Utilization (0=High Util, 1=Mid Util, 2=Low Util)]
export const BIV_MATRIX = [
  ['#E4F1FB', '#B9D7F0', '#8FB8E3'],
  ['#BDEDEF', '#8FC3DE', '#4F86CF'],
  ['#5DD0D5', '#2E93C9', '#173F8A']
];

let topoCache: any = null;

export function BivariateMap({
  countyFips,
  countyName = 'County',
  tracts,
  programKey,
  programLabel,
  selectedTractId,
  onSelectTract,
  height = 460
}: BivariateMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const tractPathsRef = useRef<d3.Selection<SVGPathElement, CensusTract, SVGGElement, unknown> | null>(null);

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

  // Helper to compute tertiles & color
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

  // Render Map
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
      const targetCounty =
        counties.find((c: any) => c.id === countyFips) ||
        counties.find((c: any) => c.id === '53033') ||
        counties[0];

      if (!targetCounty) return;

      const pathGen = d3.geoPath();
      const countyD = pathGen(targetCounty) || '';
      const [[x0, y0], [x1, y1]] = pathGen.bounds(targetCounty);
      const countyWidth = Math.max(x1 - x0, 10);
      const countyHeight = Math.max(y1 - y0, 10);

      const width = container.clientWidth || 600;
      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none cursor-grab active:cursor-grabbing')
        .style('background', 'radial-gradient(ellipse at 50% 50%, var(--glow), transparent 75%)');

      svgRef.current = svg;

      // Defs
      const defs = svg.append('defs');
      const clipId = `biv-clip-${countyFips}-${Math.random().toString(36).substring(2, 6)}`;

      // County Boundary Clip
      defs.append('clipPath')
        .attr('id', clipId)
        .append('path')
        .attr('d', countyD);

      // Subtle pulse animation style for hotspot borders
      const pulseStyle = defs.append('style');
      pulseStyle.text(`
        @keyframes hotspotGlow {
          0%, 100% {
            stroke-opacity: 0.65;
            stroke-width: 1.8px;
          }
          50% {
            stroke-opacity: 1;
            stroke-width: 2.2px;
          }
        }
        .hotspot-tract {
          animation: hotspotGlow 2.8s ease-in-out infinite;
        }
      `);

      const mainGroup = svg.append('g').attr('class', 'zoom-group');

      // County background silhouette with dynamic theme variables
      mainGroup.append('path')
        .attr('d', countyD)
        .attr('fill', 'var(--map-low)')
        .attr('stroke', 'var(--map-line)')
        .attr('stroke-width', 1.5)
        .attr('vector-effect', 'non-scaling-stroke');

      const tractGroup = mainGroup.append('g').attr('clip-path', `url(#${clipId})`);

      // Zoom configuration
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 30])
        .on('zoom', (event) => {
          mainGroup.attr('transform', event.transform);
        });

      svg.call(zoom).on('dblclick.zoom', null);
      zoomBehaviorRef.current = zoom;

      // Auto-fit to county bounds
      const padding = 0.82;
      const s = Math.min(28, padding / Math.max(countyWidth / 975, countyHeight / 610));
      const initialTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(s)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

      svg.call(zoom.transform, initialTransform);

      if (tracts.length === 0) return;

      // Quantile Tertile Calculation
      const utils = tracts.map(t => getTractUtil(t, programKey)).sort(d3.ascending);
      const svis = tracts.map(t => t.svi).sort(d3.ascending);

      const uq: [number, number] = [
        d3.quantile(utils, 1 / 3) ?? 40,
        d3.quantile(utils, 2 / 3) ?? 60
      ];
      const sq: [number, number] = [
        d3.quantile(svis, 1 / 3) ?? 0.33,
        d3.quantile(svis, 2 / 3) ?? 0.66
      ];

      // Identify top 6 hotspot tracts (largest coverage gaps: high SVI, low util)
      const topGapIds = new Set(
        [...tracts]
          .sort((a, b) => {
            const gapA = a.svi * (100 - getTractUtil(a, programKey));
            const gapB = b.svi * (100 - getTractUtil(b, programKey));
            return gapB - gapA;
          })
          .slice(0, 6)
          .map(t => t._id)
      );

      // Voronoi Mesh Generation clipped to County
      const points: [number, number][] = [];

      let seed = 0;
      for (let i = 0; i < countyFips.length; i++) seed += countyFips.charCodeAt(i) * (i + 1) * 37;
      const prng = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      for (let i = 0; i < tracts.length; i++) {
        const r1 = prng();
        const r2 = prng();
        const px = x0 + countyWidth * (0.12 + r1 * 0.76);
        const py = y0 + countyHeight * (0.12 + r2 * 0.76);
        points.push([px, py]);
      }

      if (points.length < 3) {
        points.push([x0 + countyWidth * 0.5, y0 + countyHeight * 0.5], [x0 + 1, y0 + 1], [x1 - 1, y1 - 1]);
      }

      const delaunay = d3.Delaunay.from(points);
      const voronoi = delaunay.voronoi([x0 - 10, y0 - 10, x1 + 10, y1 + 10]);

      // Render Tract Cells: fully visible with crisp 3x3 choropleth colors
      const paths = tractGroup.selectAll<SVGPathElement, CensusTract>('path.tract-cell')
        .data(tracts)
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
          return 'var(--map-line)';
        })
        .attr('stroke-width', t => {
          if (t._id === selectedTractId) return 2.6;
          if (topGapIds.has(t._id)) return 1.8;
          return 0.7;
        })
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('class', t => {
          const isHot = topGapIds.has(t._id);
          return `tract-cell cursor-pointer transition-colors duration-150 ${isHot ? 'hotspot-tract' : ''}`;
        });

      tractPathsRef.current = paths;

      // Raise hotspot tracts so their highlight borders are crisp and prominent
      paths.filter(t => topGapIds.has(t._id)).raise();

      // Interactive Hover & Click Handling
      paths
        .on('pointerenter', function (event, tract) {
          d3.select(this)
            .attr('stroke', 'var(--cyan)')
            .attr('stroke-width', 2.8)
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
            .attr('stroke', isSelected || isHot ? 'var(--cyan)' : 'var(--map-line)')
            .attr('stroke-width', isSelected ? 2.6 : isHot ? 1.8 : 0.7);

          setTooltip(prev => ({ ...prev, visible: false }));
        })
        .on('click', function (_, tract) {
          if (onSelectTract) {
            onSelectTract(tract);
          }
        });
    }

    renderBivariate();

    return () => {
      isMounted = false;
    };
  }, [countyFips, tracts, height]);

  // Smooth Animated Recoloring when programKey changes
  useEffect(() => {
    if (!tractPathsRef.current || tracts.length === 0) return;

    const utils = tracts.map(t => getTractUtil(t, programKey)).sort(d3.ascending);
    const svis = tracts.map(t => t.svi).sort(d3.ascending);

    const uq: [number, number] = [
      d3.quantile(utils, 1 / 3) ?? 40,
      d3.quantile(utils, 2 / 3) ?? 60
    ];
    const sq: [number, number] = [
      d3.quantile(svis, 1 / 3) ?? 0.33,
      d3.quantile(svis, 2 / 3) ?? 0.66
    ];

    const topGapIds = new Set(
      [...tracts]
        .sort((a, b) => {
          const gapA = a.svi * (100 - getTractUtil(a, programKey));
          const gapB = b.svi * (100 - getTractUtil(b, programKey));
          return gapB - gapA;
        })
        .slice(0, 6)
        .map(t => t._id)
    );

    // Smooth color morphing transition over 450ms
    tractPathsRef.current
      .transition()
      .duration(450)
      .ease(d3.easeCubicOut)
      .attr('fill', t => {
        const util = getTractUtil(t, programKey);
        return computeBivColor(util, t.svi, uq, sq);
      })
      .attr('stroke', t => {
        if (t._id === selectedTractId) return 'var(--cyan)';
        if (topGapIds.has(t._id)) return 'var(--cyan)';
        return 'var(--map-line)';
      })
      .attr('stroke-width', t => {
        if (t._id === selectedTractId) return 2.6;
        if (topGapIds.has(t._id)) return 1.8;
        return 0.7;
      });
  }, [programKey, tracts]);

  const handleZoomIn = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    svgRef.current.transition().duration(350).call(zoomBehaviorRef.current.scaleBy, 1.4);
  };

  const handleZoomOut = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    svgRef.current.transition().duration(350).call(zoomBehaviorRef.current.scaleBy, 1 / 1.4);
  };

  const handleResetZoom = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    svgRef.current.transition().duration(600).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating Header Info Badge Top-Left */}
      <div className="absolute top-4 left-4 z-20 px-3.5 py-2.5 rounded-xl bg-[var(--surface-solid)]/92 backdrop-blur-md border border-[var(--line-strong)] shadow-lg pointer-events-none">
        <h4 className="text-[12.5px] font-bold text-[var(--text)] leading-tight">
          Community coverage gaps
        </h4>
        <p className="text-[11px] text-[var(--muted)] mt-0.5">
          Tract need against program utilization
        </p>
      </div>

      {/* Floating 3x3 Bivariate Matrix Legend Bottom-Right */}
      <div className="absolute bottom-4 right-4 z-20 p-3 rounded-xl bg-[var(--surface-solid)]/92 backdrop-blur-md border border-[var(--line-strong)] shadow-lg flex items-center gap-3">
        {/* Vertical Axis Label: Higher Need */}
        <span
          className="text-[10px] font-bold text-[var(--faint)] uppercase tracking-wider select-none"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          Higher need →
        </span>

        {/* 3x3 Grid & Horizontal Axis Label */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="grid grid-cols-3 gap-1">
            {[2, 1, 0].map(needRow => (
              <React.Fragment key={needRow}>
                {[0, 1, 2].map(utilCol => (
                  <div
                    key={`${needRow}-${utilCol}`}
                    className="w-4 h-4 rounded-[3px] border border-black/20 shadow-2xs"
                    style={{ backgroundColor: BIV_MATRIX[needRow][utilCol] }}
                    title={`Need: ${needRow}, Low-Util: ${utilCol}`}
                  />
                ))}
              </React.Fragment>
            ))}
          </div>
          <span className="text-[10px] font-bold text-[var(--faint)] uppercase tracking-wider select-none">
            Lower utilization →
          </span>
        </div>
      </div>

      {/* Floating Zoom Navigation Controls Top-Right */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-1.5 p-1 rounded-xl bg-[var(--surface-solid)]/90 backdrop-blur-md border border-[var(--line-strong)] shadow-md">
        <button
          onClick={handleZoomIn}
          aria-label="Zoom in"
          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          aria-label="Zoom out"
          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetZoom}
          aria-label="Reset zoom"
          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Interactive Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-30 pointer-events-none px-3.5 py-2.5 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-xl text-[12px] animate-in fade-in zoom-in-95 duration-150"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="flex items-center justify-between gap-3 font-bold text-[var(--text)] mb-1 pb-1 border-b border-[var(--line)]">
            <span>{tooltip.tractName}</span>
            {tooltip.isHotspot && (
              <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-[var(--rose)]/20 text-[var(--rose)]">
                Priority Hotspot
              </span>
            )}
          </div>
          <div className="space-y-0.5 text-[11px]">
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Vulnerability (SVI):</span>
              <strong className="text-[var(--cyan)] num">{tooltip.svi.toFixed(2)}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Utilization:</span>
              <strong className="text-[var(--text)] num">{tooltip.utilization.toFixed(1)}%</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Gap Priority Score:</span>
              <strong className="text-[var(--rose)] num font-bold">{tooltip.gapScore}</strong>
            </div>
            <div className="mt-1 pt-1 border-t border-[var(--line)] text-[10px] text-[var(--faint)] flex items-center justify-between">
              <span>{tooltip.category}</span>
              <span className="text-[var(--cyan)] font-semibold">Click to open tract</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
