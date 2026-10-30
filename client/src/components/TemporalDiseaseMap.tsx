'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { METRICS_CONFIG } from '@/config/metrics';
import { CountyRecord, getCountyRepository } from '@/utils/countyRepository';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface TemporalDiseaseMapProps {
  scopeSt: string | null; // null for Nation, or stateFips (e.g. '53', '27')
  condition: string;
  yearIndex: number;
  years: string[];
  selectedCountyId?: string | null;
  onSelectCounty?: (county: CountyRecord) => void;
  height?: number;
  countyTrends: Map<string, number[]>;
}

export function TemporalDiseaseMap({
  scopeSt,
  condition,
  yearIndex,
  years,
  selectedCountyId,
  onSelectCounty,
  height = 460,
  countyTrends
}: TemporalDiseaseMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const pathRef = useRef<d3.GeoPath<any, d3.GeoPermissibleObjects> | null>(null);
  const projectionRef = useRef<any>(null);
  const countiesRef = useRef<CountyRecord[]>([]);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    name: string;
    conditionName: string;
    rate: string;
    year: string;
    pop: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    name: '',
    conditionName: '',
    rate: '',
    year: '',
    pop: ''
  });

  // Build map when scopeSt changes
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let isCancelled = false;

    async function initMap() {
      const repo = await getCountyRepository();
      if (isCancelled || !containerRef.current) return;

      container.innerHTML = '';
      const width = container.clientWidth || 600;
      const H = height;

      const activePool = scopeSt
        ? repo.countiesByState.get(scopeSt) || []
        : repo.counties;

      countiesRef.current = activePool;

      if (activePool.length === 0) return;

      const features = activePool.map(c => c.feature).filter(Boolean);
      const featureCollection = {
        type: 'FeatureCollection',
        features
      };

      const padding = 20;
      const projection = d3.geoIdentity().fitSize([width - padding * 2, H - padding * 2], featureCollection as any);
      projectionRef.current = projection;
      const path = d3.geoPath(projection);
      pathRef.current = path;

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${H}`)
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('class', 'overflow-hidden select-none cursor-grab active:cursor-grabbing');

      svgRef.current = svg;

      // Pulse Marker Style Definition
      const defs = svg.append('defs');
      const pulseStyle = defs.append('style');
      pulseStyle.text(`
        @keyframes mapPulse {
          0% { r: 3px; opacity: 0.9; }
          50% { r: 9px; opacity: 0.2; }
          100% { r: 3px; opacity: 0.9; }
        }
        .pulse-marker {
          animation: mapPulse 2.4s ease-in-out infinite;
          transform-origin: center;
        }
      `);

      const gZoom = svg.append('g').attr('class', 'zoom-root');
      const gMap = gZoom.append('g').attr('class', 'map-container').attr('transform', `translate(${padding},${padding})`);
      const gMarkers = gZoom.append('g').attr('class', 'markers-container').attr('transform', `translate(${padding},${padding})`);

      // Gentle fade & scale-in animation on mount
      gZoom.attr('opacity', 0)
        .transition()
        .duration(650)
        .ease(d3.easeCubicOut)
        .attr('opacity', 1);

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.8, 16])
        .translateExtent([[-width, -H], [width * 2, H * 2]])
        .on('zoom', (event) => {
          gZoom.attr('transform', event.transform);
          const k = event.transform.k;
          gMarkers.selectAll('circle').attr('transform', function(this: any) {
            const cx = d3.select(this).attr('data-cx');
            const cy = d3.select(this).attr('data-cy');
            return `translate(${cx}, ${cy}) scale(${1 / Math.sqrt(k)}) translate(${-cx}, ${-cy})`;
          });
        });

      svg.call(zoom).on('dblclick.zoom', null);
      zoomBehaviorRef.current = zoom;

      // Color scale
      const meta = METRICS_CONFIG[condition] || { label: condition, short: condition, unit: '%' };
      const currentYearValues = activePool.map(c => {
        const trend = countyTrends.get(c.id);
        return trend ? trend[yearIndex] : (c.indicators as any)[condition] ?? 10;
      });

      const extent = d3.extent(currentYearValues) as [number, number];
      const minVal = extent[0] ?? 5;
      const maxVal = extent[1] ?? 25;

      const colorScale = d3.scaleSequential()
        .domain([minVal, maxVal])
        .interpolator(d3.interpolateRgbBasis(['#1E293B', '#2584EB', '#8B5CF6', '#F43F5E']));

      // Render Counties
      const paths = gMap.selectAll('path.county')
        .data(activePool)
        .enter()
        .append('path')
        .attr('class', 'county')
        .attr('data-id', (c: CountyRecord) => c.id)
        .attr('d', (c: CountyRecord) => path(c.feature))
        .attr('fill', (c: CountyRecord) => {
          const trend = countyTrends.get(c.id);
          const val = trend ? trend[yearIndex] : (c.indicators as any)[condition] ?? 10;
          return colorScale(val);
        })
        .attr('stroke', (c: CountyRecord) =>
          c.id === selectedCountyId ? 'var(--cyan, #37C8CF)' : 'rgba(255,255,255,0.18)'
        )
        .attr('stroke-width', (c: CountyRecord) =>
          c.id === selectedCountyId ? 2.5 : 0.6
        )
        .attr('cursor', 'pointer')
        .attr('class', 'transition-colors duration-200 hover:brightness-125');

      paths.on('pointerenter', (event, c: CountyRecord) => {
        const cRect = container.getBoundingClientRect();
        const trend = countyTrends.get(c.id);
        const val = trend ? trend[yearIndex] : (c.indicators as any)[condition] ?? 10;

        setTooltip({
          visible: true,
          x: event.clientX - cRect.left + 12,
          y: event.clientY - cRect.top - 12,
          name: `${c.name} County, ${c.stateAbbr}`,
          conditionName: meta.short || meta.label,
          rate: `${val.toFixed(1)}${meta.unit || '%'}`,
          year: years[yearIndex],
          pop: c.pop.toLocaleString()
        });
      })
      .on('pointermove', (event) => {
        const cRect = container.getBoundingClientRect();
        setTooltip(prev => ({
          ...prev,
          x: event.clientX - cRect.left + 12,
          y: event.clientY - cRect.top - 12
        }));
      })
      .on('pointerleave', () => {
        setTooltip(prev => ({ ...prev, visible: false }));
      })
      .on('click', (_, c: CountyRecord) => {
        if (onSelectCounty) {
          onSelectCounty(c);
        }
      });

      // Animated Pulsing Need Markers on Top 5 Highest-Rate Counties
      const topCounties = [...activePool].sort((a, b) => {
        const valA = (countyTrends.get(a.id)?.[yearIndex]) || 0;
        const valB = (countyTrends.get(b.id)?.[yearIndex]) || 0;
        return valB - valA;
      }).slice(0, 6);

      topCounties.forEach(c => {
        const centroid = path.centroid(c.feature);
        if (!centroid || isNaN(centroid[0])) return;

        // Outer pulsing ring
        gMarkers.append('circle')
          .attr('data-cx', centroid[0])
          .attr('data-cy', centroid[1])
          .attr('cx', centroid[0])
          .attr('cy', centroid[1])
          .attr('class', 'pulse-marker pointer-events-none')
          .attr('fill', '#F43F5E')
          .attr('opacity', 0.65);

        // Core dot
        gMarkers.append('circle')
          .attr('data-cx', centroid[0])
          .attr('data-cy', centroid[1])
          .attr('cx', centroid[0])
          .attr('cy', centroid[1])
          .attr('r', 2.8)
          .attr('fill', '#ffffff')
          .attr('stroke', '#F43F5E')
          .attr('stroke-width', 1.2)
          .attr('class', 'pointer-events-none');
      });
    }

    initMap();
    return () => {
      isCancelled = true;
    };
  }, [scopeSt, height]);

  // Animated smooth color transitions when yearIndex or condition changes
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const activePool = countiesRef.current;
    if (activePool.length === 0) return;

    const currentYearValues = activePool.map(c => {
      const trend = countyTrends.get(c.id);
      return trend ? trend[yearIndex] : (c.indicators as any)[condition] ?? 10;
    });

    const extent = d3.extent(currentYearValues) as [number, number];
    const minVal = extent[0] ?? 5;
    const maxVal = extent[1] ?? 25;

    const colorScale = d3.scaleSequential()
      .domain([minVal, maxVal])
      .interpolator(d3.interpolateRgbBasis(['#1E293B', '#2584EB', '#8B5CF6', '#F43F5E']));

    svg.selectAll('path.county')
      .transition()
      .duration(450)
      .ease(d3.easeCubicOut)
      .attr('fill', function (this: any) {
        const id = d3.select(this).attr('data-id');
        const trend = countyTrends.get(id);
        const val = trend ? trend[yearIndex] : 10;
        return colorScale(val);
      });
  }, [yearIndex, condition, countyTrends]);

  // Zoom into selected county or clear highlight
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current || !pathRef.current) return;
    const svg = svgRef.current;
    const zoom = zoomBehaviorRef.current;
    const path = pathRef.current;
    const width = containerRef.current?.clientWidth || 600;
    const H = height;
    const padding = 20;

    svg.selectAll('path.county')
      .attr('stroke', function (this: any) {
        const id = d3.select(this).attr('data-id');
        return id === selectedCountyId ? 'var(--cyan, #37C8CF)' : 'rgba(255,255,255,0.18)';
      })
      .attr('stroke-width', function (this: any) {
        const id = d3.select(this).attr('data-id');
        return id === selectedCountyId ? 2.5 : 0.6;
      });

    if (selectedCountyId) {
      const targetCounty = countiesRef.current.find(c => c.id === selectedCountyId);
      if (targetCounty) {
        svg.selectAll('path.county')
          .filter(function (this: any) {
            return d3.select(this).attr('data-id') === selectedCountyId;
          })
          .raise();

        const [[x0, y0], [x1, y1]] = path.bounds(targetCounty.feature);
        const dx = x1 - x0;
        const dy = y1 - y0;
        const midX = (x0 + x1) / 2 + padding;
        const midY = (y0 + y1) / 2 + padding;
        const s = Math.min(6.5, 0.42 / Math.max(dx / width, dy / H));
        const tx = width / 2 - s * midX;
        const ty = H / 2 - s * midY;

        svg.transition()
          .duration(850)
          .ease(d3.easeCubicInOut)
          .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(s));
      }
    }
  }, [selectedCountyId, height]);

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
    <div className="relative w-full h-full" style={{ minHeight: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating HUD Controls */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-1 bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] rounded-xl p-1 shadow-lg">
        <button
          onClick={handleZoomIn}
          aria-label="Zoom in"
          title="Zoom In"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          aria-label="Zoom out"
          title="Zoom Out"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetZoom}
          aria-label="Reset zoom"
          title="Reset View"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Hover Floating Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3.5 py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl text-left text-[11px] animate-in fade-in duration-100"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="font-bold text-[var(--text)] text-[12.5px]">{tooltip.name}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[var(--faint)]">{tooltip.conditionName} ({tooltip.year}):</span>
            <span className="font-bold text-[var(--cyan)] num">{tooltip.rate}</span>
          </div>
          <div className="text-[10px] text-[var(--muted)] mt-0.5">
            Population: <span className="num font-semibold text-[var(--text)]">{tooltip.pop}</span>
          </div>
        </div>
      )}
    </div>
  );
}
