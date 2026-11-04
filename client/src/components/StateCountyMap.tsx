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
  layerId?: 'sdoh' | 'access';
  height?: number;
  showControls?: boolean;
}

// Official SDOH & Healthcare Access Layer Color Ramps matching local prototype (lines 1081 & 1094-1104)
export const SDOH_RAMP = ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'];
export const ACCESS_RAMP = ['#C6EAF7', '#7FC6F2', '#3B97E6', '#1F63C6', '#143F86'];
export const MAP_LOW = '#101B45';

export function createSdohColorScale(
  values: number[],
  metricKey: string,
  layerId: 'sdoh' | 'access' = 'sdoh',
  bad: 'high' | 'low' = 'high'
) {
  const ramp = layerId === 'access' ? ACCESS_RAMP : SDOH_RAMP;
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
    d3.interpolateRgb(MAP_LOW, ramp[0])(0.6),
    ...ramp
  ]);
  const qScale = d3.scaleQuantile().domain(values.length > 0 ? values : [0, 100]).range(d3.range(7));
  const flip = bad === 'low';
  const tOf = (i: number) => {
    const t = (i + 0.5) / 7;
    return flip ? 1 - t : t;
  };
  const getColor = (val: number) => {
    const bin = qScale(val);
    return interp(tOf(bin));
  };
  const bins = d3.range(7).map(i => interp(tOf(i)));
  const extent = (values.length > 0 ? d3.extent(values) : [0, 100]) as [number, number];
  return { getColor, bins, extent, qScale };
}

export function StateCountyMap({
  stateFips,
  selectedCountyId,
  onSelectCounty,
  onClearCounty,
  metric,
  layerId = 'sdoh',
  height = 490,
  showControls = false
}: StateCountyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const pathRef = useRef<d3.GeoPath<any, d3.GeoPermissibleObjects> | null>(null);
  const countiesRef = useRef<CountyRecord[]>([]);

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

      // Glow filter for selected county & pulse style
      const defs = svg.append('defs');
      const filter = defs.append('filter').attr('id', 'county-glow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
      filter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
      filter.append('feComposite').attr('in', 'SourceGraphic').attr('in2', 'blur').attr('operator', 'over');

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

      // Zoom root group
      const gZoom = svg.append('g').attr('class', 'zoom-root');
      const gMap = gZoom.append('g').attr('class', 'map-container').attr('transform', `translate(${padding},${padding})`);
      const gMarkers = gZoom.append('g').attr('class', 'markers-container').attr('transform', `translate(${padding},${padding})`);

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.8, 16])
        .translateExtent([[-width * 0.5, -H * 0.5], [width * 1.5, H * 1.5]])
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

      // Metric extent & color ramp matching prototype
      const meta = METRICS_CONFIG[metric] || { label: metric, short: metric, bad: 'high', unit: '%' };
      const values = stateCounties.map(c => (c.indicators as any)[metric] ?? 0);
      const { getColor } = createSdohColorScale(values, metric, layerId, meta.bad as any);

      // Render County Polygons
      const paths = gMap.selectAll('path.county')
        .data(stateCounties)
        .enter()
        .append('path')
        .attr('class', 'county')
        .attr('data-id', (c: CountyRecord) => c.id)
        .attr('d', (c: CountyRecord) => path(c.feature))
        .attr('fill', (c: CountyRecord) => getColor((c.indicators as any)[metric] ?? 0))
        .attr('stroke', (c: CountyRecord) =>
          c.id === selectedCountyId ? 'var(--cyan, #37C8CF)' : 'rgba(255,255,255,0.22)'
        )
        .attr('stroke-width', (c: CountyRecord) =>
          c.id === selectedCountyId ? 2.8 : 0.8
        )
        .attr('cursor', 'pointer')
        .attr('class', 'transition-colors duration-150 hover:brightness-125');

      paths.on('pointerenter', (event: MouseEvent, c: CountyRecord) => {
        const val = (c.indicators as any)[metric] ?? 0;
        const formattedVal = meta.bad === 'low' && metric === 'income'
          ? `$${Math.round(val).toLocaleString()}`
          : `${val.toFixed(1)}${meta.unit || '%'}`;
        const lbl = `${c.name} ${c.st === '22' ? 'Parish' : c.st === '02' ? 'Borough' : 'County'}, ${c.stateAbbr}`;
        const html = `<b>${lbl}</b><div class="tv"><span>${meta.short || meta.label}</span><span>${formattedVal}</span></div><div class="tv"><span>Vulnerability</span><span>${(c.svi ?? 0).toFixed(2)}</span></div><div class="tv"><span>Population</span><span>${(c.pop || 0).toLocaleString()}</span></div><div class="note" style="margin-top:5px">Synthetic demo values</div>`;
        const tip = document.getElementById('tooltip');
        if (tip) {
          tip.innerHTML = html;
          tip.classList.add('on');
          const w = tip.offsetWidth || 220, h = tip.offsetHeight || 100;
          let x = event.clientX + 16, y = event.clientY + 14;
          if (x + w > window.innerWidth - 8) x = event.clientX - w - 16;
          if (y + h > window.innerHeight - 8) y = event.clientY - h - 14;
          tip.style.left = `${x}px`;
          tip.style.top = `${y}px`;
        }
      })
      .on('pointermove', (event: MouseEvent) => {
        const tip = document.getElementById('tooltip');
        if (tip) {
          const w = tip.offsetWidth || 220, h = tip.offsetHeight || 100;
          let x = event.clientX + 16, y = event.clientY + 14;
          if (x + w > window.innerWidth - 8) x = event.clientX - w - 16;
          if (y + h > window.innerHeight - 8) y = event.clientY - h - 14;
          tip.style.left = `${x}px`;
          tip.style.top = `${y}px`;
        }
      })
      .on('pointerleave', () => {
        const tip = document.getElementById('tooltip');
        if (tip) tip.classList.remove('on');
      })
      .on('click', (_, c: CountyRecord) => {
        if (onSelectCounty) {
          onSelectCounty(c);
        }
      });

      // Animated Pulsing Need Markers on Top 4 Greatest Need Counties
      const isBadLow = meta.bad === 'low';
      const topCounties = [...stateCounties].sort((a, b) => {
        const valA = (a.indicators as any)[metric] ?? 0;
        const valB = (b.indicators as any)[metric] ?? 0;
        return isBadLow ? valA - valB : valB - valA;
      }).slice(0, 4);

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
          .attr('fill', 'var(--rose, #FF5D8F)')
          .attr('opacity', 0.65);

        // Core dot
        gMarkers.append('circle')
          .attr('data-cx', centroid[0])
          .attr('data-cy', centroid[1])
          .attr('cx', centroid[0])
          .attr('cy', centroid[1])
          .attr('r', 2.8)
          .attr('fill', '#ffffff')
          .attr('stroke', 'var(--rose, #FF5D8F)')
          .attr('stroke-width', 1.2)
          .attr('class', 'pointer-events-none');
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
      const tip = document.getElementById('tooltip');
      if (tip) tip.classList.remove('on');
    };
  }, [stateFips, metric, layerId, height]);

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

      {/* Floating Zoom & Pan HUD Controls (Only if showControls is true) */}
      {showControls && (
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
      )}
    </div>
  );
}
