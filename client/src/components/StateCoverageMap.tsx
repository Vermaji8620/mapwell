'use client';

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CountyRecord, getCountyRepository } from '@/utils/countyRepository';

export interface StateCoverageMapProps {
  height?: number;
  coverageOverrides?: Record<string, number>;
  selectedCountyId?: string | null;
  onSelectState?: (stateName: string, covPct: number) => void;
  onSelectCounty?: (county: CountyRecord) => void;
  showControls?: boolean;
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

// State coverage formula matching entire_website.html line 1826:
// COV[st] = clamp(99.6 - hash('cov' + st) * 9 - (st === '02' ? 6 : 0), 82, 99.9)
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

// Color ramp for layer: 'access' matching entire_website.html lines 1084 & 1094-1104
export const ACCESS_RAMP = ['#C6EAF7', '#7FC6F2', '#3B97E6', '#1F63C6', '#143F86'];
export const MAP_LOW = '#101B45';

// Quantile scale with gamma(1.6) piecewise interpolation and flipped ramp for bad: 'low'
export function computeCoverageScale(values: number[]) {
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
    d3.interpolateRgb(MAP_LOW, ACCESS_RAMP[0])(0.6),
    ...ACCESS_RAMP
  ]);
  const q = d3.scaleQuantile().domain(values.length ? values : [86.5, 99.5]).range(d3.range(7));
  // bad: 'low' -> flip ramp: higher coverage gets calm light blue, lower coverage gets deep blue
  const tOf = (i: number) => 1 - (i + 0.5) / 7;
  const fn = (v: number) => interp(tOf(q(v)));
  const bins = d3.range(7).map(i => interp(tOf(i)));
  const ext = (values.length ? d3.extent(values) : [86.5, 99.5]) as [number, number];
  return { fn, bins, ext: ext[0] != null ? ext : [86.5, 99.5] };
}

// Global cached geometry & topology
let cachedTopo: any = null;
let cachedMesh: { stateMesh: any; nationMesh: any } | null = null;

// Tooltip helpers matching standard MapWell prototype
function showGlobalTip(html: string, e: MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  moveGlobalTip(e);
}

function moveGlobalTip(e: MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t || !e) return;
  const w = t.offsetWidth || 180;
  const h = t.offsetHeight || 90;
  let x = e.clientX + 16;
  let y = e.clientY + 14;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}

function hideGlobalTip() {
  const t = document.getElementById('tooltip');
  if (t) t.classList.remove('on');
}

const fmt = {
  k: (v: number) =>
    v >= 1e6
      ? (v / 1e6).toFixed(1) + 'M'
      : v >= 1e3
      ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k'
      : Math.round(v) + ''
};

export function StateCoverageMap({
  height = 360,
  coverageOverrides,
  selectedCountyId = null,
  onSelectState,
  onSelectCounty,
  showControls = false
}: StateCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomRootRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gCountiesRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gBoundariesRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gSelRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const pathGenRef = useRef<d3.GeoPath<any, d3.GeoPermissibleObjects> | null>(null);
  const countiesListRef = useRef<CountyRecord[]>([]);

  const selectedCidRef = useRef<string | null>(selectedCountyId);
  selectedCidRef.current = selectedCountyId;

  const onSelectStateRef = useRef(onSelectState);
  onSelectStateRef.current = onSelectState;
  const onSelectCountyRef = useRef(onSelectCounty);
  onSelectCountyRef.current = onSelectCounty;

  // Fallback floating tooltip if #tooltip is not yet present
  const [localTooltip, setLocalTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    html: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    html: ''
  });

  // Calculate coverage for all states, using prototype formula unless valid varied overrides are supplied
  const stateCovMap = useMemo(() => {
    const map: Record<string, number> = {};
    const hasValidOverrides =
      coverageOverrides &&
      Object.keys(coverageOverrides).length > 0 &&
      !Object.values(coverageOverrides).every(v => v === 100);

    Object.keys(STATE_META).forEach(st => {
      map[st] = hasValidOverrides && coverageOverrides[st] != null
        ? coverageOverrides[st]
        : (STATE_COVERAGE[st]?.cov ?? getCalculatedStateCoverage(st));
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

  // Zoom to county bounding box with pad = 0.7 matching prototype line 1374
  const zoomToCounty = useCallback((county: CountyRecord | null, animate = true) => {
    const svg = svgRef.current;
    const zoom = zoomBehaviorRef.current;
    const pathGen = pathGenRef.current;
    const gSel = gSelRef.current;
    const gC = gCountiesRef.current;
    if (!svg || !zoom || !pathGen || !gSel || !gC) return;

    const isRM =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!county) {
      selectedCidRef.current = null;
      gC.selectAll<SVGPathElement, CountyRecord>('path.county').classed('sel', false);
      gSel.selectAll('*').remove();

      if (animate && !isRM) {
        svg.transition()
          .duration(900)
          .ease(d3.easeCubicInOut)
          .call(zoom.transform, d3.zoomIdentity);
      } else {
        svg.call(zoom.transform, d3.zoomIdentity);
      }
      return;
    }

    selectedCidRef.current = county.id;

    // 1. Highlight clicked county with .sel class
    gC.selectAll<SVGPathElement, CountyRecord>('path.county')
      .classed('sel', (d: CountyRecord) => d.id === county.id);

    // 2. Glowing cyan outline (.sel-outline) matching prototype line 1379
    gSel.selectAll('*').remove();
    const countyD = county.d || pathGen(county.feature) || '';
    gSel.append('path')
      .attr('class', 'sel-outline')
      .attr('d', countyD)
      .attr('vector-effect', 'non-scaling-stroke')
      .style('pointer-events', 'none');

    // 3. Compute bounding box and transform with pad = 0.7
    // This centers the focused county and frames all neighbouring counties clearly around it
    const bounds = pathGen.bounds(county.feature);
    const [[x0, y0], [x1, y1]] = bounds;
    const pad = 0.7;
    const s = Math.min(90, pad / Math.max((x1 - x0) / 975, (y1 - y0) / 610));
    const t = d3.zoomIdentity
      .translate(975 / 2, 610 / 2)
      .scale(s)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

    if (animate && !isRM) {
      svg.transition()
        .duration(900)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, t);
    } else {
      svg.call(zoom.transform, t);
    }
  }, []);

  // Zoom control helpers
  const handleZoomBy = useCallback((factor: number) => {
    const svg = svgRef.current;
    const zoom = zoomBehaviorRef.current;
    if (!svg || !zoom) return;
    const isRM =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (isRM) {
      svg.call(zoom.scaleBy, factor);
    } else {
      svg.transition().duration(350).call(zoom.scaleBy, factor);
    }
  }, []);

  const handleResetZoom = useCallback(() => {
    zoomToCounty(null, true);
  }, [zoomToCounty]);

  // Sync external selectedCountyId prop
  useEffect(() => {
    if (selectedCountyId !== undefined && selectedCountyId !== selectedCidRef.current) {
      if (selectedCountyId) {
        const found = countiesListRef.current.find(c => c.id === selectedCountyId);
        if (found) zoomToCounty(found, true);
      } else {
        zoomToCounty(null, true);
      }
    }
  }, [selectedCountyId, zoomToCounty]);

  // Mount and initialize D3 map
  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';
      container.classList.add('map-shell');

      // 1. Skeleton placeholder matching prototype line 1242
      const skel = document.createElement('div');
      skel.className = 'map-skel skeleton';
      container.appendChild(skel);

      // Load repo and topo data
      const [repo, topo] = await Promise.all([
        getCountyRepository(),
        cachedTopo ? Promise.resolve(cachedTopo) : fetch('/us-counties.json').then(r => r.json())
      ]);

      if (!isMounted || !containerRef.current) return;
      cachedTopo = topo;

      if (!cachedMesh) {
        cachedMesh = {
          stateMesh: topojson.mesh(topo, topo.objects.states, (a: any, b: any) => a !== b),
          nationMesh: topojson.feature(topo, topo.objects.nation)
        };
      }

      const pathGen = d3.geoPath();
      pathGenRef.current = pathGen;

      // Ensure path 'd' and centroid 'cx, cy' are computed for each county
      const counties = repo.counties;
      counties.forEach(c => {
        if (!c.d && c.feature) {
          c.d = pathGen(c.feature) || '';
        }
        if ((c as any).cx == null && c.feature) {
          const pt = pathGen.centroid(c.feature);
          (c as any).cx = pt && !isNaN(pt[0]) ? pt[0] : 487;
          (c as any).cy = pt && !isNaN(pt[1]) ? pt[1] : 305;
        }
      });
      countiesListRef.current = counties;

      // 2. SVG element matching prototype line 1244
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

      svgRef.current = svg;

      // Defs (heat gradient and clip-path matching MapView prototype lines 1246-1250)
      const defs = svg.append('defs');
      const uid = 'dm_cov_';
      const rg = defs.append('radialGradient').attr('id', uid + 'heat');
      rg.append('stop').attr('offset', '0%').attr('stop-color', '#2584EB').attr('stop-opacity', 0.55);
      rg.append('stop').attr('offset', '55%').attr('stop-color', '#66B6F5').attr('stop-opacity', 0.2);
      rg.append('stop').attr('offset', '100%').attr('stop-color', '#66B6F5').attr('stop-opacity', 0);
      defs.append('clipPath').attr('id', uid + 'clip').append('path');

      // Groups
      const gRoot = svg.append('g').attr('class', 'zoom-root');
      zoomRootRef.current = gRoot;

      const gC = gRoot.append('g').attr('class', 'counties-group');
      const gB = gRoot.append('g').attr('class', 'borders-group');
      const gSel = gRoot.append('g').attr('class', 'sel-group');

      gCountiesRef.current = gC;
      gBoundariesRef.current = gB;
      gSelRef.current = gSel;

      const isRM =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // 3. Zoom behavior matching prototype line 1289
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 90])
        .translateExtent([
          [-200, -200],
          [1175, 810]
        ])
        .on('zoom', event => {
          gRoot.attr('transform', event.transform);
        });

      svg.call(zoom).on('dblclick.zoom', null);
      zoomBehaviorRef.current = zoom;

      // Background click resets camera and selection
      svg.on('click', event => {
        if (event.target === svg.node() || (event.target as HTMLElement).tagName === 'svg') {
          zoomToCounty(null, true);
        }
      });

      // 4. Counties rendering with west-to-east sweep animation
      const countyPaths = gC
        .selectAll<SVGPathElement, CountyRecord>('path.county')
        .data(counties, (d: CountyRecord) => d.id)
        .enter()
        .append('path')
        .attr('class', (d: CountyRecord) => `county ${d.id === selectedCidRef.current ? 'sel' : ''}`)
        .attr('data-id', (d: CountyRecord) => d.id)
        .attr('d', (d: CountyRecord) => d.d || pathGen(d.feature) || '')
        .attr('stroke', 'var(--map-line)')
        .attr('stroke-width', 0.45)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('fill', 'var(--map-low)')
        .attr('opacity', isRM ? 1 : 0);

      // Entrance animation: West-to-east sweep matching prototype line 1406
      if (!isRM) {
        countyPaths
          .transition('in')
          .duration(600)
          .delay((d: any) => (((d.cx || 487) / 975) * 700))
          .ease(d3.easeCubicOut)
          .attr('opacity', 1);

        countyPaths
          .transition('fill')
          .duration(520)
          .delay((d: any) => (((d.cx || 487) / 975) * 650))
          .attr('fill', (d: CountyRecord) => {
            const cov = stateCovMapRef.current[d.st] ?? 92.0;
            return colorScaleRef.current.fn(cov);
          });
      } else {
        countyPaths.attr('fill', (d: CountyRecord) => {
          const cov = stateCovMapRef.current[d.st] ?? 92.0;
          return colorScaleRef.current.fn(cov);
        });
      }

      // 5. State and Nation boundaries with stroke drawing animation matching prototype line 1274
      const sb = gB
        .append('path')
        .datum(cachedMesh.stateMesh)
        .attr('class', 'state-b')
        .attr('d', pathGen as any);

      const nb = gB
        .append('path')
        .datum(cachedMesh.nationMesh)
        .attr('class', 'nation-b')
        .attr('d', pathGen as any);

      if (!isRM) {
        [
          [nb, 0, 1700],
          [sb, 500, 1600]
        ].forEach(([p, delay, dur]: any) => {
          const node = p.node() as SVGGeometryElement | null;
          const L = node && node.getTotalLength ? node.getTotalLength() : 0;
          if (L > 0) {
            p.attr('stroke-dasharray', `${L} ${L}`)
              .attr('stroke-dashoffset', L)
              .transition('draw')
              .delay(delay)
              .duration(dur)
              .ease(d3.easeCubicInOut)
              .attr('stroke-dashoffset', 0)
              .on('end', function (this: any) {
                d3.select(this).attr('stroke-dasharray', null);
              });
          }
        });
      }

      // 6. Pointer interactions: hover tooltip & click to focus county
      countyPaths
        .on('pointerenter', function (event: MouseEvent, d: CountyRecord) {
          const st = d.st;
          const covVal = stateCovMapRef.current[st] ?? 92.0;
          const cLabel = `${d.name} ${['22'].includes(st) ? 'Parish' : ['02'].includes(st) ? 'Borough' : 'County'}, ${d.stateAbbr}`;
          const popStr = fmt.k(d.pop);

          const tipHtml = `<b>${cLabel}</b><div class="tv"><span>Coverage</span><span>${covVal.toFixed(1)}%</span></div><div class="tv"><span>Vulnerability</span><span>${(d.svi ?? 0.5).toFixed(2)}</span></div><div class="tv"><span>Population</span><span>${popStr}</span></div><div class="note" style="margin-top:5px">Synthetic demo values</div>`;

          showGlobalTip(tipHtml, event);

          const cRect = container.getBoundingClientRect();
          setLocalTooltip({
            visible: true,
            x: event.clientX - cRect.left + 14,
            y: event.clientY - cRect.top - 12,
            html: tipHtml
          });
        })
        .on('pointermove', function (event: MouseEvent) {
          moveGlobalTip(event);
          const cRect = container.getBoundingClientRect();
          setLocalTooltip(prev => ({
            ...prev,
            x: event.clientX - cRect.left + 14,
            y: event.clientY - cRect.top - 12
          }));
        })
        .on('pointerleave', function () {
          hideGlobalTip();
          setLocalTooltip(prev => ({ ...prev, visible: false }));
        })
        .on('click', function (event: MouseEvent, d: CountyRecord) {
          event.stopPropagation();
          const isAlreadySelected = selectedCidRef.current === d.id;

          if (isAlreadySelected) {
            zoomToCounty(null, true);
          } else {
            zoomToCounty(d, true);

            const st = d.st;
            const covVal = stateCovMapRef.current[st] ?? 92.0;
            const stInfo = STATE_META[st] || { name: `State ${st}`, abbr: st };

            if (onSelectStateRef.current) {
              onSelectStateRef.current(stInfo.name, covVal);
            }
            if (onSelectCountyRef.current) {
              onSelectCountyRef.current(d);
            }
          }
        });

      // Remove skeleton loader after entrance duration
      setTimeout(() => {
        if (!isMounted) return;
        skel.classList.add('done');
        setTimeout(() => {
          if (skel.parentNode) skel.remove();
        }, 700);
      }, isRM ? 0 : 450);

      // If initial selectedCountyId was supplied, zoom to it
      if (selectedCidRef.current) {
        const found = counties.find(c => c.id === selectedCidRef.current);
        if (found) {
          zoomToCounty(found, false);
        }
      }
    }

    initMap();

    return () => {
      isMounted = false;
      hideGlobalTip();
      if (svgRef.current) {
        svgRef.current.interrupt();
        svgRef.current.selectAll('*').interrupt();
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [zoomToCounty]);

  // Update county fills smoothly when coverageOverrides changes
  useEffect(() => {
    if (!gCountiesRef.current) return;
    const isRM =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const sel = gCountiesRef.current.selectAll<SVGPathElement, CountyRecord>('path.county');
    if (isRM) {
      sel.attr('fill', (d: CountyRecord) => {
        const cov = stateCovMap[d.st] ?? 92.0;
        return colorScale.fn(cov);
      });
    } else {
      sel.transition('fill-update')
        .duration(450)
        .attr('fill', (d: CountyRecord) => {
          const cov = stateCovMap[d.st] ?? 92.0;
          return colorScale.fn(cov);
        });
    }
  }, [stateCovMap, colorScale]);

  return (
    <div
      className="relative w-full h-full select-none"
      style={{ minHeight: `${height}px`, width: '100%', height: '100%' }}
    >
      {/* Isolated D3 Container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
      />

      {/* Floating Zoom & Camera Reset Controls (optional, hidden by default to match prototype) */}
      {showControls && (
        <div
          className="map-float map-ctrls"
          style={{
            position: 'absolute',
            right: 14,
            top: 14,
            zIndex: 10
          }}
          role="toolbar"
          aria-label="Map camera controls"
        >
          <button
            type="button"
            className="icon-btn"
            title="Zoom in (+)"
            aria-label="Zoom in"
            onClick={() => handleZoomBy(1.6)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Zoom out (-)"
            aria-label="Zoom out"
            onClick={() => handleZoomBy(1 / 1.6)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Reset view (⟲)"
            aria-label="Reset map view"
            onClick={handleResetZoom}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
      )}

      {/* Fallback floating tooltip if global #tooltip is not available */}
      {localTooltip.visible && typeof document !== 'undefined' && !document.getElementById('tooltip') && (
        <div
          className="map-float pointer-events-none"
          style={{
            position: 'absolute',
            zIndex: 200,
            left: localTooltip.x,
            top: localTooltip.y,
            padding: '10px 12px',
            fontSize: '12px'
          }}
          dangerouslySetInnerHTML={{ __html: localTooltip.html }}
        />
      )}
    </div>
  );
}
