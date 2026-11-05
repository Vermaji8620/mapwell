'use client';

import React, { useRef, useEffect } from 'react';
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
  zoomOnSelect?: boolean;
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
  showControls = false,
  zoomOnSelect = false
}: StateCountyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const pathRef = useRef<d3.GeoPath<any, d3.GeoPermissibleObjects> | null>(null);
  const countiesRef = useRef<CountyRecord[]>([]);
  const gMapRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gMarkersRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gSelRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);

  const metricRef = useRef<string>(metric);
  const layerIdRef = useRef<'sdoh' | 'access'>(layerId);
  const currentSelectedCountyIdRef = useRef<string | null | undefined>(undefined);
  const isInitializedRef = useRef<boolean>(false);

  // Update selected county outline in-place (#102A4C deep navy, no glow, vector-effect non-scaling-stroke)
  const updateSelectedOutline = (selId?: string | null) => {
    const gSel = gSelRef.current;
    if (!gSel) return;
    gSel.selectAll('*').remove();

    if (gMapRef.current) {
      gMapRef.current.selectAll<SVGPathElement, CountyRecord>('path.county')
        .classed('sel', c => c.id === selId);
    }

    if (!selId) return;
    const target = countiesRef.current.find(c => c.id === selId);
    if (target && pathRef.current) {
      gSel.append('path')
        .attr('class', 'sel-outline')
        .attr('d', pathRef.current(target.feature) || '')
        .attr('fill', 'none')
        .attr('stroke', '#102A4C')
        .attr('stroke-width', 1.8)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('filter', 'none');
    }
  };

  // Step 2: Region Enlargement on County Click & Selection
  const zoomToCounty = (targetCounty?: CountyRecord | null, animate = true) => {
    if (!svgRef.current || !zoomRef.current || !pathRef.current) return;
    const path = pathRef.current;
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    const width = containerRef.current?.clientWidth || 550;
    const H = height;
    const padding = 28;

    if (!targetCounty) {
      currentSelectedCountyIdRef.current = null;
      if (animate) {
        svg.transition('camera-zoom')
          .duration(750)
          .ease(d3.easeCubicInOut)
          .call(zoom.transform, d3.zoomIdentity);
      } else {
        svg.call(zoom.transform, d3.zoomIdentity);
      }
      updateSelectedOutline(null);
      return;
    }

    currentSelectedCountyIdRef.current = targetCounty.id;
    const [[x0, y0], [x1, y1]] = path.bounds(targetCounty.feature);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const midX = (x0 + x1) / 2 + padding;
    const midY = (y0 + y1) / 2 + padding;

    // Zoom scale to enlarge county to ~50% of viewport with surrounding context visible
    const pad = 0.50;
    const s = Math.min(8.5, pad / Math.max(dx / width, dy / H, 0.001));
    const tx = width / 2 - s * midX;
    const ty = H / 2 - s * midY;
    const targetTransform = d3.zoomIdentity.translate(tx, ty).scale(s);

    if (animate) {
      svg.transition('camera-zoom')
        .duration(750)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, targetTransform);
    } else {
      svg.call(zoom.transform, targetTransform);
    }

    // Update crisp dark navy outline
    updateSelectedOutline(targetCounty.id);
  };

  // Smoothly update .pulse-m need markers for current metric
  const updatePulseMarkers = (metricKey: string) => {
    const gMarkers = gMarkersRef.current;
    const path = pathRef.current;
    if (!gMarkers || !path) return;
    const stateCounties = countiesRef.current;
    if (stateCounties.length === 0) return;

    const meta = METRICS_CONFIG[metricKey] || { label: metricKey, short: metricKey, bad: 'high', unit: '%' };
    const isBadLow = meta.bad === 'low';
    const topCounties = [...stateCounties].sort((a, b) => {
      const valA = (a.indicators as any)[metricKey] ?? 0;
      const valB = (b.indicators as any)[metricKey] ?? 0;
      return isBadLow ? valA - valB : valB - valA;
    }).slice(0, 4);

    const currentTransform = svgRef.current ? d3.zoomTransform(svgRef.current.node()!) : d3.zoomIdentity;
    const k = currentTransform.k || 1;

    gMarkers.selectAll<SVGGElement, CountyRecord>('g.pulse-m')
      .data(topCounties, d => d.id)
      .join(
        enter => {
          const marker = enter.append('g')
            .attr('class', 'pulse-m')
            .attr('data-id', d => d.id)
            .each(function (d) {
              const centroid = path.centroid(d.feature);
              if (centroid && !isNaN(centroid[0]) && !isNaN(centroid[1])) {
                d3.select(this)
                  .attr('data-cx', centroid[0])
                  .attr('data-cy', centroid[1])
                  .attr('transform', `translate(${centroid[0]}, ${centroid[1]}) scale(${1 / k})`);
              }
            })
            .style('pointer-events', 'none')
            .style('opacity', 0);

          marker.append('circle').attr('class', 'ring').attr('r', 7);
          marker.append('circle').attr('class', 'ring r2').attr('r', 7);
          marker.append('circle').attr('class', 'core').attr('r', 3.5);

          marker.transition('marker-fade')
            .duration(450)
            .style('opacity', 1);

          return marker;
        },
        update => {
          update.transition('marker-fade')
            .duration(300)
            .style('opacity', 1);
          return update;
        },
        exit => exit.transition('marker-fade')
          .duration(300)
          .style('opacity', 0)
          .remove()
      );
  };

  // Step 1: Prevent SVG Unmounting on Metric / Tab Changes (ONLY mount when stateFips or height changes)
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let isCancelled = false;

    async function initMap() {
      const repo = await getCountyRepository();
      if (isCancelled || !containerRef.current) return;

      container.innerHTML = '';
      isInitializedRef.current = false;
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

      // Feature collection for state framing
      const features = stateCounties.map(c => c.feature).filter(Boolean);
      const featureCollection = {
        type: 'FeatureCollection',
        features
      };

      const padding = 28;
      const projection = d3.geoIdentity().fitSize([width - padding * 2, H - padding * 2], featureCollection as any);
      const path = d3.geoPath(projection);
      pathRef.current = path;

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${H}`)
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'overflow-hidden select-none cursor-grab active:cursor-grabbing');

      svgRef.current = svg;

      // Pulse markers and outline styles
      const defs = svg.append('defs');
      const style = defs.append('style');
      style.text(`
        .county {
          transition: stroke 0.15s ease;
        }
        .county:hover {
          stroke: #FFFFFF !important;
          stroke-width: 1.4px !important;
        }
        .sel-outline {
          fill: none;
          stroke: #102A4C !important;
          stroke-width: 1.8px !important;
          filter: none !important;
          vector-effect: non-scaling-stroke;
          pointer-events: none;
        }
        .pulse-m {
          filter: drop-shadow(0 0 6px var(--cyan, #37C8CF)) drop-shadow(0 0 10px rgba(56, 225, 255, 0.45));
        }
        .pulse-m .ring {
          fill: none;
          stroke: var(--cyan, #37C8CF);
          stroke-width: 1.5px;
          vector-effect: non-scaling-stroke;
          transform-box: fill-box;
          transform-origin: center;
          animation: pulseRing 2.4s ease-out infinite;
        }
        .pulse-m .ring.r2 {
          animation-delay: 1.2s;
        }
        .pulse-m .core {
          fill: #FFFFFF;
          stroke: var(--cyan, #37C8CF);
          stroke-width: 2px;
          vector-effect: non-scaling-stroke;
        }
        @keyframes pulseRing {
          0% { transform: scale(0.6); opacity: 0.95; }
          100% { transform: scale(3.2); opacity: 0; }
        }
      `);

      // Root zoom group
      const gZoom = svg.append('g').attr('class', 'zoom-root');

      // County polygons layer
      const gMap = gZoom.append('g')
        .attr('class', 'map-container')
        .attr('transform', `translate(${padding},${padding})`);
      gMapRef.current = gMap;

      // Selected outline layer
      const gSel = gZoom.append('g')
        .attr('class', 'selected-county-outline')
        .attr('transform', `translate(${padding},${padding})`)
        .style('pointer-events', 'none');
      gSelRef.current = gSel;

      // Pulse markers layer
      const gMarkers = gZoom.append('g')
        .attr('class', 'markers-container')
        .attr('transform', `translate(${padding},${padding})`)
        .style('pointer-events', 'none');
      gMarkersRef.current = gMarkers;

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 30])
        .translateExtent([[-width * 10, -H * 10], [width * 10, H * 10]])
        .on('zoom', (event) => {
          gZoom.attr('transform', event.transform);
          const k = event.transform.k;
          gMarkers.selectAll<SVGGElement, unknown>('.pulse-m').attr('transform', function (this: any) {
            const cx = d3.select(this).attr('data-cx');
            const cy = d3.select(this).attr('data-cy');
            return `translate(${cx}, ${cy}) scale(${1 / k})`;
          });
        });

      svg.call(zoom).on('dblclick.zoom', null);
      zoomRef.current = zoom;

      // Initial color calculation
      const curMetric = metricRef.current;
      const curLayer = layerIdRef.current;
      const meta = METRICS_CONFIG[curMetric] || { label: curMetric, short: curMetric, bad: 'high', unit: '%' };
      const values = stateCounties.map(c => (c.indicators as any)[curMetric] ?? 0);
      const { getColor } = createSdohColorScale(values, curMetric, curLayer, meta.bad as any);

      // Render County Polygons
      const paths = gMap.selectAll<SVGPathElement, CountyRecord>('path.county')
        .data(stateCounties, d => d.id)
        .join('path')
        .attr('class', 'county')
        .attr('data-id', c => c.id)
        .attr('d', c => path(c.feature) || '')
        .attr('fill', c => getColor((c.indicators as any)[curMetric] ?? 0))
        .attr('stroke', 'rgba(141, 170, 200, 0.45)')
        .attr('stroke-width', 0.65)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer');

      // County hover & click interactions
      paths.on('pointerenter', (event: MouseEvent, c: CountyRecord) => {
        const mKey = metricRef.current;
        const mMeta = METRICS_CONFIG[mKey] || { label: mKey, short: mKey, bad: 'high', unit: '%' };
        const val = (c.indicators as any)[mKey] ?? 0;
        const formattedVal = mMeta.bad === 'low' && mKey === 'income'
          ? `$${Math.round(val).toLocaleString()}`
          : `${val.toFixed(1)}${mMeta.unit || '%'}`;
        const lbl = `${c.name} ${c.st === '22' ? 'Parish' : c.st === '02' ? 'Borough' : 'County'}, ${c.stateAbbr}`;
        const html = `<b>${lbl}</b><div class="tv"><span>${mMeta.short || mMeta.label}</span><span>${formattedVal}</span></div><div class="tv"><span>Vulnerability</span><span>${(c.svi ?? 0).toFixed(2)}</span></div><div class="tv"><span>Population</span><span>${(c.pop || 0).toLocaleString()}</span></div><div class="note" style="margin-top:5px">Synthetic demo values</div>`;
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
      .on('click', (event: MouseEvent, c: CountyRecord) => {
        event.stopPropagation();
        zoomToCounty(c, true);
        if (onSelectCounty) {
          onSelectCounty(c);
        }
      });

      // Background click clears county selection if handler provided
      svg.on('click', (event: MouseEvent) => {
        if (event.target === svg.node()) {
          if (onClearCounty) onClearCounty();
          zoomToCounty(null, true);
        }
      });

      // Initial pulse markers
      updatePulseMarkers(curMetric);

      // Initial outline for selected county without zooming the camera (keeps full state framing on refresh/reload)
      updateSelectedOutline(selectedCountyId);

      isInitializedRef.current = true;
    }

    initMap();
    return () => {
      isCancelled = true;
      const tip = document.getElementById('tooltip');
      if (tip) tip.classList.remove('on');
    };
  }, [stateFips, height]);

  // Step 3: Implement Subtle West-to-East Fill Transition for Tabs
  useEffect(() => {
    metricRef.current = metric;
    layerIdRef.current = layerId;

    if (!isInitializedRef.current || !gMapRef.current || !pathRef.current || countiesRef.current.length === 0) return;
    const path = pathRef.current;
    const width = containerRef.current?.clientWidth || 550;
    const stateCounties = countiesRef.current;
    const meta = METRICS_CONFIG[metric] || { label: metric, short: metric, bad: 'high', unit: '%' };
    const values = stateCounties.map(c => (c.indicators as any)[metric] ?? 0);
    const { getColor } = createSdohColorScale(values, metric, layerId, meta.bad as any);

    // Subtle west-to-east wave transition across counties
    gMapRef.current.selectAll<SVGPathElement, CountyRecord>('path.county')
      .transition('color-wave')
      .duration(520)
      .delay(c => {
        const centroid = path.centroid(c.feature);
        const cx = centroid && !isNaN(centroid[0]) ? centroid[0] : 0;
        return (cx / width) * 450;
      })
      .attr('fill', c => getColor((c.indicators as any)[metric] ?? 0));

    // Recompute & smoothly update top-4 pulse markers
    updatePulseMarkers(metric);
  }, [metric, layerId]);

  // Synchronize camera zoom and outline when selectedCountyId changes
  useEffect(() => {
    if (!isInitializedRef.current || countiesRef.current.length === 0) return;
    if (currentSelectedCountyIdRef.current === selectedCountyId) return;
    currentSelectedCountyIdRef.current = selectedCountyId;

    if (zoomOnSelect && selectedCountyId) {
      const target = countiesRef.current.find(c => c.id === selectedCountyId);
      if (target) {
        zoomToCounty(target, true);
        return;
      }
    }

    // Reset zoom to full state framing when selection changes without zoom flag (e.g. jurisdiction change)
    if (!zoomOnSelect && svgRef.current && zoomRef.current) {
      const t = d3.zoomTransform(svgRef.current.node()!);
      if (t.k !== 1 || t.x !== 0 || t.y !== 0) {
        svgRef.current.transition('camera-zoom').duration(600).ease(d3.easeCubicInOut).call(zoomRef.current.transform, d3.zoomIdentity);
      }
    }

    updateSelectedOutline(selectedCountyId);
  }, [selectedCountyId, zoomOnSelect]);

  // Interactive HUD Zoom Controls
  const handleZoomIn = () => {
    if (!svgRef.current || !zoomRef.current) return;
    svgRef.current.transition('camera-zoom').duration(350).call(zoomRef.current.scaleBy, 1.4);
  };

  const handleZoomOut = () => {
    if (!svgRef.current || !zoomRef.current) return;
    svgRef.current.transition('camera-zoom').duration(350).call(zoomRef.current.scaleBy, 1 / 1.4);
  };

  const handleResetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return;
    if (onClearCounty) onClearCounty();
    currentSelectedCountyIdRef.current = null;
    updateSelectedOutline(null);
    svgRef.current.transition('camera-zoom').duration(600).ease(d3.easeCubicInOut).call(zoomRef.current.transform, d3.zoomIdentity);
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
