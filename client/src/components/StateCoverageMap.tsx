'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

export interface StateCoverageMapProps {
  height?: number;
  onSelectState?: (stateName: string, covPct: number) => void;
}

// Deterministic state coverage generator (82% to 99.8%) matching MapWell specification
export const STATE_COVERAGE: Record<string, { name: string; abbr: string; cov: number }> = {
  '01': { name: 'Alabama', abbr: 'AL', cov: 91.4 },
  '02': { name: 'Alaska', abbr: 'AK', cov: 83.2 },
  '04': { name: 'Arizona', abbr: 'AZ', cov: 94.7 },
  '05': { name: 'Arkansas', abbr: 'AR', cov: 89.6 },
  '06': { name: 'California', abbr: 'CA', cov: 98.9 },
  '08': { name: 'Colorado', abbr: 'CO', cov: 97.4 },
  '09': { name: 'Connecticut', abbr: 'CT', cov: 98.1 },
  '10': { name: 'Delaware', abbr: 'DE', cov: 96.5 },
  '11': { name: 'District of Columbia', abbr: 'DC', cov: 99.4 },
  '12': { name: 'Florida', abbr: 'FL', cov: 95.8 },
  '13': { name: 'Georgia', abbr: 'GA', cov: 92.3 },
  '15': { name: 'Hawaii', abbr: 'HI', cov: 93.8 },
  '16': { name: 'Idaho', abbr: 'ID', cov: 91.0 },
  '17': { name: 'Illinois', abbr: 'IL', cov: 96.9 },
  '18': { name: 'Indiana', abbr: 'IN', cov: 93.7 },
  '19': { name: 'Iowa', abbr: 'IA', cov: 95.2 },
  '20': { name: 'Kansas', abbr: 'KS', cov: 92.8 },
  '21': { name: 'Kentucky', abbr: 'KY', cov: 90.5 },
  '22': { name: 'Louisiana', abbr: 'LA', cov: 88.9 },
  '23': { name: 'Maine', abbr: 'ME', cov: 94.6 },
  '24': { name: 'Maryland', abbr: 'MD', cov: 97.8 },
  '25': { name: 'Massachusetts', abbr: 'MA', cov: 99.2 },
  '26': { name: 'Michigan', abbr: 'MI', cov: 96.1 },
  '27': { name: 'Minnesota', abbr: 'MN', cov: 98.5 },
  '28': { name: 'Mississippi', abbr: 'MS', cov: 87.4 },
  '29': { name: 'Missouri', abbr: 'MO', cov: 91.8 },
  '30': { name: 'Montana', abbr: 'MT', cov: 89.1 },
  '31': { name: 'Nebraska', abbr: 'NE', cov: 94.0 },
  '32': { name: 'Nevada', abbr: 'NV', cov: 93.4 },
  '33': { name: 'New Hampshire', abbr: 'NH', cov: 97.1 },
  '34': { name: 'New Jersey', abbr: 'NJ', cov: 98.4 },
  '35': { name: 'New Mexico', abbr: 'NM', cov: 89.9 },
  '36': { name: 'New York', abbr: 'NY', cov: 98.7 },
  '37': { name: 'North Carolina', abbr: 'NC', cov: 95.3 },
  '38': { name: 'North Dakota', abbr: 'ND', cov: 92.6 },
  '39': { name: 'Ohio', abbr: 'OH', cov: 95.7 },
  '40': { name: 'Oklahoma', abbr: 'OK', cov: 88.7 },
  '41': { name: 'Oregon', abbr: 'OR', cov: 97.2 },
  '42': { name: 'Pennsylvania', abbr: 'PA', cov: 96.4 },
  '44': { name: 'Rhode Island', abbr: 'RI', cov: 98.0 },
  '45': { name: 'South Carolina', abbr: 'SC', cov: 92.1 },
  '46': { name: 'South Dakota', abbr: 'SD', cov: 91.5 },
  '47': { name: 'Tennessee', abbr: 'TN', cov: 93.1 },
  '48': { name: 'Texas', abbr: 'TX', cov: 94.2 },
  '49': { name: 'Utah', abbr: 'UT', cov: 96.0 },
  '50': { name: 'Vermont', abbr: 'VT', cov: 96.8 },
  '51': { name: 'Virginia', abbr: 'VA', cov: 97.5 },
  '53': { name: 'Washington', abbr: 'WA', cov: 98.8 },
  '54': { name: 'West Virginia', abbr: 'WV', cov: 88.3 },
  '55': { name: 'Wisconsin', abbr: 'WI', cov: 97.0 },
  '56': { name: 'Wyoming', abbr: 'WY', cov: 90.2 }
};

let topoCache: any = null;

export function StateCoverageMap({ height = 360, onSelectState }: StateCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    name: string;
    abbr: string;
    cov: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
    name: '',
    abbr: '',
    cov: 0
  });

  const [activeStateFips, setActiveStateFips] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';

      if (!topoCache) {
        try {
          const res = await fetch('/us-counties.json');
          if (!res.ok) throw new Error('Failed to load map geometry');
          topoCache = await res.json();
        } catch (err) {
          console.error(err);
          return;
        }
      }

      if (!isMounted || !topoCache) return;

      const statesGeo = topojson.feature(topoCache, topoCache.objects.states) as any;
      const states = statesGeo.features;

      const width = container.clientWidth || 640;
      const svg = d3
        .select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none')
        .style('background', 'radial-gradient(ellipse at 50% 50%, var(--glow), transparent 75%)');

      svgRef.current = svg;

      const g = svg.append('g').attr('class', 'states-group');

      const pathGen = d3.geoPath();

      // Sequential color scale for coverage (80% to 100%)
      // Deep navy/slate -> vibrant cyan/teal -> bright emerald
      const colorScale = d3
        .scaleSequential()
        .domain([82, 100])
        .interpolator(d3.interpolateRgbBasis(['#1E293B', '#1D4ED8', '#0284C7', '#06B6D4', '#10B981']));

      // Render State Polygons
      const paths = g
        .selectAll<SVGPathElement, any>('path.state-poly')
        .data(states as any[])
        .enter()
        .append('path')
        .attr('d', (d: any) => pathGen(d) || '')
        .attr('class', 'state-poly cursor-pointer transition-colors duration-150')
        .attr('fill', (d: any) => {
          const st = STATE_COVERAGE[d.id] || { cov: 92 };
          return colorScale(st.cov);
        })
        .attr('stroke', 'var(--map-line)')
        .attr('stroke-width', 0.9)
        .attr('vector-effect', 'non-scaling-stroke');

      // Zoom configuration
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.9, 8])
        .on('zoom', event => {
          g.attr('transform', event.transform);
        });

      svg.call(zoom);
      zoomBehaviorRef.current = zoom;

      // Pointer interactions
      paths
        .on('pointerenter', function (event, d: any) {
          const st = STATE_COVERAGE[d.id] || {
            name: d.properties?.name || `State ${d.id}`,
            abbr: 'US',
            cov: 92.0
          };

          d3.select(this)
            .attr('stroke', 'var(--cyan)')
            .attr('stroke-width', 2.2)
            .raise();

          const cRect = container.getBoundingClientRect();
          setTooltip({
            visible: true,
            x: event.clientX - cRect.left + 14,
            y: event.clientY - cRect.top - 14,
            name: st.name,
            abbr: st.abbr,
            cov: st.cov
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
        .on('pointerleave', function (_, d: any) {
          const isSelected = activeStateFips === d.id;
          d3.select(this)
            .attr('stroke', isSelected ? 'var(--cyan)' : 'var(--map-line)')
            .attr('stroke-width', isSelected ? 2.2 : 0.9);

          setTooltip(prev => ({ ...prev, visible: false }));
        })
        .on('click', function (_, d: any) {
          const st = STATE_COVERAGE[d.id] || {
            name: d.properties?.name || `State ${d.id}`,
            abbr: 'US',
            cov: 92.0
          };
          setActiveStateFips(d.id);
          if (onSelectState) {
            onSelectState(st.name, st.cov);
          }
        });
    }

    initMap();

    return () => {
      isMounted = false;
    };
  }, [activeStateFips, onSelectState]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      svgRef.current.transition().duration(300).call(zoomBehaviorRef.current.scaleBy, 1.4);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      svgRef.current.transition().duration(300).call(zoomBehaviorRef.current.scaleBy, 0.7);
    }
  };

  const handleResetZoom = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      svgRef.current.transition().duration(350).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none" style={{ minHeight: `${height}px` }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Floating Header Tag */}
      <div className="absolute top-3.5 left-3.5 z-10 px-3.5 py-2 rounded-xl bg-[var(--surface-solid)]/92 backdrop-blur-md border border-[var(--line-strong)] shadow-md">
        <h4 className="text-[12.5px] font-bold text-[var(--text)] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[var(--teal)] animate-pulse" />
          <span>Geographic coverage</span>
        </h4>
        <p className="text-[11px] text-[var(--muted)]">Share of tracts with complete indicator data, by state</p>
      </div>

      {/* Zoom Controls */}
      <div className="absolute top-3.5 right-3.5 z-10 flex flex-col gap-1 rounded-xl bg-[var(--surface-solid)]/90 backdrop-blur-md border border-[var(--line-strong)] p-1 shadow-md">
        <button
          onClick={handleZoomIn}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] font-bold text-sm"
          title="Zoom In"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] font-bold text-sm"
          title="Zoom Out"
        >
          −
        </button>
        <button
          onClick={handleResetZoom}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] font-bold text-xs"
          title="Reset View"
        >
          ↺
        </button>
      </div>

      {/* Floating Legend */}
      <div className="absolute bottom-3.5 left-3.5 z-10 px-3.5 py-2 rounded-xl bg-[var(--surface-solid)]/92 backdrop-blur-md border border-[var(--line-strong)] shadow-md text-[11px]">
        <div className="font-bold text-[var(--text)] mb-1 flex items-center justify-between gap-4">
          <span>Tract data completeness</span>
          <span className="text-[10px] text-[var(--cyan)] font-semibold">US States</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--faint)]">82%</span>
          <div
            className="w-24 h-1.5 rounded-full"
            style={{
              background: 'linear-gradient(90deg, #1E293B, #1D4ED8, #0284C7, #06B6D4, #10B981)'
            }}
          />
          <span className="text-[10px] text-[var(--faint)]">100%</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-20 pointer-events-none px-3.5 py-2 rounded-xl bg-[var(--surface-solid)]/96 backdrop-blur-md border border-[var(--line-strong)] shadow-xl text-[12px] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-bold text-[var(--text)] flex items-center justify-between gap-3 mb-0.5">
            <span>{tooltip.name}</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[var(--cyan)]/20 text-[var(--cyan)]">
              {tooltip.abbr}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11.5px] text-[var(--muted)]">
            <span>Complete tracts:</span>
            <strong className="text-[var(--teal)] num">{tooltip.cov.toFixed(1)}%</strong>
          </div>
        </div>
      )}
    </div>
  );
}
