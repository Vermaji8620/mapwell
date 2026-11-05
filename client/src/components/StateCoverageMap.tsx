'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

export interface StateCoverageMapProps {
  height?: number;
  coverageOverrides?: Record<string, number>;
  onSelectState?: (stateName: string, covPct: number) => void;
}

export const STATE_META: Record<string, { abbr: string; name: string; region: string }> = {
  '01': { abbr: 'AL', name: 'Alabama', region: 'South' },
  '02': { abbr: 'AK', name: 'Alaska', region: 'West' },
  '04': { abbr: 'AZ', name: 'Arizona', region: 'West' },
  '05': { abbr: 'AR', name: 'Arkansas', region: 'South' },
  '06': { abbr: 'CA', name: 'California', region: 'West' },
  '08': { abbr: 'CO', name: 'Colorado', region: 'West' },
  '09': { abbr: 'CT', name: 'Connecticut', region: 'Northeast' },
  '10': { abbr: 'DE', name: 'Delaware', region: 'South' },
  '11': { abbr: 'DC', name: 'District of Columbia', region: 'South' },
  '12': { abbr: 'FL', name: 'Florida', region: 'South' },
  '13': { abbr: 'GA', name: 'Georgia', region: 'South' },
  '15': { abbr: 'HI', name: 'Hawaii', region: 'West' },
  '16': { abbr: 'ID', name: 'Idaho', region: 'West' },
  '17': { abbr: 'IL', name: 'Illinois', region: 'Midwest' },
  '18': { abbr: 'IN', name: 'Indiana', region: 'Midwest' },
  '19': { abbr: 'IA', name: 'Iowa', region: 'Midwest' },
  '20': { abbr: 'KS', name: 'Kansas', region: 'Midwest' },
  '21': { abbr: 'KY', name: 'Kentucky', region: 'South' },
  '22': { abbr: 'LA', name: 'Louisiana', region: 'South' },
  '23': { abbr: 'ME', name: 'Maine', region: 'Northeast' },
  '24': { abbr: 'MD', name: 'Maryland', region: 'South' },
  '25': { abbr: 'MA', name: 'Massachusetts', region: 'Northeast' },
  '26': { abbr: 'MI', name: 'Michigan', region: 'Midwest' },
  '27': { abbr: 'MN', name: 'Minnesota', region: 'Midwest' },
  '28': { abbr: 'MS', name: 'Mississippi', region: 'South' },
  '29': { abbr: 'MO', name: 'Missouri', region: 'Midwest' },
  '30': { abbr: 'MT', name: 'Montana', region: 'West' },
  '31': { abbr: 'NE', name: 'Nebraska', region: 'Midwest' },
  '32': { abbr: 'NV', name: 'Nevada', region: 'West' },
  '33': { abbr: 'NH', name: 'New Hampshire', region: 'Northeast' },
  '34': { abbr: 'NJ', name: 'New Jersey', region: 'Northeast' },
  '35': { abbr: 'NM', name: 'New Mexico', region: 'West' },
  '36': { abbr: 'NY', name: 'New York', region: 'Northeast' },
  '37': { abbr: 'NC', name: 'North Carolina', region: 'South' },
  '38': { abbr: 'ND', name: 'North Dakota', region: 'Midwest' },
  '39': { abbr: 'OH', name: 'Ohio', region: 'Midwest' },
  '40': { abbr: 'OK', name: 'Oklahoma', region: 'South' },
  '41': { abbr: 'OR', name: 'Oregon', region: 'West' },
  '42': { abbr: 'PA', name: 'Pennsylvania', region: 'Northeast' },
  '44': { abbr: 'RI', name: 'Rhode Island', region: 'Northeast' },
  '45': { abbr: 'SC', name: 'South Carolina', region: 'South' },
  '46': { abbr: 'SD', name: 'South Dakota', region: 'Midwest' },
  '47': { abbr: 'TN', name: 'Tennessee', region: 'South' },
  '48': { abbr: 'TX', name: 'Texas', region: 'South' },
  '49': { abbr: 'UT', name: 'Utah', region: 'West' },
  '50': { abbr: 'VT', name: 'Vermont', region: 'Northeast' },
  '51': { abbr: 'VA', name: 'Virginia', region: 'South' },
  '53': { abbr: 'WA', name: 'Washington', region: 'West' },
  '54': { abbr: 'WV', name: 'West Virginia', region: 'South' },
  '55': { abbr: 'WI', name: 'Wisconsin', region: 'Midwest' },
  '56': { abbr: 'WY', name: 'Wyoming', region: 'West' }
};

// Deterministic prototype hash matching entire_website.html line 1064
export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1e6) / 1e6;
}

export function getCalculatedStateCoverage(st: string): number {
  return Math.max(82, Math.min(99.9, 99.6 - hashString('cov' + st) * 9 - (st === '02' ? 6 : 0)));
}

export const STATE_COVERAGE: Record<string, { name: string; abbr: string; cov: number }> = {};
Object.entries(STATE_META).forEach(([st, meta]) => {
  STATE_COVERAGE[st] = {
    name: meta.name,
    abbr: meta.abbr,
    cov: Number(getCalculatedStateCoverage(st).toFixed(1))
  };
});

// Color ramp for layer: 'access'
export const ACCESS_RAMP = ['#C6EAF7', '#7FC6F2', '#3B97E6', '#1F63C6', '#143F86'];
export const MAP_LOW = '#101B45';

export function computeCoverageScale(values: number[]) {
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
    d3.interpolateRgb(MAP_LOW, ACCESS_RAMP[0])(0.6),
    ...ACCESS_RAMP
  ]);
  const q = d3.scaleQuantile().domain(values).range(d3.range(7));
  // bad: 'low' -> flip ramp
  const tOf = (i: number) => 1 - (i + 0.5) / 7;
  const fn = (v: number) => interp(tOf(q(v)));
  const bins = d3.range(7).map(i => interp(tOf(i)));
  const ext = d3.extent(values) as [number, number];
  return { fn, bins, ext: ext[0] != null ? ext : [82, 99.9] };
}

let topoCache: any = null;

export function StateCoverageMap({ height = 360, coverageOverrides, onSelectState }: StateCoverageMapProps) {
  const d3ContainerRef = useRef<HTMLDivElement>(null);
  const onSelectStateRef = useRef(onSelectState);
  onSelectStateRef.current = onSelectState;

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    countyName: string;
    stateName: string;
    cov: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
    countyName: '',
    stateName: '',
    cov: 0
  });

  // Calculate coverage for all states
  const stateCovMap = useMemo(() => {
    const map: Record<string, number> = {};
    Object.keys(STATE_META).forEach(st => {
      map[st] = coverageOverrides?.[st] ?? STATE_COVERAGE[st]?.cov ?? getCalculatedStateCoverage(st);
    });
    return map;
  }, [coverageOverrides]);

  const stateCovMapRef = useRef(stateCovMap);
  stateCovMapRef.current = stateCovMap;

  const colorScale = useMemo(() => {
    return computeCoverageScale(Object.values(stateCovMap));
  }, [stateCovMap]);

  const colorScaleRef = useRef(colorScale);
  colorScaleRef.current = colorScale;

  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!d3ContainerRef.current) return;
      const container = d3ContainerRef.current;
      container.innerHTML = '';

      if (!topoCache) {
        try {
          const res = await fetch('/us-counties.json');
          if (!res.ok) throw new Error('Failed to load map geometry');
          topoCache = await res.json();
        } catch (err) {
          console.error('[StateCoverageMap] Error loading topojson:', err);
          return;
        }
      }

      if (!isMounted || !topoCache || !d3ContainerRef.current) return;

      const pathGen = d3.geoPath();
      const counties = (topojson.feature(topoCache, topoCache.objects.counties) as any).features;
      const stateMesh = topojson.mesh(topoCache, topoCache.objects.states, (a: any, b: any) => a !== b);
      const nationMesh = topojson.mesh(topoCache, topoCache.objects.nation);

      const svg = d3
        .select(container)
        .append('svg')
        .attr('class', 'map-svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('role', 'img')
        .attr('aria-label', 'Interactive county map of the United States')
        .style('width', '100%')
        .style('height', '100%')
        .style('display', 'block');

      const g = svg.append('g');
      const gC = g.append('g').attr('class', 'counties-group');
      const gB = g.append('g').attr('class', 'borders-group');

      // Draw all counties
      const countyPaths = gC
        .selectAll<SVGPathElement, any>('path.county')
        .data(counties, (d: any) => d.id)
        .enter()
        .append('path')
        .attr('class', 'county')
        .attr('d', (d: any) => pathGen(d) || '')
        .attr('fill', (d: any) => {
          const st = String(d.id).slice(0, 2);
          const cov = stateCovMapRef.current[st] ?? 92.0;
          return colorScaleRef.current.fn(cov);
        })
        .attr('stroke', 'var(--map-line)')
        .attr('stroke-width', 0.45)
        .attr('vector-effect', 'non-scaling-stroke');

      // State boundaries
      gB.append('path')
        .datum(stateMesh)
        .attr('class', 'state-b')
        .attr('d', pathGen as any);

      // Nation boundary
      gB.append('path')
        .datum(nationMesh)
        .attr('class', 'nation-b')
        .attr('d', pathGen as any);

      // Zoom configuration matching prototype line 1389
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 90])
        .translateExtent([
          [-200, -200],
          [1175, 810]
        ])
        .on('zoom', event => {
          g.attr('transform', event.transform);
        });

      svg.call(zoom).on('dblclick.zoom', null);

      // Pointer interactions
      countyPaths
        .on('pointerenter', function (event, d: any) {
          const st = String(d.id).slice(0, 2);
          const stInfo = STATE_META[st] || { name: `State ${st}`, abbr: st };
          const covVal = stateCovMapRef.current[st] ?? 92.0;
          const countyName = d.properties?.name ? `${d.properties.name} County` : `FIPS ${d.id}`;

          const cRect = container.getBoundingClientRect();
          setTooltip({
            visible: true,
            x: event.clientX - cRect.left + 12,
            y: event.clientY - cRect.top - 12,
            countyName,
            stateName: stInfo.name,
            cov: covVal
          });
        })
        .on('pointermove', function (event) {
          const cRect = container.getBoundingClientRect();
          setTooltip(prev => ({
            ...prev,
            x: event.clientX - cRect.left + 12,
            y: event.clientY - cRect.top - 12
          }));
        })
        .on('pointerleave', function () {
          setTooltip(prev => ({ ...prev, visible: false }));
        })
        .on('click', function (event, d: any) {
          event.stopPropagation();
          const st = String(d.id).slice(0, 2);
          const stInfo = STATE_META[st] || { name: `State ${st}`, abbr: st };
          const covVal = stateCovMapRef.current[st] ?? 92.0;
          if (onSelectStateRef.current) {
            onSelectStateRef.current(stInfo.name, covVal);
          }
        });
    }

    initMap();

    return () => {
      isMounted = false;
      if (d3ContainerRef.current) {
        d3ContainerRef.current.innerHTML = '';
      }
    };
  }, []); // Only mount once!

  // Update fills when coverage overrides change
  useEffect(() => {
    if (!d3ContainerRef.current) return;
    d3.select(d3ContainerRef.current)
      .selectAll<SVGPathElement, any>('path.county')
      .attr('fill', (d: any) => {
        const st = String(d.id).slice(0, 2);
        const cov = stateCovMap[st] ?? 92.0;
        return colorScale.fn(cov);
      });
  }, [stateCovMap, colorScale]);

  return (
    <div
      className="relative w-full h-full select-none"
      style={{ minHeight: `${height}px` }}
    >
      {/* Isolated D3 Container - React never manages child DOM nodes inside this container */}
      <div ref={d3ContainerRef} className="w-full h-full" style={{ position: 'absolute', inset: 0 }} />

      {/* Floating Tooltip - Sibling of D3 container in React's virtual DOM */}
      {tooltip.visible && (
        <div
          className="map-float pointer-events-none"
          style={{
            position: 'absolute',
            zIndex: 20,
            left: tooltip.x,
            top: tooltip.y,
            padding: '8px 12px',
            fontSize: '12px'
          }}
        >
          <b style={{ display: 'block', fontSize: '13px' }}>{tooltip.stateName}</b>
          <div className="note" style={{ marginTop: '2px' }}>
            {tooltip.countyName}
          </div>
          <div style={{ marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)' }}>Coverage:</span>
            <span className="num" style={{ fontWeight: 700, color: 'var(--cyan)' }}>
              {tooltip.cov.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
