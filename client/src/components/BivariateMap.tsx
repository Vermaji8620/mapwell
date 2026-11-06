'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CensusTract } from '@/types';
import { STATE_META, getCountyRepository } from '@/utils/countyRepository';
import { useSession } from '@/context/SessionContext';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export interface BivariateMapProps {
  countyFips: string;
  countyName?: string;
  tracts: CensusTract[];
  programKey: string;
  programLabel: string;
  selectedTractId?: string | null;
  onSelectTract?: (tract: CensusTract) => void;
  onCountySelect?: (countyFips: string) => void;
  height?: number;
  theme?: 'light' | 'dark';
}

// 3x3 Bivariate Matrix Palette: [Need (0=Low, 1=Mid, 2=High)][Low Utilization (0=High Util, 1=Mid Util, 2=Low Util)]
export const BIV_MATRIX = [
  ['#E4F1FB', '#B9D7F0', '#8FB8E3'],
  ['#BDEDEF', '#8FC3DE', '#4F86CF'],
  ['#5DD0D5', '#2E93C9', '#173F8A']
];

let topoCache: any = null;
const dynamicTractsCache = new Map<string, CensusTract[]>();

// Tooltip helpers matching MapWell standard #tooltip
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

export const BivariateMap = React.memo(function BivariateMap({
  countyFips,
  countyName = 'County',
  tracts,
  programKey,
  programLabel,
  selectedTractId,
  onSelectTract,
  onCountySelect,
  height = 440,
  theme
}: BivariateMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionCtx = useSession();
  const activeTheme = theme || sessionCtx?.theme || 'light';
  const isDark = activeTheme === 'dark';
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const resetZoomRef = useRef<(() => void) | null>(null);
  const currentTransformRef = useRef<d3.ZoomTransform | null>(null);

  const switchCountyRef = useRef<((targetCid: string) => void) | null>(null);
  const onSelectTractRef = useRef(onSelectTract);
  onSelectTractRef.current = onSelectTract;
  const onCountySelectRef = useRef(onCountySelect);
  onCountySelectRef.current = onCountySelect;
  const selectedTractIdRef = useRef(selectedTractId);
  selectedTractIdRef.current = selectedTractId;

  const getTractUtil = (t: CensusTract, key: string): number => {
    if (key === 'all') {
      const prog = t.prog;
      if (!prog) return 50;
      const vals = Object.values(prog);
      return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    }
    const val = t.prog ? (t.prog as any)[key] : (t.indicators as any)?.[`prog.${key}`];
    return typeof val === 'number' ? val : 50;
  };

  const computeBivColor = (u: number, svi: number, uq: [number, number], sq: [number, number]) => {
    const nb = svi < sq[0] ? 0 : svi < sq[1] ? 1 : 2;
    const ub = u > uq[1] ? 0 : u > uq[0] ? 1 : 2;
    return BIV_MATRIX[nb][ub];
  };

  // Sync prop changes for county switching
  useEffect(() => {
    if (switchCountyRef.current) {
      switchCountyRef.current(countyFips);
    }
  }, [countyFips]);

  // Lightweight stroke update when selectedTractId changes without re-rendering the whole map
  useEffect(() => {
    if (!containerRef.current) return;
    d3.select(containerRef.current)
      .selectAll<SVGPathElement, CensusTract>('path.tract-cell')
      .each(function (t) {
        const isSelected = t._id === selectedTractId;
        const isHot = d3.select(this).classed('hotspot-tract');
        d3.select(this)
          .attr('stroke', isSelected || isHot ? 'var(--cyan)' : isDark ? 'rgba(255, 255, 255, 0.65)' : '#ffffff')
          .attr('stroke-width', isSelected ? 2.6 : isHot ? 2.0 : 0.75);
        if (isSelected) {
          d3.select(this).raise();
        }
      });
  }, [selectedTractId, isDark]);

  useEffect(() => {
    let isMounted = true;

    async function renderBivariate() {
      if (!containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = '';

      const [repo] = await Promise.all([
        getCountyRepository(),
        topoCache ? Promise.resolve() : fetch('/us-counties.json').then(r => r.json()).then(j => { topoCache = j; })
      ]);

      if (!isMounted || !topoCache || !containerRef.current) return;

      const counties = (topojson.feature(topoCache, topoCache.objects.counties) as any).features;
      const initialTarget =
        counties.find((c: any) => c.id === countyFips) ||
        counties.find((c: any) => c.id === '21027') ||
        counties.find((c: any) => c.id === '53033') ||
        counties[0];

      if (!initialTarget) return;

      const statePrefix = initialTarget.id ? initialTarget.id.slice(0, 2) : '21';
      const stateAbbr = STATE_META[statePrefix]?.[0] || 'KY';
      const stateCounties = counties.filter((c: any) => c.id && c.id.slice(0, 2) === statePrefix);

      const pathGen = d3.geoPath();

      const svg = d3.select(container)
        .append('svg')
        .attr('viewBox', '0 0 975 610')
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'w-full h-full block select-none map-svg dim-others')
        .style('background', 'transparent');

      // Defs
      const defs = svg.append('defs');
      const clipId = `biv-clip-active-${Math.random().toString(36).substring(2, 6)}`;

      const clipPathElement = defs.append('clipPath')
        .attr('id', clipId)
        .append('path');

      const pulseStyle = defs.append('style');
      pulseStyle.text(`
        @keyframes hotspotGlow {
          0%, 100% {
            stroke-opacity: 0.7;
            stroke-width: 1.8px;
          }
          50% {
            stroke-opacity: 1;
            stroke-width: 2.4px;
          }
        }
        .hotspot-tract {
          animation: hotspotGlow 2.8s ease-in-out infinite;
        }
      `);

      const rootGroup = svg.append('g').attr('class', 'map-root');

      // Interactive Zoom Behavior (Wheel zoom in/out with preventDefault, drag pan)
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 90])
        .translateExtent([[-200, -200], [1175, 810]])
        .on('zoom', (event) => {
          rootGroup.attr('transform', event.transform);
          if (event.sourceEvent && event.sourceEvent.type === 'wheel') {
            hideTip();
          }
        });

      svg.call(zoom).on('dblclick.zoom', null);

      zoomInRef.current = () => {
        svg.transition().duration(300).call(zoom.scaleBy, 1.4);
      };
      zoomOutRef.current = () => {
        svg.transition().duration(300).call(zoom.scaleBy, 0.7);
      };
      resetZoomRef.current = () => {
        if (currentTransformRef.current) {
          svg.transition().duration(600).ease(d3.easeCubicInOut).call(zoom.transform, currentTransformRef.current);
        }
      };

      // Layers:
      // 1. Ambient surrounding counties
      const gSurround = rootGroup.append('g').attr('class', 'surrounding-counties');
      // 2. Base silhouette of demonstrated county
      const gTargetBase = rootGroup.append('g').attr('class', 'target-county-base');
      const baseCountyPath = gTargetBase.append('path')
        .attr('fill', isDark ? '#101B45' : '#D7ECFC')
        .attr('opacity', 0.95);
      // 3. Clipped Tracts Group
      const gTracts = rootGroup.append('g').attr('class', 'tracts-group').attr('clip-path', `url(#${clipId})`);
      // 4. Boundary Contour
      const gSel = rootGroup.append('g').attr('class', 'target-county-outline');
      const outlineCountyPath = gSel.append('path')
        .attr('fill', 'none')
        .attr('stroke', isDark ? 'var(--cyan)' : '#102A4C')
        .attr('stroke-width', isDark ? 2.2 : 1.8)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('filter', isDark ? 'drop-shadow(0 0 6px var(--cyan))' : 'none')
        .style('pointer-events', 'none');

      // Synthetic Tract Generator for outside counties
      function getOrGenerateTracts(targetCid: string, _targetFeature: any): CensusTract[] {
        if (targetCid === countyFips && tracts.length > 0) {
          return tracts;
        }
        if (dynamicTractsCache.has(targetCid)) {
          return dynamicTractsCache.get(targetCid)!;
        }

        const count = 16;
        let seed = 0;
        for (let i = 0; i < targetCid.length; i++) seed += targetCid.charCodeAt(i) * (i + 1) * 37;
        const prng = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        const generated: CensusTract[] = [];
        for (let i = 0; i < count; i++) {
          const r1 = prng();
          const r2 = prng();
          const sviVal = 0.14 + r1 * 0.8;
          const utilVal = 25 + r2 * 60;
          const tractId = `${targetCid}${String(101 + i).padStart(4, '0')}00`;
          generated.push({
            _id: tractId,
            countyFips: targetCid,
            name: `Census Tract ${101 + i}`,
            population: Math.round(2400 + prng() * 4600),
            svi: Math.round(sviVal * 100) / 100,
            tier: Math.min(4, Math.floor(sviVal * 5)),
            prog: {
              all: Math.round(utilVal),
              wic: Math.round(utilVal * (0.8 + prng() * 0.4)),
              imm: Math.round(utilVal * (0.85 + prng() * 0.3)),
              dpp: Math.round(utilVal * (0.75 + prng() * 0.5)),
              tob: Math.round(utilVal * (0.9 + prng() * 0.3)),
              mhv: Math.round(utilVal * (0.7 + prng() * 0.5))
            },
            indicators: {
              svi: Math.round(sviVal * 100) / 100,
              uninsured: Math.round((6.5 + prng() * 11) * 10) / 10,
              poverty: Math.round((7.5 + prng() * 18) * 10) / 10,
              noVehicle: Math.round((7 + prng() * 16) * 10) / 10
            }
          } as any);
        }

        dynamicTractsCache.set(targetCid, generated);
        return generated;
      }

      // Main demonstration switcher function
      let currentCid = countyFips;

      async function demonstrateCounty(targetCid: string, animateCamera = true) {
        currentCid = targetCid;

        const targetFeature =
          counties.find((c: any) => c.id === targetCid) ||
          initialTarget;

        const countyD = pathGen(targetFeature) || '';
        const [[cx0, cy0], [cx1, cy1]] = pathGen.bounds(targetFeature);
        const cWidth = Math.max(cx1 - cx0, 10);
        const cHeight = Math.max(cy1 - cy0, 10);

        // 1. Update Clip Path & Target County Outlines
        clipPathElement.attr('d', countyD);
        baseCountyPath.attr('d', countyD).attr('fill', isDark ? '#101B45' : '#D7ECFC');
        if (isDark) {
          outlineCountyPath
            .attr('d', countyD)
            .attr('stroke', 'var(--cyan)')
            .attr('stroke-width', 2.2)
            .style('filter', 'drop-shadow(0 0 6px var(--cyan))');
        } else {
          outlineCountyPath
            .attr('d', countyD)
            .attr('stroke', '#102A4C')
            .attr('stroke-width', 1.8)
            .style('filter', 'none');
        }

        // 2. Camera Zoom Transition
        const pad = 0.68;
        const s = Math.min(24, pad / Math.max(cWidth / 975, cHeight / 610));
        const targetTransform = d3.zoomIdentity
          .translate(975 / 2, 610 / 2)
          .scale(s)
          .translate(-(cx0 + cx1) / 2, -(cy0 + cy1) / 2);

        currentTransformRef.current = targetTransform;

        if (animateCamera) {
          svg
            .transition('camera-zoom')
            .duration(850)
            .ease(d3.easeCubicInOut)
            .call(zoom.transform, targetTransform);
        } else {
          svg.call(zoom.transform, targetTransform);
        }

        // 3. Render Ambient Surrounding Counties
        const ambientCounties = stateCounties.filter((c: any) => c.id !== targetCid);
        const surroundSelection = gSurround.selectAll<SVGPathElement, any>('path.county-ambient')
          .data(ambientCounties, (d: any) => d.id);

        surroundSelection.exit().remove();

        const getAmbientFill = (d: any) => {
          const cRec = repo.countyById.get(d.id);
          const svi = cRec?.svi ?? 0.5;
          const util = cRec?.indicators?.utilization ?? 50;
          return computeBivColor(util, svi, [40, 60], [0.33, 0.66]);
        };

        const enterAmbient = surroundSelection.enter()
          .append('path')
          .attr('class', 'county-ambient')
          .attr('d', (d: any) => pathGen(d) || '')
          .attr('fill', getAmbientFill)
          .attr('fill-opacity', isDark ? 0.32 : 1)
          .attr('opacity', isDark ? 1 : 0.28)
          .attr('stroke', isDark ? 'rgba(141, 170, 200, 0.45)' : 'rgba(255, 255, 255, 0.75)')
          .attr('stroke-width', isDark ? 0.6 : 0.5)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('cursor', 'pointer')
          .style('transition', 'fill 0.2s ease, opacity 0.2s ease, stroke 0.2s ease');

        const allAmbient = enterAmbient.merge(surroundSelection as any);

        allAmbient
          .attr('d', (d: any) => pathGen(d) || '')
          .attr('fill', getAmbientFill)
          .attr('fill-opacity', isDark ? 0.32 : 1)
          .attr('opacity', isDark ? 1 : 0.28)
          .attr('stroke', isDark ? 'rgba(141, 170, 200, 0.45)' : 'rgba(255, 255, 255, 0.75)')
          .attr('stroke-width', isDark ? 0.6 : 0.5)
          .on('pointerenter', function (event: MouseEvent, d: any) {
            const cRec = repo.countyById.get(d.id);
            const svi = cRec?.svi ?? 0.5;
            const util = cRec?.indicators?.utilization ?? 50;
            d3.select(this)
              .attr('fill-opacity', isDark ? 0.85 : 1)
              .attr('opacity', isDark ? 1 : 0.85)
              .attr('stroke', 'var(--cyan)')
              .attr('stroke-width', 1.6);

            const hoverName = cRec
              ? `${cRec.name} ${cRec.st === '22' ? 'Parish' : cRec.st === '02' ? 'Borough' : 'County'}, ${stateAbbr}`
              : `${d.properties?.name || 'County'} County, ${stateAbbr}`;

            showTip(
              `<b>${hoverName}</b>${tipRows([
                ['Status', 'Adjacent county'],
                ['Vulnerability (SVI)', svi.toFixed(2)],
                ['Program utilization', `${Math.round(util)}%`]
              ])}<div class="note" style="margin-top:5px">Click to demonstrate county</div>`,
              event
            );
          })
          .on('pointermove', function (event: MouseEvent) {
            moveTip(event);
          })
          .on('pointerleave', function () {
            d3.select(this)
              .attr('fill-opacity', isDark ? 0.32 : 1)
              .attr('opacity', isDark ? 1 : 0.28)
              .attr('stroke', isDark ? 'rgba(141, 170, 200, 0.45)' : 'rgba(255, 255, 255, 0.75)')
              .attr('stroke-width', isDark ? 0.6 : 0.5);
            hideTip();
          })
          .on('click', function (event, d: any) {
            event.stopPropagation();
            demonstrateCounty(d.id, true);
            if (onCountySelectRef.current) {
              onCountySelectRef.current(d.id);
            }
          });

        // 4. Load or Generate Census Tracts for Demonstrated Region
        const activeTracts = getOrGenerateTracts(targetCid, targetFeature);

        // Fetch server tracts asynchronously if not yet cached
        if (targetCid !== countyFips && !dynamicTractsCache.has(targetCid)) {
          fetch(`/api/tracts?county=${targetCid}`)
            .then(res => (res.ok ? res.json() : null))
            .then(json => {
              if (json && Array.isArray(json.data) && json.data.length > 0) {
                dynamicTractsCache.set(targetCid, json.data);
                if (currentCid === targetCid) {
                  renderTractCells(json.data, targetFeature, cx0, cy0, cWidth, cHeight);
                }
              }
            })
            .catch(() => {});
        }

        renderTractCells(activeTracts, targetFeature, cx0, cy0, cWidth, cHeight);
      }

      function renderTractCells(
        activeTracts: CensusTract[],
        _targetFeature: any,
        cx0: number,
        cy0: number,
        cWidth: number,
        cHeight: number
      ) {
        gTracts.selectAll('*').remove();
        if (activeTracts.length === 0) return;

        // Tertiles calculation
        const utils = activeTracts.map(t => getTractUtil(t, programKey)).sort(d3.ascending);
        const svis = activeTracts.map(t => t.svi).sort(d3.ascending);

        const uq: [number, number] = [
          d3.quantile(utils, 1 / 3) ?? 40,
          d3.quantile(utils, 2 / 3) ?? 60
        ];
        const sq: [number, number] = [
          d3.quantile(svis, 1 / 3) ?? 0.33,
          d3.quantile(svis, 2 / 3) ?? 0.66
        ];

        // Identify top coverage gaps
        const topGapIds = new Set(
          [...activeTracts]
            .sort((a, b) => {
              const gapA = a.svi * (100 - getTractUtil(a, programKey));
              const gapB = b.svi * (100 - getTractUtil(b, programKey));
              return gapB - gapA;
            })
            .slice(0, 6)
            .map(t => t._id)
        );

        // Voronoi Mesh Generation
        const points: [number, number][] = [];
        let seed = 0;
        for (let i = 0; i < currentCid.length; i++) seed += currentCid.charCodeAt(i) * (i + 1) * 37;
        const prng = () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };

        for (let i = 0; i < activeTracts.length; i++) {
          const r1 = prng();
          const r2 = prng();
          const px = cx0 + cWidth * (0.12 + r1 * 0.76);
          const py = cy0 + cHeight * (0.12 + r2 * 0.76);
          points.push([px, py]);
        }

        if (points.length < 3) {
          points.push([cx0 + cWidth * 0.5, cy0 + cHeight * 0.5], [cx0 + 1, cy0 + 1], [cx0 + cWidth - 1, cy0 + cHeight - 1]);
        }

        const delaunay = d3.Delaunay.from(points);
        const voronoi = delaunay.voronoi([cx0 - 20, cy0 - 20, cx0 + cWidth + 20, cy0 + cHeight + 20]);

        // Draw Tract Elements
        const paths = gTracts.selectAll<SVGPathElement, CensusTract>('path.tract-cell')
          .data(activeTracts)
          .enter()
          .append('path')
          .attr('d', (_, i) => voronoi.renderCell(i) || '')
          .attr('data-id', t => t._id)
          .attr('fill', t => {
            const util = getTractUtil(t, programKey);
            return computeBivColor(util, t.svi, uq, sq);
          })
          .attr('stroke', t => {
            if (t._id === selectedTractId) return 'var(--cyan)';
            if (topGapIds.has(t._id)) return 'var(--cyan)';
            return isDark ? 'rgba(255, 255, 255, 0.65)' : '#ffffff';
          })
          .attr('stroke-width', t => {
            if (t._id === selectedTractId) return 2.6;
            if (topGapIds.has(t._id)) return 2.0;
            return 0.75;
          })
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('class', t => {
            const isHot = topGapIds.has(t._id);
            return `tract-cell cursor-pointer ${isHot ? 'hotspot-tract' : ''}`;
          })
          .style('filter', t => (topGapIds.has(t._id) ? 'drop-shadow(0 0 5px rgba(56, 189, 248, 0.65))' : 'none'));

        paths.filter(t => topGapIds.has(t._id)).raise();

        // Staggered Entrance Fade-in & Outline Draw Sweep
        paths.attr('opacity', 0)
          .transition('tin')
          .delay((_, i) => 180 + i * 14)
          .duration(450)
          .attr('opacity', 1);

        paths.each(function () {
          const elNode = this as SVGPathElement;
          const L = elNode.getTotalLength ? elNode.getTotalLength() : 120;
          d3.select(this)
            .attr('stroke-dasharray', `${L} ${L}`)
            .attr('stroke-dashoffset', L);
        })
        .transition('tdraw')
        .delay((_, i) => 150 + i * 14)
        .duration(800)
        .ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0)
        .on('end', function () {
          d3.select(this).attr('stroke-dasharray', null);
        });

        // Hover Tooltips on Tracts
        paths
          .on('pointerenter', function (event: MouseEvent, tract) {
            d3.select(this)
              .attr('stroke', '#ffffff')
              .attr('stroke-width', 2.4)
              .raise();

            const util = getTractUtil(tract, programKey);
            const gap = tract.svi * (100 - util);
            const tier = tract.tier ?? Math.min(4, Math.floor(tract.svi * 5));
            const tierName = ['Very low', 'Low', 'Moderate', 'High', 'Very high'][tier] || 'Moderate';

            showTip(
              `<b>${tract.name || `Tract ${tract._id}`}</b>${tipRows([
                ['GEOID', tract._id],
                [`${programLabel} utilization`, `${util.toFixed(0)}%`],
                ['Vulnerability (SVI)', `${tract.svi.toFixed(2)} (${tierName})`],
                ['Coverage gap score', `${Math.round(gap)}`],
                ['Population', (tract.population || 4000).toLocaleString()]
              ])}<div class="note" style="margin-top:5px">Click to open tract explorer</div>`,
              event
            );
          })
          .on('pointermove', function (event: MouseEvent) {
            moveTip(event);
          })
          .on('pointerleave', function (_, tract) {
            const isHot = topGapIds.has(tract._id);
            const isSelected = tract._id === selectedTractId;

            d3.select(this)
              .attr('stroke', isSelected || isHot ? 'var(--cyan)' : isDark ? 'rgba(255, 255, 255, 0.65)' : '#ffffff')
              .attr('stroke-width', isSelected ? 2.6 : isHot ? 2.0 : 0.75);

            if (isHot || isSelected) {
              d3.select(this).raise();
            }

            hideTip();
          })
          .on('click', function (_, tract) {
            if (onSelectTractRef.current) {
              onSelectTractRef.current(tract);
            }
          });
      }

      switchCountyRef.current = (cid: string) => {
        demonstrateCounty(cid, true);
      };

      // Initial demonstration
      demonstrateCounty(countyFips, false);
    }

    renderBivariate();

    return () => {
      isMounted = false;
      hideTip();
      if (containerRef.current) {
        d3.select(containerRef.current).selectAll('*').interrupt();
      }
    };
  }, [countyFips, tracts, programKey, height, isDark]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full select-none relative"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: isDark ? '#07111F' : '#F3F9FE'
      }}
    >
      {/* Floating Zoom Controls matching CensusTractMap & prototype */}
      <div
        className="map-float absolute right-3 top-3 z-20 flex flex-col gap-1 p-1.5"
        style={
          isDark
            ? {
                background: 'rgba(11, 28, 50, 0.92)',
                border: '1px solid rgba(141, 170, 200, 0.25)',
                borderRadius: '12px',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)'
              }
            : {
                background: 'rgba(255, 255, 255, 0.92)',
                border: '1px solid #DCEAF5',
                borderRadius: '12px',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)'
              }
        }
      >
        <button
          onClick={() => zoomInRef.current?.()}
          aria-label="Zoom in"
          title="Zoom In"
          className={
            isDark
              ? 'w-7 h-7 rounded-lg flex items-center justify-center text-[rgba(141,170,200,0.9)] hover:text-white hover:bg-white/10 transition-colors'
              : 'w-7 h-7 rounded-lg flex items-center justify-center text-[#56628A] hover:text-[#102A4C] hover:bg-[#F0F7FD] transition-colors'
          }
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => zoomOutRef.current?.()}
          aria-label="Zoom out"
          title="Zoom Out"
          className={
            isDark
              ? 'w-7 h-7 rounded-lg flex items-center justify-center text-[rgba(141,170,200,0.9)] hover:text-white hover:bg-white/10 transition-colors'
              : 'w-7 h-7 rounded-lg flex items-center justify-center text-[#56628A] hover:text-[#102A4C] hover:bg-[#F0F7FD] transition-colors'
          }
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => resetZoomRef.current?.()}
          aria-label="Reset zoom"
          title="Reset to County"
          className={
            isDark
              ? 'w-7 h-7 rounded-lg flex items-center justify-center text-[rgba(141,170,200,0.9)] hover:text-white hover:bg-white/10 transition-colors'
              : 'w-7 h-7 rounded-lg flex items-center justify-center text-[#56628A] hover:text-[#102A4C] hover:bg-[#F0F7FD] transition-colors'
          }
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});
