'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { TIER_COLORS, TIER_LABELS, METRICS_CONFIG, MAP_LAYERS } from '@/config/metrics';
import { CountyRecord, getCountyRepository } from '@/utils/countyRepository';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface MapViewProps {
  countyFips?: string;
  tracts?: CensusTract[];
  selectedTractId?: string;
  onSelectTract?: (tract: any) => void;
  onSelectCounty?: (county: CountyRecord) => void;
  metric?: string;
  layer?: string;
  heatmap?: boolean;
  markers?: boolean;
  height?: number;
  zoomable?: boolean;
}

// Cache topology data to avoid re-fetching
let topoDataCache: any = null;
const tractCache = new Map<string, any[]>();

export function getMetricVal(rec: any, key: string): number {
  if (!rec) return 0;
  if (key.startsWith('prog.')) {
    const pk = key.slice(5);
    return rec.prog?.[pk] ?? rec.indicators?.[pk] ?? (rec.indicators as any)?.[key] ?? 40;
  }
  if (rec.indicators && rec.indicators[key] !== undefined) {
    return rec.indicators[key];
  }
  if (rec[key] !== undefined && typeof rec[key] === 'number') {
    return rec[key];
  }
  const svi = rec.svi ?? (rec.indicators?.svi ?? 0.5);
  const mMeta = METRICS_CONFIG[key];
  if (mMeta?.bad === 'low') {
    return Math.max(50, 95 - svi * 35);
  }
  return Math.max(3, 12 + svi * 45);
}

export function MapViewCanvas({
  countyFips = '53033',
  tracts: initialTracts,
  selectedTractId,
  onSelectTract,
  onSelectCounty,
  metric = 'sdoh',
  layer = 'sdoh',
  heatmap = true,
  markers = true,
  height = 360,
  zoomable = true
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const rootGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const cachedRepoRef = useRef<any>(null);

  const [activeCid, setActiveCid] = useState<string>(countyFips);
  const [activeTid, setActiveTid] = useState<string | null>(selectedTractId || null);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    sub: string;
    metricLabel: string;
    metricVal: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    sub: '',
    metricLabel: '',
    metricVal: ''
  });

  // Sync external countyFips prop
  useEffect(() => {
    if (countyFips && countyFips !== activeCid) {
      setActiveCid(countyFips);
    }
  }, [countyFips]);

  useEffect(() => {
    let isMounted = true;

    async function renderMap() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';

      const repo = await getCountyRepository();
      if (!isMounted || !containerRef.current) return;
      cachedRepoRef.current = repo;

      if (!topoDataCache) {
        try {
          const res = await fetch('/us-counties.json');
          if (!res.ok) throw new Error('Failed to load county map data');
          topoDataCache = await res.json();
        } catch (e) {
          console.error(e);
          return;
        }
      }

      if (!isMounted || !topoDataCache) return;

      const pathGen = d3.geoPath();
      const targetCounty = repo.countyById.get(activeCid) || repo.counties[0];
      if (!targetCounty) return;

      const stateCounties = repo.countiesByState.get(targetCounty.st) || [targetCounty];

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none')
        .style('background', '#07111F');

      svgRef.current = svg;

      const defs = svg.append('defs');

      // Pulse animation style
      const pulseStyle = defs.append('style');
      pulseStyle.text(`
        @keyframes dMapPulse {
          0% { r: 3.5px; opacity: 0.95; }
          50% { r: 8.5px; opacity: 0.2; }
          100% { r: 3.5px; opacity: 0.95; }
        }
        .d-pulse-ring {
          animation: dMapPulse 2.2s ease-in-out infinite;
          transform-origin: center;
        }
      `);

      // Gentle Radial Gradient for Hotspot
      const heatGrad = defs.append('radialGradient')
        .attr('id', 'd-heat-glow')
        .attr('cx', '50%')
        .attr('cy', '50%')
        .attr('r', '50%');
      heatGrad.append('stop').attr('offset', '0%').attr('stop-color', '#2584EB').attr('stop-opacity', 0.42);
      heatGrad.append('stop').attr('offset', '40%').attr('stop-color', '#1E60BF').attr('stop-opacity', 0.22);
      heatGrad.append('stop').attr('offset', '75%').attr('stop-color', '#123A7D').attr('stop-opacity', 0.08);
      heatGrad.append('stop').attr('offset', '100%').attr('stop-color', '#07111F').attr('stop-opacity', 0);

      const clipPath = defs.append('clipPath').attr('id', 'd-county-clip').append('path');

      const rootG = svg.append('g').attr('class', 'd-root-group');
      rootGroupRef.current = rootG;

      // Group Layers
      const gCounties = rootG.append('g').attr('class', 'state-counties');
      const gHeat = rootG.append('g').attr('class', 'heat-layer').style('pointer-events', 'none');
      const gTracts = rootG.append('g').attr('class', 'tracts-layer').attr('clip-path', 'url(#d-county-clip)');
      const gSelCounty = rootG.append('g').attr('class', 'sel-county-outline').style('pointer-events', 'none');
      const gSelTract = rootG.append('g').attr('class', 'sel-tract-outline').style('pointer-events', 'none');
      const gMarkers = rootG.append('g').attr('class', 'markers-layer').style('pointer-events', 'none');

      let currentK = 1;
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 40])
        .translateExtent([[-600, -400], [1600, 1100]])
        .on('zoom', (event) => {
          rootG.attr('transform', event.transform);
          currentK = event.transform.k;
          gMarkers.selectAll('g.marker-pin').attr('transform', function (this: any) {
            const cx = d3.select(this).attr('data-cx');
            const cy = d3.select(this).attr('data-cy');
            return `translate(${cx}, ${cy}) scale(${1 / Math.sqrt(currentK)}) translate(${-cx}, ${-cy})`;
          });
        });

      if (zoomable) {
        svg.call(zoom).on('dblclick.zoom', null);
      }
      zoomBehaviorRef.current = zoom;

      // Color Scale Builder
      function getColorScale(mKey: string, lyrId: string) {
        const lyrConfig = MAP_LAYERS.find(l => l.id === lyrId) || MAP_LAYERS[0];
        const mConfig = METRICS_CONFIG[mKey] || { bad: 'high' };
        const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), ['#101B45', ...lyrConfig.ramp]);
        const vals = repo.counties.map((c: any) => getMetricVal(c, mKey));
        const qScale = d3.scaleQuantile().domain(vals).range(d3.range(7));
        const flip = mConfig.bad === 'low';
        const tOf = (i: number) => {
          const t = (i + 0.5) / 7;
          return flip ? 1 - t : t;
        };
        return (val: number) => interp(tOf(qScale(val)));
      }

      // Generate Voronoi Tracts for a county
      function getTracts(cRecord: CountyRecord) {
        if (tractCache.has(cRecord.id)) {
          return tractCache.get(cRecord.id)!;
        }

        const [[bx0, by0], [bx1, by1]] = pathGen.bounds(cRecord.feature);
        const bw = Math.max(bx1 - bx0, 10);
        const bh = Math.max(by1 - by0, 10);
        const count = Math.max(8, Math.min(26, Math.round(cRecord.pop / 4500)));

        let seed = 0;
        for (let i = 0; i < cRecord.id.length; i++) seed += cRecord.id.charCodeAt(i) * (i + 1) * 31;
        const prng = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        const pts: [number, number][] = [];
        for (let i = 0; i < count; i++) {
          const r1 = prng();
          const r2 = prng();
          pts.push([bx0 + bw * (0.12 + r1 * 0.76), by0 + bh * (0.12 + r2 * 0.76)]);
        }

        if (pts.length < 3) {
          pts.push([bx0 + bw * 0.5, by0 + bh * 0.5], [bx0 + 1, by0 + 1], [bx0 + bw - 1, by0 + bh - 1]);
        }

        const delaunay = d3.Delaunay.from(pts);
        const voronoi = delaunay.voronoi([bx0 - 20, by0 - 20, bx0 + bw + 20, by0 + bh + 20]);

        const out = pts.map((pt, i) => {
          const r1 = prng();
          const r2 = prng();
          const svi = Math.max(0.02, Math.min(0.99, cRecord.svi + (r1 - 0.5) * 0.35));
          const tNum = 101 + i * 2;
          const tractId = `${cRecord.id}${String(tNum).padStart(4, '0')}00`;

          return {
            id: tractId,
            name: `Census Tract ${tNum}`,
            countyId: cRecord.id,
            countyName: cRecord.name,
            stateAbbr: cRecord.stateAbbr,
            pop: Math.round(Math.max(800, cRecord.pop / count * (0.6 + r2 * 0.8))),
            svi,
            tier: Math.min(4, Math.floor(svi * 5)),
            cx: pt[0],
            cy: pt[1],
            d: voronoi.renderCell(i) || '',
            indicators: {
              sdoh: Math.round(cRecord.indicators.sdoh * (0.7 + r1 * 0.6)),
              incidence: Math.round(cRecord.indicators.incidence * (0.75 + r2 * 0.5)),
              utilization: Math.round(cRecord.indicators.utilization * (0.7 + prng() * 0.6)),
              poverty: Math.round(cRecord.indicators.poverty * (0.7 + r1 * 0.6) * 10) / 10,
              uninsured: Math.round(cRecord.indicators.uninsured * (0.75 + r2 * 0.5) * 10) / 10,
              diabetes: Math.round(cRecord.indicators.diabetes * (0.8 + prng() * 0.4) * 10) / 10,
              access: Math.round(cRecord.indicators.access * (0.8 + r2 * 0.4)),
              lifeExp: Math.round((cRecord.indicators.lifeExp - (svi - 0.5) * 6) * 10) / 10
            }
          };
        });

        tractCache.set(cRecord.id, out);
        return out;
      }

      // Render Surrounding State Counties
      const countyPaths = gCounties.selectAll<SVGPathElement, CountyRecord>('path.county')
        .data(stateCounties, (c: any) => c.id)
        .enter()
        .append('path')
        .attr('class', 'county')
        .attr('data-id', c => c.id)
        .attr('d', c => pathGen(c.feature) || '')
        .attr('fill', c => c.id === targetCounty.id ? '#101B45' : '#0B1530')
        .attr('opacity', c => c.id === targetCounty.id ? 1 : 0.45)
        .attr('stroke', c => c.id === targetCounty.id ? 'var(--cyan, #37C8CF)' : 'rgba(255, 255, 255, 0.08)')
        .attr('stroke-width', c => c.id === targetCounty.id ? 2.0 : 0.5)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('cursor', 'pointer');

      // Hover on outside surrounding counties
      countyPaths
        .on('pointerenter', function (event, c) {
          if (c.id !== currentDemonstratedCid) {
            d3.select(this)
              .attr('stroke', '#38BDF8')
              .attr('stroke-width', 1.6)
              .attr('opacity', 0.85);
          }
          const rect = container.getBoundingClientRect();
          const v = getMetricVal(c, metric);
          setTooltip({
            visible: true,
            x: event.clientX - rect.left + 14,
            y: event.clientY - rect.top - 14,
            title: `${c.name} County`,
            sub: `${c.stateAbbr} • ${Math.round(c.pop / 1000)}k residents`,
            metricLabel: METRICS_CONFIG[metric]?.short || 'Metric',
            metricVal: `${v.toFixed(1)}%`
          });
        })
        .on('pointermove', function (event) {
          const rect = container.getBoundingClientRect();
          setTooltip(prev => ({
            ...prev,
            x: event.clientX - rect.left + 14,
            y: event.clientY - rect.top - 14
          }));
        })
        .on('pointerleave', function (event, c) {
          if (c.id !== currentDemonstratedCid) {
            d3.select(this)
              .attr('stroke', 'rgba(255, 255, 255, 0.08)')
              .attr('stroke-width', 0.5)
              .attr('opacity', 0.45);
          }
          setTooltip(prev => ({ ...prev, visible: false }));
        })
        .on('click', function (event, c) {
          event.stopPropagation();
          // Shift demonstration to clicked outside region
          demonstrateCounty(c.id, true);
          if (onSelectCounty) onSelectCounty(c);
        });

      let currentDemonstratedCid = targetCounty.id;
      let currentScale = 3.5;

      // Function to focus and demonstrate a county with its tracts
      function demonstrateCounty(cid: string, animate = true) {
        currentDemonstratedCid = cid;
        setActiveCid(cid);
        const cRec = repo.countyById.get(cid);
        if (!cRec) return;

        const cD = pathGen(cRec.feature) || '';
        const [[bx0, by0], [bx1, by1]] = pathGen.bounds(cRec.feature);
        const bw = Math.max(bx1 - bx0, 10);
        const bh = Math.max(by1 - by0, 10);

        // Frame camera with generous padding so the county is big and prominently zoomed in
        const pad = 0.65;
        const s = Math.min(18, Math.max(2.4, pad / Math.max(bw / 975, bh / 610)));
        currentScale = s;
        const targetT = d3.zoomIdentity
          .translate(975 / 2, 610 / 2)
          .scale(s)
          .translate(-(bx0 + bx1) / 2, -(by0 + by1) / 2);

        if (animate) {
          svg.transition('d-zoom')
            .duration(800)
            .ease(d3.easeCubicInOut)
            .call(zoom.transform, targetT);
        } else {
          svg.call(zoom.transform, targetT);
        }

        // Highlight demonstrated county, dim peers
        countyPaths
          .transition('d-dim')
          .duration(300)
          .attr('fill', c => c.id === cid ? '#101B45' : '#0B1530')
          .attr('opacity', c => c.id === cid ? 1 : 0.45)
          .attr('stroke', c => c.id === cid ? 'var(--cyan, #37C8CF)' : 'rgba(255, 255, 255, 0.08)')
          .attr('stroke-width', c => c.id === cid ? 2.2 : 0.5);

        clipPath.attr('d', cD);

        gSelCounty.selectAll('*').remove();
        gSelCounty.append('path')
          .attr('d', cD)
          .attr('fill', 'none')
          .attr('stroke', 'var(--cyan, #37C8CF)')
          .attr('stroke-width', 2.2)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('filter', 'drop-shadow(0 0 8px rgba(55, 200, 207, 0.85))');

        // Draw Voronoi Tracts
        const tractsList = getTracts(cRec);
        gTracts.selectAll('*').remove();
        gSelTract.selectAll('*').remove();

        const colorScale = getColorScale(metric, layer);

        const tractPaths = gTracts.selectAll<SVGPathElement, any>('path.tract')
          .data(tractsList, (t: any) => t.id)
          .enter()
          .append('path')
          .attr('class', 'tract')
          .attr('d', (t: any) => t.d)
          .attr('data-id', (t: any) => t.id)
          .attr('fill', (t: any) => colorScale(getMetricVal(t, metric)))
          .attr('stroke', 'rgba(255, 255, 255, 0.45)')
          .attr('stroke-width', 0.8)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('cursor', 'pointer');

        tractPaths.attr('opacity', 0)
          .transition('d-tin')
          .delay((_, i) => 80 + i * 12)
          .duration(350)
          .attr('opacity', 1);

        tractPaths
          .on('pointerenter', function (event, t: any) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 2.0)
              .raise();

            const rect = container.getBoundingClientRect();
            const v = getMetricVal(t, metric);
            setTooltip({
              visible: true,
              x: event.clientX - rect.left + 14,
              y: event.clientY - rect.top - 14,
              title: t.name,
              sub: `${TIER_LABELS[t.tier]} Vulnerability • ${t.pop.toLocaleString()} residents`,
              metricLabel: METRICS_CONFIG[metric]?.short || 'Metric',
              metricVal: `${v.toFixed(1)}%`
            });
          })
          .on('pointermove', function (event) {
            const rect = container.getBoundingClientRect();
            setTooltip(prev => ({
              ...prev,
              x: event.clientX - rect.left + 14,
              y: event.clientY - rect.top - 14
            }));
          })
          .on('pointerleave', function () {
            d3.select(this)
              .attr('stroke', 'rgba(255, 255, 255, 0.45)')
              .attr('stroke-width', 0.8);
            setTooltip(prev => ({ ...prev, visible: false }));
          })
          .on('click', function (event, t: any) {
            event.stopPropagation();
            highlightTract(t);
            if (onSelectTract) onSelectTract(t);
          });

        // Heatmap
        gHeat.selectAll('*').remove();
        if (heatmap) {
          const topTracts = [...tractsList]
            .sort((a, b) => getMetricVal(b, metric) - getMetricVal(a, metric))
            .slice(0, Math.max(3, Math.ceil(tractsList.length * 0.35)));

          gHeat.selectAll('circle')
            .data(topTracts)
            .join('circle')
            .attr('cx', (d: any) => d.cx)
            .attr('cy', (d: any) => d.cy)
            .attr('r', 0)
            .attr('fill', 'url(#d-heat-glow)')
            .attr('opacity', 0.65)
            .transition()
            .duration(650)
            .attr('r', 16);
        }

        // Pulsing Need Markers
        gMarkers.selectAll('*').remove();
        if (markers) {
          const topPins = [...tractsList]
            .sort((a, b) => getMetricVal(b, metric) - getMetricVal(a, metric))
            .slice(0, 3);

          topPins.forEach(pt => {
            const mG = gMarkers.append('g')
              .attr('class', 'marker-pin')
              .attr('data-cx', pt.cx)
              .attr('data-cy', pt.cy)
              .attr('transform', `translate(${pt.cx}, ${pt.cy}) scale(${1 / Math.sqrt(currentK)}) translate(${-pt.cx}, ${-pt.cy})`);

            mG.append('circle')
              .attr('cx', pt.cx)
              .attr('cy', pt.cy)
              .attr('class', 'd-pulse-ring')
              .attr('fill', '#FF5D8F')
              .attr('opacity', 0.65);

            mG.append('circle')
              .attr('cx', pt.cx)
              .attr('cy', pt.cy)
              .attr('r', 2.8)
              .attr('fill', '#ffffff')
              .attr('stroke', '#FF5D8F')
              .attr('stroke-width', 1.2);
          });
        }
      }

      function highlightTract(t: any) {
        setActiveTid(t.id);
        gSelTract.selectAll('*').remove();
        gSelTract.append('path')
          .attr('d', t.d)
          .attr('fill', 'none')
          .attr('stroke', 'var(--cyan, #37C8CF)')
          .attr('stroke-width', 2.8)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('filter', 'drop-shadow(0 0 6px var(--cyan, #37C8CF))');

        // Smooth zoom closer into the clicked tract
        const zoomScale = Math.min(24, Math.max(currentScale * 1.35, 4.5));
        const tractT = d3.zoomIdentity
          .translate(975 / 2, 610 / 2)
          .scale(zoomScale)
          .translate(-t.cx, -t.cy);

        svg.transition('tract-zoom')
          .duration(550)
          .ease(d3.easeCubicInOut)
          .call(zoom.transform, tractT);
      }

      // Initial demonstration
      demonstrateCounty(targetCounty.id, false);
    }

    renderMap();

    return () => {
      isMounted = false;
    };
  }, [activeCid, metric, layer, heatmap, markers]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      svgRef.current.transition().duration(300).call(zoomBehaviorRef.current.scaleBy, 1.4);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      svgRef.current.transition().duration(300).call(zoomBehaviorRef.current.scaleBy, 1 / 1.4);
    }
  };

  const handleResetZoom = () => {
    if (svgRef.current && zoomBehaviorRef.current && cachedRepoRef.current) {
      const cRec = cachedRepoRef.current.countyById.get(activeCid);
      if (cRec) {
        const pathGen = d3.geoPath();
        const [[bx0, by0], [bx1, by1]] = pathGen.bounds(cRec.feature);
        const bw = Math.max(bx1 - bx0, 10);
        const bh = Math.max(by1 - by0, 10);
        const pad = 0.65;
        const s = Math.min(18, Math.max(2.4, pad / Math.max(bw / 975, bh / 610)));
        const targetT = d3.zoomIdentity
          .translate(975 / 2, 610 / 2)
          .scale(s)
          .translate(-(bx0 + bx1) / 2, -(by0 + by1) / 2);
        svgRef.current.transition().duration(400).ease(d3.easeCubicInOut).call(zoomBehaviorRef.current.transform, targetT);
      }
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl bg-[#07111F]">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Floating Zoom Controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 p-1 bg-[#0c1427]/90 backdrop-blur-md rounded-xl border border-[rgba(255,255,255,0.15)] shadow-lg z-20">
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-white hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-white hover:bg-[var(--surface-2)] transition-colors"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleResetZoom}
          title="Reset View"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-white hover:bg-[var(--surface-2)] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none p-3 rounded-xl bg-[#0c1427]/95 backdrop-blur-xl border border-[rgba(255,255,255,0.18)] shadow-2xl min-w-[160px] text-white text-[12px] animate-in fade-in-50 duration-100"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <b className="block text-[12.5px] font-bold text-white leading-tight">{tooltip.title}</b>
          <div className="text-[10.5px] text-[rgba(255,255,255,0.5)] mt-0.5 mb-1.5">{tooltip.sub}</div>
          <div className="flex justify-between items-center text-[11px] border-t border-[rgba(255,255,255,0.1)] pt-1.5">
            <span className="text-[rgba(255,255,255,0.6)]">{tooltip.metricLabel}:</span>
            <b className="num text-[var(--cyan)] font-bold">{tooltip.metricVal}</b>
          </div>
        </div>
      )}
    </div>
  );
}
