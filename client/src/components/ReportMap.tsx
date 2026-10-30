'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { METRICS_CONFIG } from '@/config/metrics';

export interface ReportMapProps {
  countyFips: string;
  tracts: CensusTract[];
  metric?: string;
  focusTractIds?: string[];
  height?: number;
}

let topoCache: any = null;

export function ReportMap({
  countyFips,
  tracts,
  metric = 'svi',
  focusTractIds = [],
  height = 280
}: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    name: string;
    metricLabel: string;
    metricVal: string;
    isFocus: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    name: '',
    metricLabel: '',
    metricVal: '',
    isFocus: false
  });

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
        .attr('class', 'w-full h-full block select-none')
        .style('background', 'radial-gradient(ellipse at 50% 50%, var(--glow), transparent 75%)');

      const defs = svg.append('defs');
      const clipId = `rp-clip-${countyFips}-${Math.random().toString(36).substring(2, 6)}`;

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

      // Auto-fit to county bounds
      const padding = 0.85;
      const s = Math.min(28, padding / Math.max(countyWidth / 975, countyHeight / 610));
      const initialTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(s)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

      mainGroup.attr('transform', initialTransform.toString());

      if (tracts.length === 0) return;

      // Metric configuration & color scale
      const meta = METRICS_CONFIG[metric] || { label: metric, short: metric, unit: '%', bad: 'high' };
      const getVal = (t: CensusTract): number => {
        if (metric.startsWith('prog.')) {
          const pk = metric.replace('prog.', '');
          return (t.prog as any)?.[pk] ?? 50;
        }
        const val = (t.indicators as any)?.[metric] ?? (t as any)[metric] ?? t.svi;
        return typeof val === 'number' ? val : 0;
      };

      const vals = tracts.map(getVal);
      const extent = d3.extent(vals) as [number, number];
      const minVal = extent[0] ?? 0;
      const maxVal = extent[1] ?? 1;

      const colorInterpolator = meta.bad === 'low'
        ? d3.interpolateRgbBasis(['#E0336A', '#FFB648', '#37C8CF'])
        : d3.interpolateRgbBasis(['#1E293B', '#2584EB', '#8B5CF6', '#F43F5E']);

      const colorScale = d3.scaleSequential()
        .domain([minVal, maxVal])
        .interpolator(colorInterpolator);

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

      // Render Tract Cells
      const paths = tractGroup.selectAll<SVGPathElement, CensusTract>('path.tract-cell')
        .data(tracts)
        .enter()
        .append('path')
        .attr('d', (_, i) => voronoi.renderCell(i) || '')
        .attr('data-id', t => t._id)
        .attr('fill', t => colorScale(getVal(t)))
        .attr('stroke', t => (focusSet.has(t._id) ? '#38BDF8' : 'var(--map-line)'))
        .attr('stroke-width', t => (focusSet.has(t._id) ? 2.2 : 0.65))
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('class', 'tract-cell cursor-pointer transition-colors duration-150');

      // Raise focus tracts
      paths.filter(t => focusSet.has(t._id)).raise();

      paths
        .on('pointerenter', function (event, tract) {
          d3.select(this)
            .attr('stroke', '#38BDF8')
            .attr('stroke-width', 2.6)
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
            metricVal: `${v.toFixed(1)}${meta.unit ? ' ' + meta.unit : ''}`,
            isFocus
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
            .attr('stroke', isFocus ? '#38BDF8' : 'var(--map-line)')
            .attr('stroke-width', isFocus ? 2.2 : 0.65);

          setTooltip(prev => ({ ...prev, visible: false }));
        });
    }

    renderMap();

    return () => {
      isMounted = false;
    };
  }, [countyFips, tracts, metric, focusTractIds, height]);

  const meta = METRICS_CONFIG[metric] || { label: metric, short: metric };

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating Legend Bottom-Left */}
      <div className="absolute bottom-3 left-3 z-20 px-3 py-1.5 rounded-xl bg-[var(--surface-solid)]/92 backdrop-blur-md border border-[var(--line-strong)] shadow-md text-[11px]">
        <div className="font-bold text-[var(--text)] mb-1 flex items-center justify-between gap-3">
          <span>{meta.short || meta.label}</span>
          <span className="text-[10px] text-[var(--cyan)] font-semibold">Tracts</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] text-[var(--faint)]">Low</span>
          <div
            className="w-20 h-1.5 rounded-full"
            style={{ background: 'linear-gradient(90deg, #1E293B, #2584EB, #8B5CF6, #F43F5E)' }}
          />
          <span className="text-[9.5px] text-[var(--faint)]">High</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-30 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-xl text-[11.5px] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-bold text-[var(--text)] mb-0.5 flex items-center justify-between gap-3">
            <span>{tooltip.name}</span>
            {tooltip.isFocus && (
              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-[var(--cyan)]/20 text-[var(--cyan)]">
                Focus Tract
              </span>
            )}
          </div>
          <div className="flex justify-between gap-4 text-[11px] text-[var(--muted)]">
            <span>{tooltip.metricLabel}:</span>
            <strong className="text-[var(--text)] num">{tooltip.metricVal}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
