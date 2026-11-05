'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { METRICS_CONFIG } from '@/config/metrics';
import { CountyRecord, getCountyRepository, STATE_META } from '@/utils/countyRepository';

export interface TemporalDiseaseMapProps {
  scopeSt: string | null; // null for Nation, or stateFips (e.g. '53', '27')
  condition: string;
  yearIndex: number;
  years: string[];
  selectedCountyId?: string | null;
  onSelectCounty?: (county: CountyRecord) => void;
  countyTrends: Map<string, number[]>;
  isPlaying?: boolean;
}

// Authentic Disease Incidence Layer Ramp matching local prototype (lines 1082 & 1094-1104)
export const DISEASE_RAMP = ['#BDEFF0', '#37C8CF', '#2A9FD6', '#2565C8', '#173F8A'];
export const DISEASE_LOW = '#101B45';

export function createDiseaseColorScale(allValues: number[]) {
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
    d3.interpolateRgb(DISEASE_LOW, DISEASE_RAMP[0])(0.6),
    ...DISEASE_RAMP
  ]);
  const qScale = d3.scaleQuantile().domain(allValues.length ? allValues : [5, 25]).range(d3.range(7));
  const getColor = (val: number) => {
    const bin = qScale(val);
    const t = (bin + 0.5) / 7;
    return interp(t);
  };
  const bins = d3.range(7).map(i => interp((i + 0.5) / 7));
  const extent = (allValues.length ? d3.extent(allValues) : [5, 25]) as [number, number];
  return { getColor, bins, extent, qScale };
}

// Tooltip helpers matching prototype lines 1316-1321
const TIP = { el: null as HTMLElement | null };

function showTip(html: string, e: MouseEvent) {
  const t = TIP.el || (TIP.el = document.getElementById('tooltip'));
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  moveTip(e);
}

function moveTip(e: MouseEvent) {
  const t = TIP.el || (TIP.el = document.getElementById('tooltip'));
  if (!t || !e) return;
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  let x = e.clientX + 16;
  let y = e.clientY + 14;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}

function hideTip() {
  const t = TIP.el || (TIP.el = document.getElementById('tooltip'));
  if (t) t.classList.remove('on');
}

function showToast(msg: string, action?: { label: string; fn: () => void }) {
  const container = document.getElementById('toasts');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><span>${msg}</span>${action ? `<button class="btn sm">${action.label}</button>` : ''}`;
  if (action) {
    const btn = t.querySelector('button');
    if (btn) btn.onclick = () => { action.fn(); t.remove(); };
  }
  container.appendChild(t);
  setTimeout(() => { t.remove(); }, 4200);
}

let cachedGeoData: {
  stateMeshD: string;
  nationD: string;
  statesById: Map<string, { id: string; d: string; feature: any; name: string }>;
} | null = null;

async function getGeoData() {
  if (cachedGeoData) return cachedGeoData;
  const res = await fetch('/us-counties.json');
  const geo = await res.json();
  const path = d3.geoPath();
  const stateMesh = topojson.mesh(geo, geo.objects.states, (a: any, b: any) => a !== b);
  const nation = topojson.feature(geo, geo.objects.nation);
  const stateFeatures = (topojson.feature(geo, geo.objects.states) as any).features;
  const statesById = new Map<string, { id: string; d: string; feature: any; name: string }>();

  stateFeatures.forEach((f: any) => {
    const st = f.id.toString().padStart(2, '0');
    const meta = STATE_META[st];
    statesById.set(st, {
      id: st,
      d: path(f) || '',
      feature: f,
      name: meta ? meta[1] : `State ${st}`
    });
  });

  cachedGeoData = {
    stateMeshD: path(stateMesh) || '',
    nationD: path(nation) || '',
    statesById
  };
  return cachedGeoData;
}

export function TemporalDiseaseMap({
  scopeSt,
  condition,
  yearIndex,
  years,
  selectedCountyId,
  onSelectCounty,
  countyTrends,
  isPlaying = false
}: TemporalDiseaseMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomRootRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gCountiesRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gBoundariesRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gSelRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const gMarkersRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const activeCountiesRef = useRef<CountyRecord[]>([]);

  const conditionRef = useRef(condition);
  conditionRef.current = condition;
  const yearIndexRef = useRef(yearIndex);
  yearIndexRef.current = yearIndex;
  const countyTrendsRef = useRef(countyTrends);
  countyTrendsRef.current = countyTrends;
  const selectedCountyIdRef = useRef(selectedCountyId);
  selectedCountyIdRef.current = selectedCountyId;
  const onSelectCountyRef = useRef(onSelectCounty);
  onSelectCountyRef.current = onSelectCounty;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Initialize and build the SVG map (runs on mount and when scopeSt changes)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let isCancelled = false;

    async function init() {
      const [repo, geoData] = await Promise.all([getCountyRepository(), getGeoData()]);
      if (isCancelled || !container) return;

      container.innerHTML = '';
      container.classList.add('map-shell');

      const width = 975;
      const height = 610;
      const path = d3.geoPath();

      const activePool = scopeSt ? repo.countiesByState.get(scopeSt) || [] : repo.counties;
      activePool.forEach(c => {
        if (!c.d && c.feature) {
          c.d = path(c.feature) || '';
        }
      });
      activeCountiesRef.current = activePool;

      const svg = d3.select(container)
        .append('svg')
        .attr('class', 'map-svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('role', 'img')
        .attr('aria-label', 'Interactive county map of the United States');

      svgRef.current = svg;

      const defs = svg.append('defs');
      const rg = defs.append('radialGradient').attr('id', 'di-heat');
      rg.append('stop').attr('offset', '0%').attr('stop-color', '#2584EB').attr('stop-opacity', 0.55);
      rg.append('stop').attr('offset', '55%').attr('stop-color', '#66B6F5').attr('stop-opacity', 0.2);
      rg.append('stop').attr('offset', '100%').attr('stop-color', '#66B6F5').attr('stop-opacity', 0);

      const gRoot = svg.append('g').attr('class', 'zoom-root');
      zoomRootRef.current = gRoot;

      const gC = gRoot.append('g').attr('class', 'counties-group');
      const gB = gRoot.append('g').attr('class', 'boundaries-group');
      const gSel = gRoot.append('g').attr('class', 'sel-group');
      const gM = gRoot.append('g').attr('class', 'markers-group').style('pointer-events', 'none');

      gCountiesRef.current = gC;
      gBoundariesRef.current = gB;
      gSelRef.current = gSel;
      gMarkersRef.current = gM;

      // Boundaries matching prototype lines 1370-1372
      if (scopeSt && geoData.statesById.has(scopeSt)) {
        const stateObj = geoData.statesById.get(scopeSt)!;
        gB.append('path').attr('class', 'nation-b').attr('d', stateObj.d);
      } else {
        gB.append('path').attr('class', 'state-b').attr('d', geoData.stateMeshD);
        gB.append('path').attr('class', 'nation-b').attr('d', geoData.nationD);
      }

      // Compute fixed disease domain across all 10 years
      const allVals: number[] = [];
      activePool.forEach(c => {
        const t = countyTrendsRef.current.get(c.id);
        if (t) allVals.push(...t);
        else allVals.push((c.indicators as any)[conditionRef.current] ?? 10);
      });
      const { getColor } = createDiseaseColorScale(allVals);

      // Render County Paths
      const curYi = yearIndexRef.current;
      const curCond = conditionRef.current;

      const paths = gC.selectAll('path.county')
        .data(activePool, (d: any) => d.id)
        .enter()
        .append('path')
        .attr('class', (d: CountyRecord) => `county ${d.id === selectedCountyIdRef.current ? 'sel' : ''}`)
        .attr('data-id', (d: CountyRecord) => d.id)
        .attr('d', (d: CountyRecord) => d.d || path(d.feature))
        .attr('fill', (d: CountyRecord) => {
          const t = countyTrendsRef.current.get(d.id);
          const val = t ? t[curYi] : (d.indicators as any)[curCond] ?? 10;
          return getColor(val);
        });

      // Hover Tooltip
      paths
        .on('pointerenter', (e: MouseEvent, d: CountyRecord) => {
          const activeYi = yearIndexRef.current;
          const activeCond = conditionRef.current;
          const t = countyTrendsRef.current.get(d.id);
          const val = t ? t[activeYi] : (d.indicators as any)[activeCond] ?? 10;
          const m = METRICS_CONFIG[activeCond] || { short: activeCond, unit: '%' };
          const label = `${d.name} ${d.st === '22' ? 'Parish' : d.st === '02' ? 'Borough' : 'County'}, ${d.stateAbbr}`;
          const popStr = d.pop >= 1e6
            ? (d.pop / 1e6).toFixed(1) + 'M'
            : d.pop >= 1e3
            ? (d.pop / 1e3).toFixed(d.pop >= 1e4 ? 0 : 1) + 'k'
            : d.pop.toLocaleString('en-US');

          const tipHtml = `<b>${label}</b><div class="tv"><span>${m.short || m.label || activeCond}</span><span>${val.toFixed(1)}${m.unit || '%'}</span></div><div class="tv"><span>Vulnerability</span><span>${(d.svi ?? 0.5).toFixed(2)}</span></div><div class="tv"><span>Population</span><span>${popStr}</span></div><div class="note" style="margin-top:5px">Synthetic demo values</div>`;
          showTip(tipHtml, e);
        })
        .on('pointermove', (e: MouseEvent) => {
          moveTip(e);
        })
        .on('pointerleave', () => {
          hideTip();
        })
        .on('click', (e: MouseEvent, d: CountyRecord) => {
          e.stopPropagation();
          if (onSelectCountyRef.current) {
            onSelectCountyRef.current(d);
          }
          const activeYi = yearIndexRef.current;
          const activeCond = conditionRef.current;
          const t = countyTrendsRef.current.get(d.id);
          const val = t ? t[activeYi] : (d.indicators as any)[activeCond] ?? 10;
          const m = METRICS_CONFIG[activeCond] || { short: activeCond, unit: '%' };
          const label = `${d.name} ${d.st === '22' ? 'Parish' : d.st === '02' ? 'Borough' : 'County'}, ${d.stateAbbr}`;
          showToast(`${label}: ${val.toFixed(1)}${m.unit || '%'} in ${years[activeYi]}`, {
            label: 'Open in map',
            fn: () => {
              window.location.href = `/health-map?county=${d.id}`;
            }
          });
        });

      // Zoom Behavior
      let currentK = 1;
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 90])
        .translateExtent([[-200, -200], [1175, 810]])
        .on('zoom', (event) => {
          gRoot.attr('transform', event.transform);
          currentK = event.transform.k;
          gM.selectAll('.pulse-m').attr('transform', (d: any) => `translate(${d.x},${d.y}) scale(${1 / currentK})`);
        });

      svg.call(zoom).on('dblclick.zoom', null);
      zoomBehaviorRef.current = zoom;

      // Draw active pulse markers on top counties
      const updatePulseMarkers = () => {
        gM.selectAll('*').remove();
        const sorted = [...activePool].sort((a, b) => {
          const valA = (countyTrendsRef.current.get(a.id)?.[yearIndexRef.current]) ?? 0;
          const valB = (countyTrendsRef.current.get(b.id)?.[yearIndexRef.current]) ?? 0;
          return valB - valA;
        });
        const topCounties = sorted.slice(0, scopeSt ? 4 : 7);
        const pts = topCounties
          .map(c => {
            const centroid = path.centroid(c.feature);
            if (!centroid || isNaN(centroid[0])) return null;
            return { x: centroid[0], y: centroid[1] };
          })
          .filter(Boolean);

        const m = gM.selectAll('g.pulse-m')
          .data(pts)
          .enter()
          .append('g')
          .attr('class', 'pulse-m')
          .attr('transform', (d: any) => `translate(${d.x},${d.y}) scale(${1 / currentK})`);

        m.append('circle').attr('class', 'ring').attr('r', 7);
        m.append('circle').attr('class', 'ring r2').attr('r', 7);
        m.append('circle').attr('class', 'core').attr('r', 3.5);
      };

      updatePulseMarkers();

      // Zoom bounds transition matching prototype zoomBounds
      if (scopeSt && geoData.statesById.has(scopeSt)) {
        const stateObj = geoData.statesById.get(scopeSt)!;
        const [[x0, y0], [x1, y1]] = path.bounds(stateObj.feature);
        const pad = 0.85;
        const s = Math.min(90, pad / Math.max((x1 - x0) / 975, (y1 - y0) / 610));
        const t = d3.zoomIdentity.translate(975 / 2, 610 / 2).scale(s).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
        svg.transition().duration(900).ease(d3.easeCubicInOut).call(zoom.transform, t);
      } else {
        svg.call(zoom.transform, d3.zoomIdentity);
      }
    }

    init();

    return () => {
      isCancelled = true;
      hideTip();
    };
  }, [scopeSt]);

  // Smooth choropleth temporal updates when yearIndex or condition changes
  useEffect(() => {
    if (!svgRef.current || !gCountiesRef.current) return;
    const gC = gCountiesRef.current;
    const gM = gMarkersRef.current;
    const activePool = activeCountiesRef.current;
    if (activePool.length === 0) return;

    const allVals: number[] = [];
    activePool.forEach(c => {
      const t = countyTrends.get(c.id);
      if (t) allVals.push(...t);
      else allVals.push((c.indicators as any)[condition] ?? 10);
    });
    const { getColor } = createDiseaseColorScale(allVals);

    const dur = isPlaying ? 350 : 500;
    gC.selectAll('path.county')
      .transition()
      .duration(dur)
      .ease(d3.easeCubicOut)
      .attr('fill', function (this: any) {
        const id = d3.select(this).attr('data-id');
        const t = countyTrends.get(id);
        const val = t ? t[yearIndex] : 10;
        return getColor(val);
      });

    // Update pulse markers for the updated condition and year
    if (gM) {
      gM.selectAll('*').remove();
      const path = d3.geoPath();
      const sorted = [...activePool].sort((a, b) => {
        const valA = (countyTrends.get(a.id)?.[yearIndex]) ?? 0;
        const valB = (countyTrends.get(b.id)?.[yearIndex]) ?? 0;
        return valB - valA;
      });
      const topCounties = sorted.slice(0, scopeSt ? 4 : 7);
      const pts = topCounties
        .map(c => {
          const centroid = path.centroid(c.feature);
          if (!centroid || isNaN(centroid[0])) return null;
          return { x: centroid[0], y: centroid[1] };
        })
        .filter(Boolean);

      const currentTransform = d3.zoomTransform(svgRef.current.node()!);
      const currentK = currentTransform.k || 1;

      const m = gM.selectAll('g.pulse-m')
        .data(pts)
        .enter()
        .append('g')
        .attr('class', 'pulse-m')
        .attr('transform', (d: any) => `translate(${d.x},${d.y}) scale(${1 / currentK})`);

      m.append('circle').attr('class', 'ring').attr('r', 7);
      m.append('circle').attr('class', 'ring r2').attr('r', 7);
      m.append('circle').attr('class', 'core').attr('r', 3.5);
    }
  }, [yearIndex, condition, countyTrends, isPlaying, scopeSt]);

  // Selected County highlight and zoom
  useEffect(() => {
    if (!svgRef.current || !gCountiesRef.current || !gSelRef.current) return;
    const gC = gCountiesRef.current;
    const gSel = gSelRef.current;
    const activePool = activeCountiesRef.current;

    gC.selectAll('path.county').classed('sel', function (this: any) {
      return d3.select(this).attr('data-id') === selectedCountyId;
    });

    gSel.selectAll('*').remove();

    if (selectedCountyId) {
      const target = activePool.find(c => c.id === selectedCountyId);
      if (target && target.d) {
        gSel.append('path').attr('class', 'sel-outline').attr('d', target.d);
      }
    }
  }, [selectedCountyId]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
