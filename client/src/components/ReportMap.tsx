'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';

export interface ReportScaleInfo {
  bins: string[];
  lo: string;
  hi: string;
  title: string;
  note: string;
}

export interface ReportMapProps {
  countyFips: string;
  tracts: CensusTract[];
  metric?: string;
  focusTractIds?: string[];
  height?: number;
  onScaleReady?: (scale: ReportScaleInfo) => void;
}

let topoCache: any = null;

// Tooltip helpers matching standard MapWell #tooltip
function showTip(html: string, e: MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  moveTip(e);
}

function moveTip(e: MouseEvent) {
  const t = document.getElementById('tooltip');
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
  const t = document.getElementById('tooltip');
  if (t) t.classList.remove('on');
}

const tipRows = (rows: [string, string][]) =>
  rows.map(([a, b]) => `<div class="tv"><span>${a}</span><span>${b}</span></div>`).join('');

const TIER_LABEL = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];

const LAYER_RAMPS: Record<string, string[]> = {
  sdoh: ['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'],
  disease: ['#BDEFF0', '#37C8CF', '#2A9FD6', '#2565C8', '#173F8A'],
  vuln: ['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E'],
  access: ['#C2ECE4', '#55C2B6', '#1E9895', '#166E73', '#0E444B']
};

function layerOf(key: string): string {
  if (['incidence', 'diabetes', 'hypertension', 'asthma', 'obesity', 'copd'].includes(key)) return 'disease';
  if (['svi'].includes(key)) return 'vuln';
  if (['access', 'uninsured', 'utilization', 'pcp', 'driveTime', 'transit', 'broadband'].includes(key)) return 'access';
  return 'sdoh';
}

function getV(rec: any, key: string): number {
  if (!rec) return 0;
  if (key.startsWith('prog.')) return rec.prog?.[key.slice(5)] ?? 50;
  const val = rec.indicators?.[key] ?? rec[key];
  if (typeof val === 'number') return val;
  if (key === 'svi') return rec.svi ?? 0.5;
  if (key === 'pop' || key === 'population') return rec.population ?? rec.pop ?? 4000;
  if (key === 'uninsured') return rec.indicators?.uninsured ?? rec.uninsured ?? 10.5;
  return 0;
}

function fmtVal(key: string, v: number): string {
  if (key === 'svi') return v.toFixed(2);
  if (['diabetes', 'hypertension', 'asthma', 'obesity', 'copd', 'poverty', 'childPoverty', 'uninsured', 'rentBurden', 'noVehicle', 'oldHousing', 'crowding', 'unemployment', 'noDiploma', 'bachelors', 'lfp'].includes(key)) {
    return v.toFixed(1) + '%';
  }
  if (['sdoh', 'access', 'incidence', 'pcp'].includes(key)) {
    return v.toFixed(0);
  }
  if (['utilization', 'broadband', 'transit'].includes(key)) {
    return v.toFixed(0) + '%';
  }
  if (['commute', 'driveTime'].includes(key)) {
    return v.toFixed(0) + ' min';
  }
  if (key === 'lifeExp') {
    return v.toFixed(1) + ' yrs';
  }
  if (key === 'income') {
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  if (key === 'pop' || key === 'population') {
    return Math.round(v).toLocaleString('en-US');
  }
  return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
}

const METRIC_SHORTS: Record<string, string> = {
  svi: 'Vulnerability',
  sdoh: 'SDOH burden',
  poverty: 'Poverty',
  childPoverty: 'Child poverty',
  income: 'Median income',
  rentBurden: 'Rent burden',
  oldHousing: 'Pre-1960 housing',
  crowding: 'Crowding',
  noVehicle: 'No vehicle',
  transit: 'Transit access',
  commute: 'Commute',
  noDiploma: 'No diploma',
  bachelors: "Bachelor's+",
  broadband: 'Broadband',
  unemployment: 'Unemployment',
  lfp: 'Labor force',
  uninsured: 'Uninsured',
  pcp: 'PCP per 100k',
  driveTime: 'Clinic drive time',
  access: 'Access score',
  diabetes: 'Diabetes',
  asthma: 'Asthma',
  hypertension: 'Hypertension',
  obesity: 'Obesity',
  copd: 'COPD',
  incidence: 'Disease burden',
  utilization: 'Utilization',
  lifeExp: 'Life expectancy',
  pop: 'Population'
};

export function ReportMap({
  countyFips,
  tracts,
  metric = 'svi',
  focusTractIds = [],
  height = 280,
  onScaleReady
}: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
      const states = (topojson.feature(topoCache, topoCache.objects.states) as any).features;

      const targetCounty =
        counties.find((c: any) => c.id === countyFips) ||
        counties.find((c: any) => c.id === '53033') ||
        counties[0];

      if (!targetCounty) return;

      const statePrefix = targetCounty.id ? targetCounty.id.slice(0, 2) : '53';
      const stateCounties = counties.filter((c: any) => c.id && c.id.slice(0, 2) === statePrefix);
      const stateFeature = states.find((s: any) => s.id === statePrefix || s.id.toString().padStart(2, '0') === statePrefix);

      const pathGen = d3.geoPath();
      const countyD = pathGen(targetCounty) || '';
      const [[x0, y0], [x1, y1]] = pathGen.bounds(targetCounty);
      const countyWidth = Math.max(x1 - x0, 10);
      const countyHeight = Math.max(y1 - y0, 10);

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'map-svg dim-others')
        .attr('role', 'img')
        .attr('aria-label', 'Interactive county map of the United States')
        .style('width', '100%')
        .style('height', '100%')
        .style('display', 'block')
        .style('background', 'transparent');

      const defs = svg.append('defs');
      const clipId = `rp-clip-${countyFips}-${Math.random().toString(36).substring(2, 6)}`;

      defs.append('clipPath')
        .attr('id', clipId)
        .append('path')
        .attr('d', countyD);

      const mainGroup = svg.append('g').attr('class', 'map-root');

      // 1. Ambient surrounding state counties (.county) with dim-others
      const gC = mainGroup.append('g').attr('class', 'state-counties');
      gC.selectAll<SVGPathElement, any>('path.county')
        .data(stateCounties, (d: any) => d.id)
        .join('path')
        .attr('class', (d: any) => `county ${d.id === countyFips ? 'sel' : ''}`)
        .attr('d', (d: any) => pathGen(d))
        .attr('fill', 'var(--map-low)')
        .attr('stroke', 'var(--map-line)')
        .attr('stroke-width', 0.45)
        .attr('vector-effect', 'non-scaling-stroke')
        .on('pointerenter', function (event, d: any) {
          if (d.id === countyFips) return;
          showTip(
            `<b>${d.properties?.name || 'County'} County</b>${tipRows([['FIPS', d.id]])}<div class="note" style="margin-top:5px">Synthetic demo values</div>`,
            event
          );
        })
        .on('pointermove', moveTip)
        .on('pointerleave', hideTip);

      // 2. State boundary (.nation-b)
      if (stateFeature) {
        mainGroup.append('g')
          .attr('class', 'state-boundary')
          .append('path')
          .attr('class', 'nation-b')
          .attr('d', pathGen(stateFeature) || '')
          .attr('fill', 'none')
          .attr('stroke', 'var(--cyan)')
          .attr('stroke-width', 1.2)
          .attr('stroke-opacity', 0.35)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('pointer-events', 'none');
      }

      // 3. Clipped Tracts Group (.tract, .cmp)
      const tractGroup = mainGroup.append('g').attr('class', 'tracts-group').attr('clip-path', `url(#${clipId})`);

      // 4. Selected County glowing outline (.sel-outline)
      mainGroup.append('g')
        .attr('class', 'target-county-outline')
        .append('path')
        .attr('class', 'sel-outline')
        .attr('d', countyD)
        .attr('fill', 'none')
        .attr('stroke', 'var(--cyan)')
        .attr('stroke-width', 1.8)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('filter', 'drop-shadow(0 0 6px var(--cyan))')
        .style('pointer-events', 'none');

      // Auto-fit camera to target county bounds matching prototype zoomToCounty
      const padding = 0.72;
      const s = Math.min(28, padding / Math.max(countyWidth / 975, countyHeight / 610));
      const initialTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(s)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

      mainGroup.attr('transform', initialTransform.toString());

      if (tracts.length === 0) return;

      // Color Scale matching prototype colorScale()
      const ramp = LAYER_RAMPS[layerOf(metric)] || LAYER_RAMPS.sdoh;
      const low = '#101B45';
      const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), [d3.interpolateRgb(low, ramp[0])(0.6), ...ramp]);
      const vals = tracts.map(t => getV(t, metric));
      const q = d3.scaleQuantile().domain(vals.length > 0 ? vals : [0, 1]).range(d3.range(7));
      const badLow = ['income', 'transit', 'broadband', 'lfp', 'pcp', 'access', 'utilization', 'lifeExp'].includes(metric);
      const tOf = (i: number) => {
        const t = (i + 0.5) / 7;
        return badLow ? 1 - t : t;
      };
      const colorFn = (v: number) => interp(tOf(q(v)));
      const bins = d3.range(7).map(i => interp(tOf(i)));
      const ext = d3.extent(vals) as [number, number];

      if (onScaleReady) {
        onScaleReady({
          bins,
          lo: fmtVal(metric, ext[0] ?? 0),
          hi: fmtVal(metric, ext[1] ?? 1),
          title: METRIC_SHORTS[metric] || metric,
          note: 'Tracts'
        });
      }

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
      const paths = tractGroup.selectAll<SVGPathElement, CensusTract>('path.tract')
        .data(tracts)
        .enter()
        .append('path')
        .attr('class', t => `tract ${focusSet.has(t._id) ? 'cmp' : ''}`)
        .attr('d', (_, i) => voronoi.renderCell(i) || '')
        .attr('data-id', t => t._id)
        .attr('fill', t => colorFn(getV(t, metric)))
        .attr('stroke', t => (focusSet.has(t._id) ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)'))
        .attr('stroke-width', t => (focusSet.has(t._id) ? 2.2 : 0.65))
        .attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer');

      // Staggered boundary sweep animation matching prototype drawTracts
      paths.attr('opacity', 0)
        .transition('tin')
        .delay((_, i) => 200 + i * 12)
        .duration(400)
        .attr('opacity', 1);

      paths.each(function () {
        const elNode = this as SVGPathElement;
        const L = elNode.getTotalLength ? elNode.getTotalLength() : 100;
        d3.select(this)
          .attr('stroke-dasharray', `${L} ${L}`)
          .attr('stroke-dashoffset', L);
      })
      .transition('tdraw')
      .delay((_, i) => 160 + i * 12)
      .duration(800)
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0)
      .on('end', function () {
        d3.select(this).attr('stroke-dasharray', null);
      });

      paths
        .on('pointerenter', function (event: MouseEvent, t) {
          d3.select(this)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 2.6)
            .raise();

          const val = getV(t, metric);
          const tier = t.tier ?? Math.min(4, Math.floor(t.svi * 5));
          const metricLabel = METRIC_SHORTS[metric] || metric;

          showTip(
            `<b>${t.name}</b>${tipRows([
              ['GEOID', t._id],
              [metricLabel, fmtVal(metric, val)],
              ['Vulnerability tier', TIER_LABEL[tier] || 'Moderate'],
              ['Population', (t.population || 4000).toLocaleString('en-US')]
            ])}`,
            event
          );
        })
        .on('pointermove', function (event: MouseEvent) {
          moveTip(event);
        })
        .on('pointerleave', function (_, t) {
          const isFocus = focusSet.has(t._id);
          d3.select(this)
            .attr('stroke', isFocus ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)')
            .attr('stroke-width', isFocus ? 2.2 : 0.65);
          hideTip();
        });
    }

    renderMap();

    return () => {
      isMounted = false;
      hideTip();
    };
  }, [countyFips, tracts, metric, focusTractIds, height]);

  return (
    <div
      ref={containerRef}
      className="map-shell w-full h-full select-none"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    />
  );
}
