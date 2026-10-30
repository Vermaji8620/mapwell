'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { TIER_COLORS, TIER_LABELS } from '@/config/metrics';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export interface AssessmentTractMapProps {
  countyFips: string;
  tracts: CensusTract[];
  selectedTractIds: string[];
  onToggleTract: (tract: CensusTract) => void;
  height?: number;
}

let topoCache: any = null;

export function AssessmentTractMap({
  countyFips,
  tracts,
  selectedTractIds,
  onToggleTract,
  height = 320
}: AssessmentTractMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const tractPathsRef = useRef<d3.Selection<SVGPathElement, CensusTract, SVGGElement, unknown> | null>(null);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    name: string;
    svi: number;
    tier: number;
    pop: number;
    isSelected: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    name: '',
    svi: 0,
    tier: 1,
    pop: 0,
    isSelected: false
  });

  const selectedSet = new Set(selectedTractIds);

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

      const width = container.clientWidth || 500;
      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none cursor-grab active:cursor-grabbing')
        .style('background', 'radial-gradient(ellipse at 50% 50%, var(--glow), transparent 75%)');

      svgRef.current = svg;

      const defs = svg.append('defs');
      const clipId = `as-clip-${countyFips}-${Math.random().toString(36).substring(2, 6)}`;

      defs.append('clipPath')
        .attr('id', clipId)
        .append('path')
        .attr('d', countyD);

      const mainGroup = svg.append('g').attr('class', 'zoom-group');

      // County background silhouette
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
      const padding = 0.84;
      const s = Math.min(28, padding / Math.max(countyWidth / 975, countyHeight / 610));
      const initialTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(s)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

      svg.call(zoom.transform, initialTransform);

      if (tracts.length === 0) return;

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

      // SVI Color Scale for unselected tracts
      const sviScale = d3.scaleSequential()
        .domain([0, 1])
        .interpolator(d3.interpolateRgbBasis(['#1E293B', '#2584EB', '#8B5CF6', '#F43F5E']));

      // Render Tract Cells
      const paths = tractGroup.selectAll<SVGPathElement, CensusTract>('path.tract-cell')
        .data(tracts)
        .enter()
        .append('path')
        .attr('d', (_, i) => voronoi.renderCell(i) || '')
        .attr('data-id', t => t._id)
        .attr('fill', t => {
          const isSel = selectedSet.has(t._id);
          return isSel ? 'var(--cyan)' : sviScale(t.svi);
        })
        .attr('fill-opacity', t => (selectedSet.has(t._id) ? 0.95 : 0.65))
        .attr('stroke', t => (selectedSet.has(t._id) ? '#ffffff' : 'var(--map-line)'))
        .attr('stroke-width', t => (selectedSet.has(t._id) ? 2.2 : 0.65))
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('class', 'tract-cell cursor-pointer transition-colors duration-150');

      tractPathsRef.current = paths;

      paths
        .on('pointerenter', function (event, tract) {
          d3.select(this)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 2.8)
            .raise();

          const cRect = container.getBoundingClientRect();
          const isSel = selectedSet.has(tract._id);

          setTooltip({
            visible: true,
            x: event.clientX - cRect.left + 14,
            y: event.clientY - cRect.top - 14,
            name: tract.name || `Tract ${tract._id}`,
            svi: tract.svi,
            tier: tract.tier ?? 2,
            pop: tract.population || 4000,
            isSelected: isSel
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
          const isSel = selectedSet.has(tract._id);
          d3.select(this)
            .attr('stroke', isSel ? '#ffffff' : 'var(--map-line)')
            .attr('stroke-width', isSel ? 2.2 : 0.65);

          setTooltip(prev => ({ ...prev, visible: false }));
        })
        .on('click', function (_, tract) {
          onToggleTract(tract);
        });
    }

    renderMap();

    return () => {
      isMounted = false;
    };
  }, [countyFips, tracts, height]);

  // Update fills and highlights when selectedTractIds changes
  useEffect(() => {
    if (!tractPathsRef.current || tracts.length === 0) return;

    const sviScale = d3.scaleSequential()
      .domain([0, 1])
      .interpolator(d3.interpolateRgbBasis(['#1E293B', '#2584EB', '#8B5CF6', '#F43F5E']));

    tractPathsRef.current
      .transition()
      .duration(250)
      .attr('fill', t => {
        const isSel = selectedSet.has(t._id);
        return isSel ? 'var(--cyan)' : sviScale(t.svi);
      })
      .attr('fill-opacity', t => (selectedSet.has(t._id) ? 0.95 : 0.65))
      .attr('stroke', t => (selectedSet.has(t._id) ? '#ffffff' : 'var(--map-line)'))
      .attr('stroke-width', t => (selectedSet.has(t._id) ? 2.2 : 0.65));
  }, [selectedTractIds, tracts]);

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

      {/* Floating Header Info Badge */}
      <div className="absolute top-3 left-3 z-20 px-3 py-1.5 rounded-xl bg-[var(--surface-solid)]/92 backdrop-blur-md border border-[var(--line-strong)] shadow-md pointer-events-none">
        <span className="text-[11.5px] font-bold text-[var(--text)]">
          Click tracts to include or exclude them
        </span>
      </div>

      {/* Floating Zoom Controls */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1 p-1 rounded-xl bg-[var(--surface-solid)]/90 backdrop-blur-md border border-[var(--line-strong)] shadow-md">
        <button
          onClick={handleZoomIn}
          aria-label="Zoom in"
          className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleZoomOut}
          aria-label="Zoom out"
          className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleResetZoom}
          aria-label="Reset zoom"
          className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-30 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-xl text-[11.5px] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-bold text-[var(--text)] mb-1 pb-1 border-b border-[var(--line)] flex items-center justify-between gap-3">
            <span>{tooltip.name}</span>
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                tooltip.isSelected ? 'bg-[var(--cyan)]/20 text-[var(--cyan)]' : 'bg-[var(--surface-2)] text-[var(--muted)]'
              }`}
            >
              {tooltip.isSelected ? 'Included' : 'Excluded'}
            </span>
          </div>
          <div className="space-y-0.5 text-[11px]">
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Vulnerability (SVI):</span>
              <strong className="text-[var(--cyan)] num">{tooltip.svi.toFixed(2)}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Population:</span>
              <strong className="text-[var(--text)] num">{tooltip.pop.toLocaleString()}</strong>
            </div>
            <div className="pt-1 mt-1 border-t border-[var(--line)] text-[10px] text-[var(--cyan)] font-semibold">
              Click to {tooltip.isSelected ? 'remove from focus' : 'add to focus'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
