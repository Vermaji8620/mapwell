'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { CountyRecord, getCountyRepository } from '@/utils/countyRepository';

export interface AssessmentTractMapProps {
  countyFips: string;
  tracts: CensusTract[];
  selectedTractIds: string[];
  onToggleTract: (tract: CensusTract) => void;
  height?: number;
}

let topoCache: any = null;
const tractCache = new Map<string, TractItem[]>();

// Tooltip helpers matching standard MapWell #tooltip (entire_website.html lines 1230-1232)
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

// Gaussian random generator matching prototype entire_website.html line 1131
function gauss(r: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

interface TractItem extends CensusTract {
  id?: string;
  d?: string;
  pop?: number;
}

const tractId = (t: any): string => String(t?._id || t?.id || '');

function generateTractsForCounty(cid: string, c: CountyRecord, pathGen: d3.GeoPath): TractItem[] {
  if (tractCache.has(cid)) return tractCache.get(cid)!;

  const [[x0, y0], [x1, y1]] = pathGen.bounds(c.feature);
  const countyW = Math.max(x1 - x0, 10);
  const countyH = Math.max(y1 - y0, 10);
  const countyD = c.d || pathGen(c.feature) || '';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const p2 = new Path2D(countyD);

  const pop = c.pop || 80000;
  const n = Math.max(6, Math.min(140, Math.round(Math.sqrt(pop) / 11)));

  let seed = 0;
  for (let i = 0; i < cid.length; i++) seed += cid.charCodeAt(i) * (i + 1) * 37;
  const r = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const core: [number, number] = [
    x0 + countyW * (0.3 + r() * 0.4),
    y0 + countyH * (0.3 + r() * 0.4)
  ];

  const pts: [number, number][] = [];
  let guard = 0;
  const urban = c.urban ?? 0.65;

  while (pts.length < n && guard++ < n * 80) {
    let x = x0 + r() * countyW;
    let y = y0 + r() * countyH;
    if (r() < urban * 0.7) {
      x = core[0] + gauss(r) * countyW * 0.16;
      y = core[1] + gauss(r) * countyH * 0.16;
    }
    if (ctx && ctx.isPointInPath(p2, x, y)) {
      pts.push([x, y]);
    }
  }

  // Backup grid search if random sampling didn't reach target count
  if (pts.length < n && ctx) {
    const steps = 30;
    const dx = countyW / steps;
    const dy = countyH / steps;
    const grid: [number, number][] = [];
    for (let ix = 1; ix < steps; ix++) {
      for (let iy = 1; iy < steps; iy++) {
        const gx = x0 + ix * dx + (r() - 0.5) * dx * 0.5;
        const gy = y0 + iy * dy + (r() - 0.5) * dy * 0.5;
        if (ctx.isPointInPath(p2, gx, gy)) {
          grid.push([gx, gy]);
        }
      }
    }
    grid.sort(() => r() - 0.5);
    for (const p of grid) {
      if (pts.length >= n) break;
      pts.push(p);
    }
  }

  while (pts.length < n) {
    const fallback = pts.length > 0 ? pts[pts.length % pts.length] : [x0 + countyW * 0.5, y0 + countyH * 0.5];
    pts.push([fallback[0] + (r() - 0.5) * 2, fallback[1] + (r() - 0.5) * 2]);
  }

  if (pts.length < 3) {
    pts.push([x0 + countyW * 0.5, y0 + countyH * 0.5], [x0 + 1, y0 + 1], [x1 - 1, y1 - 1]);
  }

  const voronoi = d3.Delaunay.from(pts).voronoi([x0 - 10, y0 - 10, x1 + 10, y1 + 10]);
  const cSvi = c.svi ?? 0.4;

  const out: (CensusTract & { d?: string })[] = pts.slice(0, n).map((p, i) => {
    let s2 = 0;
    const str = `${cid}:${i}`;
    for (let k = 0; k < str.length; k++) s2 += str.charCodeAt(k) * (k + 1) * 31;
    const rr = () => {
      s2 = (s2 * 9301 + 49297) % 233280;
      return s2 / 233280;
    };
    const ln = () => gauss(rr);
    const kFactor = ln() * 0.12;

    const tnum = 100 + i * 2 + Math.floor(rr() * 2);
    const suffix = rr() < 0.35 ? '.0' + (1 + Math.floor(rr() * 2)) : '';
    const geoid = cid + String(tnum).padStart(4, '0') + (suffix ? suffix.slice(1).padStart(2, '0') : '00');

    const tSvi = Math.max(0.01, Math.min(0.99, cSvi + kFactor * 1.1 + ln() * 0.05));
    const tier = Math.max(0, Math.min(4, Math.floor(tSvi * 5)));
    const tractPop = Math.round(Math.max(1200, Math.min(8200, 2400 + rr() * 4800)));

    return {
      _id: geoid,
      countyFips: cid,
      name: `Census Tract ${tnum}${suffix}`,
      population: tractPop,
      svi: parseFloat(tSvi.toFixed(2)),
      tier,
      d: voronoi.renderCell(i) || '',
      indicators: {
        poverty: parseFloat((12 + kFactor * 5).toFixed(1)),
        uninsured: parseFloat((8 + kFactor * 4).toFixed(1)),
        diabetes: parseFloat((9 + kFactor * 3).toFixed(1)),
        access: Math.round(65 - kFactor * 10),
        lifeExp: parseFloat((78 - kFactor * 5).toFixed(1))
      }
    } as any;
  });

  tractCache.set(cid, out);
  return out;
}

// Map incoming tracts prop to Voronoi cells inside active county
function getTractsForActiveCounty(targetCounty: CountyRecord, pathGen: d3.GeoPath, incomingTracts: CensusTract[]): TractItem[] {
  if (incomingTracts.length === 0) {
    return generateTractsForCounty(targetCounty.id, targetCounty, pathGen);
  }

  const [[x0, y0], [x1, y1]] = pathGen.bounds(targetCounty.feature);
  const countyW = Math.max(x1 - x0, 10);
  const countyH = Math.max(y1 - y0, 10);
  const countyD = targetCounty.d || pathGen(targetCounty.feature) || '';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const p2 = new Path2D(countyD);

  let seed = 0;
  for (let i = 0; i < targetCounty.id.length; i++) seed += targetCounty.id.charCodeAt(i) * (i + 1) * 37;
  const r = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const core: [number, number] = [
    x0 + countyW * (0.3 + r() * 0.4),
    y0 + countyH * (0.3 + r() * 0.4)
  ];

  const pts: [number, number][] = [];
  let guard = 0;
  const urban = targetCounty.urban ?? 0.65;
  const n = incomingTracts.length;

  while (pts.length < n && guard++ < n * 80) {
    let px = x0 + r() * countyW;
    let py = y0 + r() * countyH;
    if (r() < urban * 0.7) {
      px = core[0] + gauss(r) * countyW * 0.16;
      py = core[1] + gauss(r) * countyH * 0.16;
    }
    if (ctx && ctx.isPointInPath(p2, px, py)) {
      pts.push([px, py]);
    }
  }

  if (pts.length < n && ctx) {
    const steps = 30;
    const dx = countyW / steps;
    const dy = countyH / steps;
    const grid: [number, number][] = [];
    for (let ix = 1; ix < steps; ix++) {
      for (let iy = 1; iy < steps; iy++) {
        const gx = x0 + ix * dx + (r() - 0.5) * dx * 0.5;
        const gy = y0 + iy * dy + (r() - 0.5) * dy * 0.5;
        if (ctx.isPointInPath(p2, gx, gy)) {
          grid.push([gx, gy]);
        }
      }
    }
    grid.sort(() => r() - 0.5);
    for (const p of grid) {
      if (pts.length >= n) break;
      pts.push(p);
    }
  }

  while (pts.length < n) {
    const fallback = pts.length > 0 ? pts[pts.length % pts.length] : [x0 + countyW * 0.5, y0 + countyH * 0.5];
    pts.push([fallback[0] + (r() - 0.5) * 2, fallback[1] + (r() - 0.5) * 2]);
  }

  if (pts.length < 3) {
    pts.push([x0 + countyW * 0.5, y0 + countyH * 0.5], [x0 + 1, y0 + 1], [x1 - 1, y1 - 1]);
  }

  const voronoi = d3.Delaunay.from(pts).voronoi([x0 - 10, y0 - 10, x1 + 10, y1 + 10]);

  return incomingTracts.map((t, i) => ({
    ...t,
    d: voronoi.renderCell(i) || ''
  }));
}

export function AssessmentTractMap({
  countyFips,
  tracts,
  selectedTractIds,
  onToggleTract,
  height = 320
}: AssessmentTractMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tractPathsRef = useRef<d3.Selection<SVGPathElement, any, SVGGElement, unknown> | null>(null);
  const selectedSetRef = useRef<Set<string>>(new Set(selectedTractIds));
  const tractsRef = useRef<CensusTract[]>(tracts);
  const markCmpRef = useRef<(() => void) | null>(null);
  const selectCountyRef = useRef<((cid: string, zoomIn?: boolean) => void) | null>(null);
  const updateTractsRef = useRef<((newTracts: CensusTract[]) => void) | null>(null);

  useEffect(() => {
    selectedSetRef.current = new Set(selectedTractIds);
    if (markCmpRef.current) {
      markCmpRef.current();
    }
  }, [selectedTractIds]);

  useEffect(() => {
    tractsRef.current = tracts;
    if (updateTractsRef.current && tracts.length > 0) {
      updateTractsRef.current(tracts);
    }
  }, [tracts]);

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

      const repo = await getCountyRepository();
      if (!isMounted || !topoCache || !containerRef.current) return;

      const normalizedFips = String(countyFips || '53033').padStart(5, '0');
      const statePrefix = normalizedFips.slice(0, 2);
      const pathGen = d3.geoPath();

      // State counties matching prototype list = o.scope ? C.filter(c => c.st === o.scope) : C
      const stateCounties = repo.countiesByState.get(statePrefix) || Array.from(repo.countyById.values()).filter(c => c.st === statePrefix);
      if (stateCounties.length === 0) return;

      const countyMap = new Map<string, CountyRecord>();
      stateCounties.forEach(c => countyMap.set(c.id, c));

      const targetCounty = countyMap.get(normalizedFips) || stateCounties[0];
      if (!targetCounty) return;

      // Color scale matching prototype colorScale(o.metric, vals, 'vuln') lines 1094-1104
      const countySvis = stateCounties.map(c => c.svi ?? 0.3);
      const countyScale = d3.piecewise(d3.interpolateRgb.gamma(1.6), [
        d3.interpolateRgb('#101B45', '#CDE7FB')(0.6),
        '#CDE7FB',
        '#8CC6F4',
        '#4C9BEA',
        '#2462C9',
        '#163A7E'
      ]);

      // Vulnerability 5-step scale for tracts matching prototype vuln ramp
      const vulnScale = d3.scaleQuantize<string>()
        .domain([0, 1])
        .range(['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E']);

      // Unique clip id matching prototype uid + 'clip'
      const uid = `as-${normalizedFips}-${Math.random().toString(36).substring(2, 6)}`;

      // SVG canvas matching prototype lines 1245-1258
      const svg = d3.select(container)
        .append('svg')
        .attr('class', 'map-svg dim-others')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('role', 'img')
        .attr('aria-label', 'Interactive county map');

      const defs = svg.append('defs');
      const clip = defs.append('clipPath').attr('id', `${uid}clip`).append('path');

      const g = svg.append('g').attr('class', 'map-root');

      // Layer 1: All counties in the state (gC)
      const gC = g.append('g').attr('class', 'surrounding-counties');

      // Layer 2: State boundary & coastline (gB)
      const gB = g.append('g').attr('class', 'state-boundary-layer');

      // Layer 3: Census Tracts Group (gT) clipped to active county
      const gT = g.append('g').attr('class', 'tracts-group').attr('clip-path', `url(#${uid}clip)`);

      // Layer 4: Active county outline (gSel)
      const gSel = g.append('g').attr('class', 'target-county-outline');

      let selC = normalizedFips;

      // Render State Boundary (.nation-b)
      const stateFeatures = (topojson.feature(topoCache, topoCache.objects.states) as any).features;
      const stFeature = stateFeatures?.find((f: any) => String(f.id).padStart(2, '0') === statePrefix);
      if (stFeature) {
        const stD = pathGen(stFeature);
        if (stD) {
          gB.append('path')
            .attr('class', 'nation-b')
            .attr('d', stD)
            .attr('fill', 'none')
            .attr('stroke', '#9CC9EE')
            .attr('stroke-opacity', 0.95)
            .attr('stroke-width', 1.2)
            .attr('vector-effect', 'non-scaling-stroke')
            .style('pointer-events', 'none');
        }
      }

      // Configure D3 zoom behavior on SVG matching prototype lines 1300-1306
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 90])
        .translateExtent([[-200, -200], [1175, 810]])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        });

      svg.call(zoom).on('dblclick.zoom', null);

      function zoomBounds(b: [[number, number], [number, number]], dur = 850, pad = 0.70) {
        const [[x0, y0], [x1, y1]] = b;
        const cw = Math.max(x1 - x0, 10);
        const ch = Math.max(y1 - y0, 10);
        const s = Math.min(26, pad / Math.max(cw / 975, ch / 610));
        const t = d3.zoomIdentity
          .translate(975 / 2, 610 / 2)
          .scale(s)
          .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

        svg.transition('camera-zoom')
          .duration(dur)
          .ease(d3.easeCubicInOut)
          .call(zoom.transform, t);
      }

      function zoomToCounty(countyRecord: CountyRecord, dur = 850) {
        const b = pathGen.bounds(countyRecord.feature) as [[number, number], [number, number]];
        zoomBounds(b, dur, 0.70);
      }

      function markCmp() {
        const set = selectedSetRef.current;
        gT.selectAll<SVGPathElement, any>('path.tract')
          .classed('cmp', d => set.has(tractId(d)))
          .attr('stroke', d => set.has(tractId(d)) ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)')
          .attr('stroke-width', d => set.has(tractId(d)) ? 2.2 : 0.7);
      }
      markCmpRef.current = markCmp;

      function tractTip(t: any, isSel: boolean) {
        const tierIdx = t.tier ?? Math.min(4, Math.floor((t.svi ?? 0) * 5));
        const tierName = ['Very low', 'Low', 'Moderate', 'High', 'Very high'][tierIdx] || 'Moderate';
        return `<b>${t.name || `Tract ${tractId(t)}`}</b>${tipRows([
          ['GEOID', tractId(t)],
          ['Vulnerability (SVI)', `${Number(t.svi || 0).toFixed(2)} (${tierName})`],
          ['Population', Number(t.population || t.pop || 4000).toLocaleString()],
          ['Status', isSel ? 'Focus tract (Selected)' : 'Not selected']
        ])}<div class="note" style="margin-top:5px">Click to ${isSel ? 'remove from focus' : 'add to focus'}</div>`;
      }

      let activeCountyRecord: CountyRecord = targetCounty;
      let tractsDrawn = false;

      // Draw tracts matching prototype lines 1351-1368
      function drawTracts(cid: string, c: CountyRecord, targetD: string, animate = true) {
        gT.selectAll('*').remove();
        clip.attr('d', targetD);

        const currentTracts = tractsRef.current;
        let activeTracts: TractItem[] = [];
        if (cid === normalizedFips && currentTracts.length > 0) {
          activeTracts = getTractsForActiveCounty(c, pathGen, currentTracts);
        } else {
          activeTracts = generateTractsForCounty(cid, c, pathGen);
        }

        if (activeTracts.length === 0) return;

        const paths = gT.selectAll<SVGPathElement, any>('path.tract')
          .data(activeTracts, d => tractId(d))
          .join('path')
          .attr('class', t => `tract ${selectedSetRef.current.has(tractId(t)) ? 'cmp' : ''}`)
          .attr('d', d => d.d || '')
          .attr('data-id', t => tractId(t))
          .attr('fill', t => vulnScale(t.svi ?? 0) || '#4C9BEA')
          .attr('stroke', t => selectedSetRef.current.has(tractId(t)) ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)')
          .attr('stroke-width', t => selectedSetRef.current.has(tractId(t)) ? 2.2 : 0.7)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('cursor', 'pointer');

        tractPathsRef.current = paths;

        if (animate) {
          // Staggered entrance fade matching prototype line 1358
          paths.attr('opacity', 0)
            .transition('tin')
            .delay((_, i) => 120 + i * 10)
            .duration(400)
            .attr('opacity', 1);

          // Boundary draw sweep matching prototype lines 1360-1362
          paths.each(function (this: SVGPathElement) {
            let L = 120;
            try {
              if (this.getTotalLength) L = this.getTotalLength() || 120;
            } catch {
              L = 120;
            }
            d3.select(this)
              .attr('stroke-dasharray', `${L} ${L}`)
              .attr('stroke-dashoffset', L);
          })
          .transition('tdraw')
            .delay((_, i) => 100 + i * 10)
            .duration(800)
            .ease(d3.easeCubicOut)
            .attr('stroke-dashoffset', 0)
            .on('end', function (this: SVGPathElement) {
              d3.select(this).attr('stroke-dasharray', null);
            });
        } else {
          paths.attr('opacity', 1);
        }

        paths
          .on('pointerenter', function (this: SVGPathElement, event: MouseEvent, t: any) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 2.0)
              .raise();

            const isSel = selectedSetRef.current.has(tractId(t));
            showTip(tractTip(t, isSel), event);
          })
          .on('pointermove', function (event: MouseEvent) {
            moveTip(event);
          })
          .on('pointerleave', function (this: SVGPathElement, _, t: any) {
            const isSel = selectedSetRef.current.has(tractId(t));
            d3.select(this)
              .attr('stroke', isSel ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)')
              .attr('stroke-width', isSel ? 2.2 : 0.7);

            hideTip();
          })
          .on('click', function (event: MouseEvent, t: any) {
            event.stopPropagation();
            onToggleTract(t);
          });

        markCmp();
        tractsDrawn = true;
      }

      // selectCounty implementation matching prototype lines 1384-1391
      function selectCounty(cid: string, zoomIn = true) {
        selC = cid;
        counties.classed('sel', (d: any) => d.id === cid);
        gSel.selectAll('*').remove();

        const c = countyMap.get(cid);
        if (!c) return;

        activeCountyRecord = c;
        const targetD = c.d || pathGen(c.feature) || '';
        gSel.append('path')
          .attr('class', 'sel-outline')
          .attr('d', targetD)
          .attr('fill', 'none')
          .attr('stroke', '#102A4C')
          .attr('stroke-width', 1.8)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('filter', 'none')
          .style('pointer-events', 'none');

        if (zoomIn) {
          zoomToCounty(c, 850);
        }

        drawTracts(cid, c, targetD, true);
      }
      selectCountyRef.current = selectCounty;

      updateTractsRef.current = () => {
        if (!isMounted || !activeCountyRecord) return;
        const targetD = activeCountyRecord.d || pathGen(activeCountyRecord.feature) || '';
        drawTracts(selC, activeCountyRecord, targetD, !tractsDrawn);
      };

      // Render all counties in the state matching prototype lines 1280 & 1319-1321
      const counties = gC.selectAll<SVGPathElement, CountyRecord>('path.county')
        .data(stateCounties, d => d.id)
        .join('path')
        .attr('class', d => `county ${d.id === selC ? 'sel' : ''}`)
        .attr('d', d => (d.d || pathGen(d.feature)) || '')
        .attr('fill', d => countyScale(d.svi || 0.3))
        .attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer');

      // Counties hover & click matching prototype lines 1293-1298
      counties
        .on('pointerenter', function (event: MouseEvent, d: CountyRecord) {
          if (d.id !== selC) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 1.6)
              .raise();
          }

          showTip(
            `<b>${d.name} ${d.st === '22' ? 'Parish' : d.st === '02' ? 'Borough' : 'County'}, ${d.stateAbbr}</b>${tipRows([
              ['Vulnerability (SVI)', (d.svi || 0).toFixed(2)],
              ['Population', (d.pop || 0).toLocaleString()],
              ['Status', d.id === selC ? 'County in focus' : 'Neighboring county (Click to focus)']
            ])}<div class="note" style="margin-top:5px">${d.id === selC ? 'Census tracts shown below' : 'Click to shift focus to this county'}</div>`,
            event
          );
        })
        .on('pointermove', function (event: MouseEvent) {
          moveTip(event);
        })
        .on('pointerleave', function (this: SVGPathElement, _, d: CountyRecord) {
          if (d.id !== selC) {
            d3.select(this)
              .attr('stroke', 'rgba(141, 170, 200, 0.45)')
              .attr('stroke-width', 0.75);
          }
          hideTip();
        })
        .on('click', function (event: MouseEvent, d: CountyRecord) {
          event.stopPropagation();
          hideTip();
          selectCounty(d.id, true);
        });

      // Initial county selection matching prototype line 2505
      selectCounty(normalizedFips, true);
    }

    renderMap();

    return () => {
      isMounted = false;
      hideTip();
      if (containerRef.current) {
        d3.select(containerRef.current).select('svg').interrupt();
        d3.select(containerRef.current).selectAll('*').interrupt();
      }
    };
  }, [countyFips, height]);

  return (
    <div
      className="assessment-tract-map-root w-full h-full select-none"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <style>{`
        /* Map container background matching prototype entire_website.html line 192 */
        .assessment-tract-map-root {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--cyan, #38E1FF) 8%, transparent), transparent 70%);
        }

        .assessment-tract-map-root .map-svg {
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
        }

        /* Counties styling matching prototype entire_website.html lines 194-197 & 800-802 */
        .assessment-tract-map-root .county {
          stroke: rgba(141, 170, 200, 0.45);
          stroke-width: 0.75px;
          vector-effect: non-scaling-stroke;
          transition: opacity 0.35s ease, stroke 0.2s ease;
          cursor: pointer;
        }

        .assessment-tract-map-root .county:hover {
          stroke: #ffffff !important;
          stroke-width: 1.6px !important;
        }

        /* Dim all neighbor counties to opacity 0.28 matching line 197 */
        .assessment-tract-map-root .map-svg.dim-others .county:not(.sel) {
          opacity: 0.28 !important;
        }

        /* County in focus is full opacity (1.0) and highlighted */
        .assessment-tract-map-root .map-svg .county.sel {
          opacity: 1.0 !important;
          stroke: #102A4C !important;
          stroke-width: 1.8px !important;
        }

        /* State coastline boundary (.nation-b) matching lines 199 & 804 */
        .assessment-tract-map-root .nation-b {
          fill: none !important;
          stroke: #9CC9EE !important;
          stroke-opacity: 0.95 !important;
          stroke-width: 1.2px !important;
          vector-effect: non-scaling-stroke;
          pointer-events: none;
          filter: none !important;
        }

        /* Active county dark navy border matching lines 204 & 805 */
        .assessment-tract-map-root .sel-outline {
          fill: none !important;
          stroke: #102A4C !important;
          stroke-width: 1.8px !important;
          filter: none !important;
          vector-effect: non-scaling-stroke;
          pointer-events: none;
        }

        /* Census tracts matching lines 200-203 & 806-807 */
        .assessment-tract-map-root .tract {
          stroke: rgba(255, 255, 255, 0.55);
          stroke-width: 0.7px;
          vector-effect: non-scaling-stroke;
          cursor: pointer;
          transition: stroke 0.15s ease, stroke-width 0.15s ease;
        }

        .assessment-tract-map-root .tract:hover {
          stroke: #ffffff !important;
          stroke-width: 2.0px !important;
        }

        .assessment-tract-map-root .tract.cmp {
          stroke: #F2B33D !important;
          stroke-width: 2.2px !important;
        }
      `}</style>
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ position: 'absolute', inset: 0 }}
      />
    </div>
  );
}
