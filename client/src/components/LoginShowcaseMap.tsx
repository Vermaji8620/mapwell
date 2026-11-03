'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { getCountyRepository } from '@/utils/countyRepository';

let topoCache: any = null;

// Authentic 7-bin quantile ramp from prototype: ['#CDE7FB', '#8CC6F4', '#4C9BEA', '#2462C9', '#163A7E']
// with low base #E4ECFA interpolated with gamma 1.6
const SVI_BINS = [
  '#D3E8FB',
  '#C9E5FB',
  '#9BCDF6',
  '#6FB1EF',
  '#4590E3',
  '#2867CB',
  '#1B4A9B'
];

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
        .range(SVI_BINS);

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none pointer-events-none');

      const defs = svg.append('defs');

      // Pulse animation for glowing hotspots matching prototype
      const style = defs.append('style');
      style.text(`
        @keyframes ring {
          0% { transform: scale(0.6); opacity: 0.95; }
          100% { transform: scale(3.2); opacity: 0; }
        }
        .pulse-m {
          filter: drop-shadow(0 0 6px #00C2E8) drop-shadow(0 0 10px rgba(0, 194, 232, 0.6));
        }
        .pulse-m .ring {
          fill: none;
          stroke: #00A3E0;
          stroke-width: 1.8;
          vector-effect: non-scaling-stroke;
          transform-box: fill-box;
          transform-origin: center;
          animation: ring 2.4s ease-out infinite;
        }
        .pulse-m .ring.r2 {
          animation-delay: 1.2s;
        }
        .pulse-m .core-outer {
          fill: rgba(0, 194, 232, 0.35);
        }
        .pulse-m .core {
          fill: #FFFFFF;
          stroke: #00A3E0;
          stroke-width: 1.5;
          vector-effect: non-scaling-stroke;
        }
      `);

      const gCounties = svg.append('g').attr('class', 'counties');
      const gBorders = svg.append('g').attr('class', 'borders');
      const gDots = svg.append('g').attr('class', 'dots');

      // Draw all 3,142 counties with authentic SVI shades and white borders
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
        .attr('stroke', 'rgba(255, 255, 255, 0.65)')
        .attr('stroke-width', 0.45);

      // Draw State boundaries with clean white outlines
      gBorders.append('path')
        .datum(statesMesh)
        .attr('d', pathGen as any)
        .attr('fill', 'none')
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 1.1)
        .attr('vector-effect', 'non-scaling-stroke');

      // Draw Nation boundary outline
      if (topoCache.objects.nation) {
        const nationMesh = topojson.mesh(topoCache, topoCache.objects.nation);
        gBorders.append('path')
          .datum(nationMesh)
          .attr('d', pathGen as any)
          .attr('fill', 'none')
          .attr('stroke', '#9CC9EE')
          .attr('stroke-width', 1.0)
          .attr('vector-effect', 'non-scaling-stroke');
      }

      // Identify 7 highest vulnerability hotspot locations
      const top7 = [...repo.counties]
        .sort((a, b) => b.svi - a.svi)
        .slice(0, 7);

      const points: [number, number][] = [];
      top7.forEach(c => {
        const f = countiesGeo.features.find((feat: any) => feat.id === c.id);
        if (f) {
          const centroid = pathGen.centroid(f);
          if (!isNaN(centroid[0]) && !isNaN(centroid[1])) {
            points.push(centroid);
          }
        }
      });

      // Supplement with landmark coordinates if needed
      const fallbackFips = ['28051', '22035', '21237', '28083', '48201', '17031', '06037'];
      if (points.length < 5) {
        fallbackFips.forEach(fips => {
          const f = countiesGeo.features.find((feat: any) => feat.id === fips);
          if (f) {
            const c = pathGen.centroid(f);
            if (!isNaN(c[0])) points.push(c);
          }
        });
      }

      // Render glowing pulse hotspots with expanding concentric rings
      points.slice(0, 7).forEach(([x, y]) => {
        const dotG = gDots.append('g')
          .attr('class', 'pulse-m')
          .attr('transform', `translate(${x}, ${y})`);

        dotG.append('circle')
          .attr('class', 'ring')
          .attr('r', 7);

        dotG.append('circle')
          .attr('class', 'ring r2')
          .attr('r', 7);

        dotG.append('circle')
          .attr('class', 'core-outer')
          .attr('r', 5.5);

        dotG.append('circle')
          .attr('class', 'core')
          .attr('r', 3.5);
      });
    }

    render();

    return () => {
      isCancelled = true;
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full flex items-center justify-center overflow-hidden" />;
}
