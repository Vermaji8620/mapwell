'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { getCountyRepository } from '@/utils/countyRepository';

let topoCache: any = null;

const SVI_RAMP = ['#CBE5FE', '#93C5FD', '#3B82F6', '#1D4ED8', '#172554'];

export function LoginShowcaseMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isCancelled = false;

    async function render() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';

      if (!topoCache) {
        try {
          const res = await fetch('/us-counties.json');
          if (!res.ok) throw new Error('Failed to load map geometry');
          topoCache = await res.json();
        } catch (e) {
          console.error('[LoginShowcaseMap Error]:', e);
          return;
        }
      }

      const repo = await getCountyRepository();
      if (isCancelled || !containerRef.current || !topoCache) return;

      const countiesGeo = topojson.feature(topoCache, topoCache.objects.counties) as any;
      const statesMesh = topojson.mesh(topoCache, topoCache.objects.states, (a: any, b: any) => a !== b);
      const pathGen = d3.geoPath();

      const colorScale = d3.scaleQuantize<string>()
        .domain([0, 1])
        .range(SVI_RAMP);

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none pointer-events-none');

      const defs = svg.append('defs');

      // Pulse animation for landmark dots
      const style = defs.append('style');
      style.text(`
        @keyframes loginDotPulse {
          0% { r: 3.5px; opacity: 0.95; }
          50% { r: 9px; opacity: 0.25; }
          100% { r: 3.5px; opacity: 0.95; }
        }
        .login-pulse-ring {
          animation: loginDotPulse 2.5s ease-in-out infinite;
          transform-origin: center;
        }
      `);

      const gCounties = svg.append('g').attr('class', 'counties');
      const gBorders = svg.append('g').attr('class', 'borders');
      const gDots = svg.append('g').attr('class', 'dots');

      // Draw all 3,142 counties
      gCounties.selectAll('path.county')
        .data(countiesGeo.features)
        .enter()
        .append('path')
        .attr('class', 'county')
        .attr('d', (d: any) => pathGen(d) || '')
        .attr('fill', (d: any) => {
          const c = repo.countyById.get(d.id);
          const val = c ? c.svi : 0.45;
          return colorScale(val);
        })
        .attr('stroke', 'rgba(255, 255, 255, 0.28)')
        .attr('stroke-width', 0.45);

      // Draw State boundaries
      gBorders.append('path')
        .datum(statesMesh)
        .attr('d', pathGen as any)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255, 255, 255, 0.75)')
        .attr('stroke-width', 0.9)
        .attr('vector-effect', 'non-scaling-stroke');

      // Key Landmark Pulse Points matching prototype
      const keyFips = ['17031', '48201', '13121', '06037', '53033'];
      const points = keyFips
        .map(fips => {
          const f = countiesGeo.features.find((c: any) => c.id === fips);
          if (!f) return null;
          const centroid = pathGen.centroid(f);
          return isNaN(centroid[0]) ? null : centroid;
        })
        .filter(Boolean) as [number, number][];

      points.forEach(([x, y]) => {
        const dotG = gDots.append('g').attr('transform', `translate(${x}, ${y})`);
        dotG.append('circle')
          .attr('r', 8)
          .attr('fill', '#00C2E8')
          .attr('class', 'login-pulse-ring');
        dotG.append('circle')
          .attr('r', 3.5)
          .attr('fill', '#FFFFFF');
      });
    }

    render();

    return () => {
      isCancelled = true;
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full flex items-center justify-center" />;
}
