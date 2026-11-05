'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { getCountyRepository, CountyRecord } from '@/utils/countyRepository';
import { STATE_COVERAGE } from '@/components/StateCoverageMap';

interface DashboardCoverageMapProps {
  activeCountyFips?: string;
  onSelectCounty?: (county: CountyRecord) => void;
}

let topoCache: any = null;

// Peer county finder matching prototype formula:
// peersOf(c, n = 4) based on SVI similarity and log population ratio
function findPeerCounties(target: CountyRecord, allCounties: CountyRecord[], n = 4): CountyRecord[] {
  return allCounties
    .filter((x) => x.id !== target.id && x.st !== target.st)
    .map((x) => ({
      x,
      d: Math.abs(x.svi - target.svi) * 3 + Math.abs(Math.log(Math.max(x.pop, 1000) / Math.max(target.pop, 1000)))
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((o) => o.x);
}

export function DashboardCoverageMap({ activeCountyFips = '53033', onSelectCounty }: DashboardCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeCounty, setActiveCounty] = useState<CountyRecord | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';

      if (!topoCache) {
        try {
          const res = await fetch('/us-counties.json');
          if (!res.ok) throw new Error('Failed to load map data');
          topoCache = await res.json();
        } catch (err) {
          console.error('[DashboardCoverageMap Error]:', err);
          return;
        }
      }

      const repo = await getCountyRepository();
      if (!isMounted || !topoCache || !containerRef.current) return;

      const currentC = repo.countyById.get(activeCountyFips) || repo.counties[0];
      setActiveCounty(currentC);

      const peers = findPeerCounties(currentC, repo.counties, 4);

      const statesGeo = topojson.feature(topoCache, topoCache.objects.states) as any;
      const states = statesGeo.features;

      const pathGen = d3.geoPath();

      // Coverage linear scale matching prototype: domain([82, 100]).range(['#D7ECFC', '#2584EB'])
      const sc = d3.scaleLinear<string>()
        .domain([82, 100])
        .range(['#D7ECFC', '#2584EB']);

      const svg = d3
        .select(container)
        .append('svg')
        .attr('class', 'state-map')
        .attr('viewBox', '0 0 975 610')
        .style('width', '100%')
        .style('height', 'auto')
        .style('display', 'block');

      // 1. Draw all 50 states + DC with initial #E8F3FD and smooth transition to sc(cov)
      const statePaths = svg
        .selectAll<SVGPathElement, any>('path')
        .data(states)
        .enter()
        .append('path')
        .attr('d', (d: any) => pathGen(d) || '')
        .attr('fill', '#E8F3FD')
        .attr('data-st', (d: any) => d.id)
        .style('cursor', 'pointer');

      // Native title tooltip matching prototype: <title>${s.name}: ${COV[s.id].toFixed(1)}% complete</title>
      statePaths.append('title').text((d: any) => {
        const cov = STATE_COVERAGE[d.id]?.cov ?? 94.5;
        const name = STATE_COVERAGE[d.id]?.name || `State ${d.id}`;
        return `${name}: ${cov.toFixed(1)}% complete`;
      });

      // Staggered fill transition matching prototype line 1925
      statePaths
        .transition()
        .duration(600)
        .delay((_, i) => 300 + i * 14)
        .attr('fill', (d: any) => {
          const cov = STATE_COVERAGE[d.id]?.cov ?? 94.5;
          return sc(cov);
        });

      // 2. Geographic county markers: [j, ...peersOf(j, 4)]
      const markerGroup = svg.append('g');

      const allMarkers = [currentC, ...peers];
      allMarkers.forEach((c, i) => {
        if (!c) return;
        const centroid = c.feature ? pathGen.centroid(c.feature) : [(c as any).cx, (c as any).cy];
        if (!centroid || isNaN(centroid[0]) || isNaN(centroid[1])) return;
        const [cx, cy] = centroid;

        const isMain = i === 0;
        const circle = markerGroup
          .append('circle')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', isMain ? 10 : 7)
          .attr('fill', isMain ? '#2584EB' : '#37C8CF')
          .attr('stroke', '#fff')
          .attr('stroke-width', 3)
          .style('cursor', 'pointer');

        circle.append('title').text(`${c.name} ${c.stateAbbr} (${isMain ? 'Active' : 'Peer'})`);

        if (onSelectCounty) {
          circle.on('click', () => onSelectCounty(c));
        }
      });
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [activeCountyFips, onSelectCounty]);

  const activeLabel = activeCounty
    ? `${activeCounty.name} County, ${activeCounty.stateAbbr}`
    : 'King County, WA';

  return (
    <div>
      <div ref={containerRef} />
      <div className="note" style={{ marginTop: '4px' }}>
        Large marker: {activeLabel}. Small markers: peer counties
      </div>
    </div>
  );
}
