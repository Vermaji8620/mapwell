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
    .filter(x => x.id !== target.id && x.st !== target.st)
    .map(x => ({
      x,
      d: Math.abs(x.svi - target.svi) * 3 + Math.abs(Math.log(Math.max(x.pop, 1000) / Math.max(target.pop, 1000)))
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(o => o.x);
}

export function DashboardCoverageMap({ activeCountyFips = '17031', onSelectCounty }: DashboardCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeCounty, setActiveCounty] = useState<CountyRecord | null>(null);
  const [peerCounties, setPeerCounties] = useState<CountyRecord[]>([]);
  const [hoveredInfo, setHoveredInfo] = useState<string | null>(null);

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
      setPeerCounties(peers);

      const statesGeo = topojson.feature(topoCache, topoCache.objects.states) as any;
      const states = statesGeo.features;

      const pathGen = d3.geoPath();

      // Coverage linear scale matching MapWell specifications (82% to 100%)
      const colorScale = d3.scaleLinear<string>()
        .domain([82, 92, 100])
        .range(['#152B58', '#1D5BBF', '#2584EB']);

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-auto block select-none')
        .style('filter', 'drop-shadow(0 2px 10px rgba(0,0,0,0.35))');

      const gStates = svg.append('g').attr('class', 'states-layer');

      // Draw all 50 states + DC
      gStates.selectAll<SVGPathElement, any>('path.state-feature')
        .data(states)
        .enter()
        .append('path')
        .attr('class', 'state-feature transition-all duration-200 cursor-pointer')
        .attr('d', (d: any) => pathGen(d) || '')
        .attr('fill', (d: any) => {
          const cov = STATE_COVERAGE[d.id]?.cov ?? 94.5;
          return colorScale(cov);
        })
        .attr('stroke', 'rgba(255, 255, 255, 0.22)')
        .attr('stroke-width', 0.75)
        .attr('vector-effect', 'non-scaling-stroke')
        .on('pointerenter', function (event, d: any) {
          const stMeta = STATE_COVERAGE[d.id] || { name: `State ${d.id}`, cov: 94.0 };
          d3.select(this)
            .attr('stroke', 'var(--cyan, #37C8CF)')
            .attr('stroke-width', 1.8)
            .raise();
          setHoveredInfo(`${stMeta.name}: ${stMeta.cov.toFixed(1)}% complete`);
        })
        .on('pointerleave', function () {
          d3.select(this)
            .attr('stroke', 'rgba(255, 255, 255, 0.22)')
            .attr('stroke-width', 0.75);
          setHoveredInfo(null);
        });

      // Markers Layer
      const gMarkers = svg.append('g').attr('class', 'markers-layer');

      // Peer County Markers (4 small teal circles)
      peers.forEach(peer => {
        const centroid = peer.feature ? pathGen.centroid(peer.feature) : null;
        if (!centroid || isNaN(centroid[0]) || isNaN(centroid[1])) return;
        const [cx, cy] = centroid;

        const peerGroup = gMarkers.append('g')
          .attr('class', 'peer-pin cursor-pointer')
          .attr('transform', `translate(${cx}, ${cy})`);

        peerGroup.append('circle')
          .attr('r', 5.5)
          .attr('fill', '#37C8CF')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 2)
          .style('filter', 'drop-shadow(0 0 4px rgba(55, 200, 207, 0.7))');

        peerGroup
          .on('pointerenter', () => {
            setHoveredInfo(`${peer.name} County, ${peer.stateAbbr} (Peer county)`);
          })
          .on('pointerleave', () => {
            setHoveredInfo(null);
          })
          .on('click', () => {
            if (onSelectCounty) onSelectCounty(peer);
          });
      });

      // Active County Marker (1 large prominent blue circle with pulsing halo)
      if (currentC && currentC.feature) {
        const centroid = pathGen.centroid(currentC.feature);
        if (centroid && !isNaN(centroid[0]) && !isNaN(centroid[1])) {
          const [cx, cy] = centroid;
          const activeGroup = gMarkers.append('g')
            .attr('class', 'active-pin cursor-pointer')
            .attr('transform', `translate(${cx}, ${cy})`);

          // Subtle outer glow
          activeGroup.append('circle')
            .attr('r', 14)
            .attr('fill', '#2584EB')
            .attr('opacity', 0.3)
            .attr('class', 'animate-ping');

          activeGroup.append('circle')
            .attr('r', 8.5)
            .attr('fill', '#2584EB')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 2.8)
            .style('filter', 'drop-shadow(0 0 6px rgba(37, 132, 235, 0.9))');

          activeGroup
            .on('pointerenter', () => {
              setHoveredInfo(`${currentC.name} County, ${currentC.stateAbbr} (Active jurisdiction)`);
            })
            .on('pointerleave', () => {
              setHoveredInfo(null);
            })
            .on('click', () => {
              if (onSelectCounty) onSelectCounty(currentC);
            });
        }
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [activeCountyFips, onSelectCounty]);

  const activeLabel = activeCounty
    ? `${activeCounty.name} ${['22'].includes(activeCounty.st) ? 'Parish' : ['02'].includes(activeCounty.st) ? 'Borough' : 'County'}, ${activeCounty.stateAbbr}`
    : 'Active jurisdiction';

  return (
    <div className="w-full flex flex-col justify-between">
      <div className="relative w-full rounded-xl overflow-hidden bg-[#07111F]/70 border border-[var(--line)] p-2">
        <div ref={containerRef} className="w-full h-auto min-h-[170px]" />

        {hoveredInfo && (
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-[#0c1427]/95 backdrop-blur-md border border-[rgba(255,255,255,0.18)] shadow-lg text-[11px] text-[var(--cyan)] font-bold pointer-events-none animate-in fade-in-50">
            {hoveredInfo}
          </div>
        )}
      </div>

      <div className="text-[11px] text-[var(--faint)] mt-2 flex flex-wrap items-center justify-between gap-2">
        <span>Large marker: <strong className="text-[var(--text)]">{activeLabel}</strong>. Small markers: peer counties</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#2584EB] border border-white" />
            <span className="text-[10px]">Active</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#37C8CF] border border-white" />
            <span className="text-[10px]">Peers</span>
          </div>
        </div>
      </div>
    </div>
  );
}
