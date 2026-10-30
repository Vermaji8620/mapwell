'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract, Jurisdiction } from '@/types';
import { TIER_COLORS, TIER_LABELS, METRICS_CONFIG, MAP_LAYERS } from '@/config/metrics';

interface MapViewProps {
  countyFips?: string;
  tracts: CensusTract[];
  selectedTractId?: string;
  onSelectTract?: (tract: CensusTract) => void;
  metric?: string;
  layer?: string;
  heatmap?: boolean;
  markers?: boolean;
  height?: number;
  zoomable?: boolean;
}

// Cache topology data to avoid re-fetching
let topoDataCache: any = null;

export function MapViewCanvas({
  countyFips = '53033',
  tracts,
  selectedTractId,
  onSelectTract,
  metric = 'svi',
  layer = 'sdoh',
  heatmap = true,
  markers = true,
  height = 360,
  zoomable = true
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    tier: string;
    tierColor: string;
    metricLabel: string;
    metricVal: string;
    pop: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    tier: '',
    tierColor: '',
    metricLabel: '',
    metricVal: '',
    pop: ''
  });

  useEffect(() => {
    let isMounted = true;

    async function renderMap() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';

      // Load TopoJSON if not cached
      if (!topoDataCache) {
        try {
          const res = await fetch('/us-counties.json');
          if (!res.ok) throw new Error('Failed to load county map data');
          topoDataCache = await res.json();
        } catch (e) {
          console.error(e);
          return;
        }
      }

      if (!isMounted || !topoDataCache) return;

      const counties = (topojson.feature(topoDataCache, topoDataCache.objects.counties) as any).features;
      const targetCounty = counties.find((c: any) => c.id === countyFips) || counties.find((c: any) => c.id === '53033');

      if (!targetCounty) return;

      const pathGen = d3.geoPath();
      const countyD = pathGen(targetCounty) || '';
      const [[x0, y0], [x1, y1]] = pathGen.bounds(targetCounty);
      const countyWidth = Math.max(x1 - x0, 10);
      const countyHeight = Math.max(y1 - y0, 10);

      // SVG dimensions
      const width = container.clientWidth || 700;
      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 975 610`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none')
        .style('background', 'radial-gradient(ellipse at 50% 40%, rgba(37, 132, 235, 0.08), transparent 70%)');

      const defs = svg.append('defs');
      const clipId = `county-clip-${countyFips}-${Math.random().toString(36).substring(2, 7)}`;

      // Clip path for county polygon
      defs.append('clipPath')
        .attr('id', clipId)
        .append('path')
        .attr('d', countyD);

      // Radial gradient for hotspot heatmaps
      const rg = defs.append('radialGradient').attr('id', `${clipId}-glow`);
      rg.append('stop').attr('offset', '0%').attr('stop-color', '#E0336A').attr('stop-opacity', 0.85);
      rg.append('stop').attr('offset', '45%').attr('stop-color', '#FF5D8F').attr('stop-opacity', 0.45);
      rg.append('stop').attr('offset', '100%').attr('stop-color', '#FF5D8F').attr('stop-opacity', 0);

      const mainGroup = svg.append('g');

      // County Background outline
      mainGroup.append('path')
        .attr('d', countyD)
        .attr('fill', 'var(--map-low, #101B45)')
        .attr('stroke', 'var(--line-strong, rgba(255,255,255,0.2))')
        .attr('stroke-width', 1.5)
        .attr('vector-effect', 'non-scaling-stroke');

      // Group for clipped Tracts
      const tractGroup = mainGroup.append('g').attr('clip-path', `url(#${clipId})`);
      const heatGroup = mainGroup.append('g').style('pointer-events', 'none');
      const markerGroup = mainGroup.append('g').style('pointer-events', 'none');
      const selGroup = mainGroup.append('g').style('pointer-events', 'none');

      // Zoom behavior
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 40])
        .on('zoom', (event) => {
          mainGroup.attr('transform', event.transform);
          const k = event.transform.k;
          markerGroup.selectAll('.pulse-m').attr('transform', (d: any) => `translate(${d.x},${d.y}) scale(${1 / k})`);
        });

      if (zoomable) {
        svg.call(zoom);
      }

      // Automatically frame and center the target county
      const padding = 0.82;
      const s = Math.min(30, padding / Math.max(countyWidth / 975, countyHeight / 610));
      const initialTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(s)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

      svg.call(zoom.transform, initialTransform);

      // Extract metric values to construct quantile scale
      const activeMetricConfig = METRICS_CONFIG[metric] || METRICS_CONFIG.svi;
      const metricValues = tracts.map(t => {
        const val = (t.indicators as any)?.[metric] ?? (t as any)[metric] ?? t.svi;
        return typeof val === 'number' ? val : 0;
      });

      // Layer color ramp
      const activeLayerConfig = MAP_LAYERS.find(l => l.id === layer) || MAP_LAYERS[0];
      const ramp = activeLayerConfig.ramp;
      const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), ['#101B45', ...ramp]);
      const quantileScale = d3.scaleQuantile().domain(metricValues.length ? metricValues : [0, 1]).range(d3.range(7));
      const flip = activeMetricConfig.bad === 'low';

      const getColor = (val: number) => {
        const q = quantileScale(val);
        const t = (q + 0.5) / 7;
        return interp(flip ? 1 - t : t);
      };

      // Generate realistic contiguous Voronoi cells within county bounds
      const tractCount = Math.max(tracts.length, 1);
      const points: [number, number][] = [];
      const coreX = x0 + countyWidth * 0.45;
      const coreY = y0 + countyHeight * 0.45;

      // Seed pseudo-random generator based on county FIPS for deterministic cell shapes
      let seed = 0;
      for (let i = 0; i < countyFips.length; i++) seed += countyFips.charCodeAt(i) * (i + 1) * 31;
      const prng = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      for (let i = 0; i < tractCount; i++) {
        const r1 = prng();
        const r2 = prng();
        // Bias points toward county center
        const px = x0 + countyWidth * (0.15 + r1 * 0.7);
        const py = y0 + countyHeight * (0.15 + r2 * 0.7);
        points.push([px, py]);
      }

      if (points.length < 3) {
        points.push([x0 + countyWidth * 0.5, y0 + countyHeight * 0.5], [x0 + 1, y0 + 1], [x1 - 1, y1 - 1]);
      }

      const delaunay = d3.Delaunay.from(points);
      const voronoi = delaunay.voronoi([x0 - 5, y0 - 5, x1 + 5, y1 + 5]);

      // Combine MongoDB tracts with generated Voronoi geometry
      const tractFeatures = tracts.map((tract, idx) => {
        const cellPath = voronoi.renderCell(idx) || '';
        const pt = points[idx] || [coreX, coreY];
        const val = (tract.indicators as any)?.[metric] ?? (tract as any)[metric] ?? tract.svi;
        return {
          tract,
          idx,
          d: cellPath,
          cx: pt[0],
          cy: pt[1],
          val: typeof val === 'number' ? val : 0,
          color: getColor(typeof val === 'number' ? val : 0)
        };
      });

      // Render Tract Polygons
      const paths = tractGroup.selectAll('path.tract')
        .data(tractFeatures, (d: any) => d.tract._id)
        .enter()
        .append('path')
        .attr('class', 'tract')
        .attr('d', (d) => d.d)
        .attr('fill', (d) => d.color)
        .attr('stroke', 'rgba(255, 255, 255, 0.45)')
        .attr('stroke-width', 0.8)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('cursor', 'pointer')
        .classed('sel', (d) => d.tract._id === selectedTractId);

      // Hover and Click events
      paths
        .on('pointerenter', (event, d) => {
          const rect = container.getBoundingClientRect();
          const fmtVal = activeMetricConfig.unit === '%' ? `${d.val.toFixed(1)}%` : activeMetricConfig.unit === '/100' ? `${d.val.toFixed(0)}/100` : d.val.toFixed(2);
          setTooltip({
            visible: true,
            x: event.clientX - rect.left + 12,
            y: event.clientY - rect.top + 12,
            title: d.tract.name,
            tier: `${TIER_LABELS[d.tract.tier]} Vulnerability`,
            tierColor: TIER_COLORS[d.tract.tier],
            metricLabel: activeMetricConfig.label,
            metricVal: fmtVal,
            pop: `${(d.tract.population || 0).toLocaleString()} residents`
          });
        })
        .on('pointermove', (event) => {
          const rect = container.getBoundingClientRect();
          setTooltip((prev) => ({
            ...prev,
            x: event.clientX - rect.left + 12,
            y: event.clientY - rect.top + 12
          }));
        })
        .on('pointerleave', () => {
          setTooltip((prev) => ({ ...prev, visible: false }));
        })
        .on('click', (event, d) => {
          event.stopPropagation();
          paths.classed('sel', (item: any) => item.tract._id === d.tract._id);
          // Highlight selected tract boundary with cyan glow
          selGroup.selectAll('*').remove();
          selGroup.append('path')
            .attr('d', d.d)
            .attr('fill', 'none')
            .attr('stroke', 'var(--cyan)')
            .attr('stroke-width', 2.8)
            .attr('vector-effect', 'non-scaling-stroke')
            .style('filter', 'drop-shadow(0 0 6px var(--cyan))');

          if (onSelectTract) {
            onSelectTract(d.tract);
          }
        });

      // Highlight selected tract if initially passed
      if (selectedTractId) {
        const found = tractFeatures.find(f => f.tract._id === selectedTractId);
        if (found) {
          selGroup.selectAll('*').remove();
          selGroup.append('path')
            .attr('d', found.d)
            .attr('fill', 'none')
            .attr('stroke', 'var(--cyan)')
            .attr('stroke-width', 2.8)
            .attr('vector-effect', 'non-scaling-stroke')
            .style('filter', 'drop-shadow(0 0 6px var(--cyan))');
        }
      }

      // Hotspot Heatmap layer (vivid glowing radial heatmaps on high-need tracts)
      if (heatmap) {
        const highNeed = tractFeatures.filter(f => f.tract.tier >= 3 || f.tract.svi >= 0.70);
        heatGroup.selectAll('circle.heat')
          .data(highNeed)
          .enter()
          .append('circle')
          .attr('class', 'heat')
          .attr('cx', d => d.cx)
          .attr('cy', d => d.cy)
          .attr('r', countyWidth * 0.22)
          .attr('fill', `url(#${clipId}-glow)`)
          .style('mix-blend-mode', 'screen')
          .attr('opacity', 0.85);
      }

      // Pulsing Need Markers on top 3 tracts
      if (markers) {
        const topMarkers = [...tractFeatures]
          .sort((a, b) => (flip ? a.val - b.val : b.val - a.val))
          .slice(0, 3);

        const markerG = markerGroup.selectAll('g.pulse-m')
          .data(topMarkers)
          .enter()
          .append('g')
          .attr('class', 'pulse-m')
          .attr('transform', d => `translate(${d.cx},${d.cy}) scale(${1 / s})`);

        markerG.append('circle').attr('class', 'ring').attr('r', 10);
        markerG.append('circle').attr('class', 'ring r2').attr('r', 10);
        markerG.append('circle').attr('class', 'core').attr('r', 4.5);
      }
    }

    renderMap();

    return () => {
      isMounted = false;
    };
  }, [countyFips, tracts, selectedTractId, metric, layer, heatmap, markers, zoomable]);

  return (
    <div className="relative w-full h-full min-h-[300px] overflow-hidden rounded-xl bg-[var(--surface-solid)] border border-[var(--line)]">
      <div ref={containerRef} className="w-full h-full min-h-[300px]" />

      {/* Floating Hover Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left animate-in fade-in duration-150"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="text-[12px] font-bold text-[var(--text)] flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: tooltip.tierColor }}
            />
            <span>{tooltip.title}</span>
          </div>
          <div className="text-[10.5px] font-semibold text-[var(--muted)] mt-0.5">
            {tooltip.tier} • {tooltip.pop}
          </div>
          <div className="mt-1.5 pt-1.5 border-t border-[var(--line)] flex items-center justify-between gap-3 text-[11px]">
            <span className="text-[var(--faint)]">{tooltip.metricLabel}:</span>
            <span className="font-bold text-[var(--cyan)] num">{tooltip.metricVal}</span>
          </div>
        </div>
      )}
    </div>
  );
}
