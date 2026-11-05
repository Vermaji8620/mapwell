'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';

export interface AssessmentTractMapProps {
  countyFips: string;
  tracts: CensusTract[];
  selectedTractIds: string[];
  onToggleTract: (tract: CensusTract) => void;
  height?: number;
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

export function AssessmentTractMap({
  countyFips,
  tracts,
  selectedTractIds,
  onToggleTract,
  height = 320
}: AssessmentTractMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tractPathsRef = useRef<d3.Selection<SVGPathElement, CensusTract, SVGGElement, unknown> | null>(null);

  const selectedSet = new Set(selectedTractIds);

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

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none map-svg dim-others')
        .style('background', 'transparent');

      const defs = svg.append('defs');
      const clipId = `as-clip-${countyFips}-${Math.random().toString(36).substring(2, 6)}`;

      defs.append('clipPath')
        .attr('id', clipId)
        .append('path')
        .attr('d', countyD);

      const mainGroup = svg.append('g').attr('class', 'map-root');

      // County background silhouette
      mainGroup.append('path')
        .attr('d', countyD)
        .attr('fill', 'var(--map-low)')
        .attr('stroke', 'var(--map-line)')
        .attr('stroke-width', 1.5)
        .attr('vector-effect', 'non-scaling-stroke');

      const tractGroup = mainGroup.append('g').attr('clip-path', `url(#${clipId})`);

      // Selected county glowing outline
      const outlineGroup = mainGroup.append('g');
      outlineGroup.append('path')
        .attr('class', 'sel-outline')
        .attr('d', countyD)
        .attr('fill', 'none')
        .attr('stroke', 'var(--cyan)')
        .attr('stroke-width', 2.0)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('filter', 'drop-shadow(0 0 6px var(--cyan))')
        .style('pointer-events', 'none');

      // Auto-fit to county bounds
      const padding = 0.84;
      const s = Math.min(28, padding / Math.max(countyWidth / 975, countyHeight / 610));
      const initialTransform = d3.zoomIdentity
        .translate(975 / 2, 610 / 2)
        .scale(s)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

      mainGroup.attr('transform', initialTransform.toString());

      if (tracts.length === 0) return;

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

      // Vulnerability 5-step scale matching prototype vuln layer
      const vulnScale = d3.scaleQuantize<string>()
        .domain([0, 1])
        .range(['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E']);

      // Render Tract Cells
      const paths = tractGroup.selectAll<SVGPathElement, CensusTract>('path.tract')
        .data(tracts)
        .enter()
        .append('path')
        .attr('class', t => `tract ${selectedSet.has(t._id) ? 'cmp' : ''}`)
        .attr('d', (_, i) => voronoi.renderCell(i) || '')
        .attr('data-id', t => t._id)
        .attr('fill', t => vulnScale(t.svi) || '#4C9BEA')
        .attr('stroke', t => (selectedSet.has(t._id) ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)'))
        .attr('stroke-width', t => (selectedSet.has(t._id) ? 2.2 : 0.65))
        .attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer');

      tractPathsRef.current = paths;

      paths
        .on('pointerenter', function (event: MouseEvent, tract) {
          d3.select(this)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 2.6)
            .raise();

          const isSel = selectedSet.has(tract._id);
          const tier = tract.tier ?? Math.min(4, Math.floor(tract.svi * 5));
          const tierName = ['Very low', 'Low', 'Moderate', 'High', 'Very high'][tier] || 'Moderate';

          showTip(
            `<b>${tract.name || `Tract ${tract._id}`}</b>${tipRows([
              ['GEOID', tract._id],
              ['Vulnerability (SVI)', `${tract.svi.toFixed(2)} (${tierName})`],
              ['Population', (tract.population || 4000).toLocaleString()],
              ['Status', isSel ? 'Focus tract (Selected)' : 'Not selected']
            ])}<div class="note" style="margin-top:5px">Click to ${isSel ? 'remove from focus' : 'add to focus'}</div>`,
            event
          );
        })
        .on('pointermove', function (event: MouseEvent) {
          moveTip(event);
        })
        .on('pointerleave', function (_, tract) {
          const isSel = selectedSet.has(tract._id);
          d3.select(this)
            .attr('stroke', isSel ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)')
            .attr('stroke-width', isSel ? 2.2 : 0.65);

          hideTip();
        })
        .on('click', function (_, tract) {
          onToggleTract(tract);
        });
    }

    renderMap();

    return () => {
      isMounted = false;
      hideTip();
    };
  }, [countyFips, tracts, height]);

  // Update fills and highlights when selectedTractIds changes
  useEffect(() => {
    if (!tractPathsRef.current || tracts.length === 0) return;

    tractPathsRef.current
      .attr('class', t => `tract ${selectedSet.has(t._id) ? 'cmp' : ''}`)
      .attr('stroke', t => (selectedSet.has(t._id) ? '#F2B33D' : 'rgba(255, 255, 255, 0.55)'))
      .attr('stroke-width', t => (selectedSet.has(t._id) ? 2.2 : 0.65));
  }, [selectedTractIds, tracts]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full select-none"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    />
  );
}
