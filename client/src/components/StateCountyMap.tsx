'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { METRICS_CONFIG } from '@/config/metrics';
import { CountyRecord, getCountyRepository } from '@/utils/countyRepository';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface StateCountyMapProps {
  stateFips: string;
  selectedCountyId?: string | null;
  onSelectCounty?: (county: CountyRecord) => void;
  onClearCounty?: () => void;
  metric: string;
  height?: number;
}

export function StateCountyMap({
  stateFips,
  selectedCountyId,
  onSelectCounty,
  onClearCounty,
  metric,
  height = 490
}: StateCountyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const pathRef = useRef<d3.GeoPath<any, d3.GeoPermissibleObjects> | null>(null);
  const countiesRef = useRef<CountyRecord[]>([]);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    name: string;
    metricLabel: string;
    metricVal: string;
    pop: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    name: '',
    metricLabel: '',
    metricVal: '',
    pop: ''
  });

  // Initial render of SVG and state geometry
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let isCancelled = false;

    async function initMap() {
      const repo = await getCountyRepository();
      if (isCancelled || !containerRef.current) return;

      container.innerHTML = '';
      const width = container.clientWidth || 550;
      const H = height;

      const stateCounties = repo.countiesByState.get(stateFips) || [];
      countiesRef.current = stateCounties;

      if (stateCounties.length === 0) {
        const svg = d3.select(container)
          .append('svg')
          .attr('viewBox', `0 0 ${width} ${H}`)
          .attr('width', '100%')
          .attr('height', '100%');
        svg.append('text')
          .attr('x', width / 2)
          .attr('y', H / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'var(--muted)')
          .text('No county geometry available for this state');
        return;
      }

      const features = stateCounties.map(c => c.feature).filter(Boolean);
      const featureCollection = {
        type: 'FeatureCollection',
        features
      };

      // Fit pre-projected coordinates to the viewport
      const padding = 28;
      const projection = d3.geoIdentity().fitSize([width - padding * 2, H - padding * 2], featureCollection as any);
      const path = d3.geoPath(projection);
      pathRef.current = path;

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${H}`)
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('class', 'overflow-hidden select-none cursor-grab active:cursor-grabbing');

      svgRef.current = svg;

      // Glow filter for selected county
      const defs = svg.append('defs');
      const filter = defs.append('filter').attr('id', 'county-glow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
      filter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
      filter.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over');

      // Zoom root group
      const gZoom = svg.append('g').attr('class', 'zoom-root');
      const gMap = gZoom.append('g').attr('class', 'map-container').attr('transform', `translate(${padding},${padding})`);

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.8, 16])
        .translateExtent([[-width * 0.5, -H * 0.5], [width * 1.5, H * 1.5]])
        .on('zoom', (event) => {
          gZoom.attr('transform', event.transform);
        });

      svg.call(zoom).on('dblclick.zoom', null);
      zoomBehaviorRef.current = zoom;

      // Metric extent & color ramp
      const meta = METRICS_CONFIG[metric] || { label: metric, short: metric, bad: 'high', unit: '%' };
      const values = stateCounties.map(c => (c.indicators as any)[metric] ?? 0);
      const extent = d3.extent(values) as [number, number];
      const minVal = extent[0] ?? 0;
      const maxVal = extent[1] ?? 100;

      const colorInterpolator = meta.bad === 'low'
        ? d3.interpolateRgbBasis(['#F43F5E', '#F59E0B', '#37C8CF'])
        : d3.interpolateRgbBasis(['#1E293B', '#2584EB', '#8B5CF6', '#F43F5E']);

      const colorScale = d3.scaleSequential()
        .domain([minVal, maxVal])
        .interpolator(colorInterpolator);

      // Render County Polygons
      const paths = gMap.selectAll('path.county')
        .data(stateCounties)
        .enter()
        .append('path')
        .attr('class', 'county')
        .attr('data-id', (c: CountyRecord) => c.id)
        .attr('d', (c: CountyRecord) => path(c.feature))
        .attr('fill', (c: CountyRecord) => colorScale((c.indicators as any)[metric] ?? 0))
        .attr('stroke', (c: CountyRecord) =>
          c.id === selectedCountyId ? 'var(--cyan, #37C8CF)' : 'rgba(255,255,255,0.22)'
        )
        .attr('stroke-width', (c: CountyRecord) =>
          c.id === selectedCountyId ? 2.8 : 0.8
        )
        .attr('cursor', 'pointer')
        .attr('class', 'transition-colors duration-150 hover:brightness-125');

      paths.on('pointerenter', (event, c: CountyRecord) => {
        const cRect = container.getBoundingClientRect();
        const val = (c.indicators as any)[metric] ?? 0;
        const formattedVal = meta.bad === 'low' && metric === 'income'
          ? `$${Math.round(val).toLocaleString()}`
          : `${val.toFixed(1)}${meta.unit || '%'}`;

        setTooltip({
          visible: true,
          x: event.clientX - cRect.left + 12,
          y: event.clientY - cRect.top - 12,
          name: `${c.name} County, ${c.stateAbbr}`,
          metricLabel: meta.short || meta.label,
          metricVal: formattedVal,
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

      // Initial county zoom if one is already selected
      if (selectedCountyId) {
        const targetCounty = stateCounties.find(c => c.id === selectedCountyId);
        if (targetCounty && path) {
          const [[x0, y0], [x1, y1]] = path.bounds(targetCounty.feature);
          const dx = x1 - x0;
          const dy = y1 - y0;
          const midX = (x0 + x1) / 2 + padding;
          const midY = (y0 + y1) / 2 + padding;
          const s = Math.min(6.5, 0.42 / Math.max(dx / width, dy / H));
          const tx = width / 2 - s * midX;
          const ty = H / 2 - s * midY;
          svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(s));
        }
      }
    }

    initMap();
    return () => {
      isCancelled = true;
    };
  }, [stateFips, metric, height]);

  // Smooth Zoom & Enlarge Effect when selectedCountyId changes
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current || !pathRef.current) return;
    const svg = svgRef.current;
    const zoom = zoomBehaviorRef.current;
    const path = pathRef.current;
    const width = containerRef.current?.clientWidth || 550;
    const H = height;
    const padding = 28;

    // Update stroke highlights
    svg.selectAll('path.county')
      .attr('stroke', function (this: any) {
        const id = d3.select(this).attr('data-id');
        return id === selectedCountyId ? 'var(--cyan, #37C8CF)' : 'rgba(255,255,255,0.22)';
      })
      .attr('stroke-width', function (this: any) {
        const id = d3.select(this).attr('data-id');
        return id === selectedCountyId ? 2.8 : 0.8;
      });

    if (selectedCountyId) {
      // Find county and enlarge that particular region
      const targetCounty = countiesRef.current.find(c => c.id === selectedCountyId);
      if (targetCounty) {
        // Raise selected county above peers
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
    } else {
      // Smoothly zoom back out to fit full state
      svg.transition()
        .duration(750)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity);
    }
  }, [selectedCountyId, height]);

  // Interactive HUD Zoom Controls
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
    if (onClearCounty) onClearCounty();
    svgRef.current.transition().duration(600).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div className="relative w-full h-full" style={{ minHeight: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating Zoom & Pan HUD Controls (Top Right) */}
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
          title="Reset to Full State View"
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
            <span className="text-[var(--faint)]">{tooltip.metricLabel}:</span>
            <span className="font-bold text-[var(--cyan)] num">{tooltip.metricVal}</span>
          </div>
          <div className="text-[10px] text-[var(--muted)] mt-0.5">
            Population: <span className="num font-semibold text-[var(--text)]">{tooltip.pop}</span>
          </div>
        </div>
      )}
    </div>
  );
}
