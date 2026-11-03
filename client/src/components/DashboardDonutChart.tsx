'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

interface DashboardDonutChartProps {
  data: DonutDatum[];
  size?: number;
  centerCount?: number;
  centerLabel?: string;
}

export function DashboardDonutChart({
  data,
  size = 170,
  centerCount,
  centerLabel = 'Tracts'
}: DashboardDonutChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    share: string;
    count: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    share: '',
    count: 0
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Clear previous SVG
    d3.select(el).selectAll('*').remove();

    const W = el.clientWidth || size;
    const S = Math.min(W, size);
    const H = S;

    const svg = d3
      .select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', W)
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible');

    const g = svg
      .append('g')
      .attr('transform', `translate(${W / 2},${H / 2})`);

    const pie = d3
      .pie<DonutDatum>()
      .value((d) => d.value)
      .sort(null)
      .padAngle(0.025);

    const arc = d3
      .arc<d3.PieArcDatum<DonutDatum>>()
      .innerRadius(S * 0.4)
      .outerRadius(S * 0.47)
      .cornerRadius(1);

    const arcHover = d3
      .arc<d3.PieArcDatum<DonutDatum>>()
      .innerRadius(S * 0.38)
      .outerRadius(S * 0.49)
      .cornerRadius(1);

    const total = d3.sum(data, (d) => d.value) || 1;

    const paths = g
      .selectAll<SVGPathElement, d3.PieArcDatum<DonutDatum>>('path')
      .data(pie(data))
      .join('path')
      .attr('fill', (d) => d.data.color)
      .style('cursor', 'pointer')
      .style('transition', 'filter 0.2s');

    // Smooth clockwise arc growth animation matching prototype:
    paths
      .transition()
      .duration(1100)
      .delay((_, i) => i * 90)
      .ease(d3.easeCubicOut)
      .attrTween('d', (d) => {
        const interpolate = d3.interpolate(
          { startAngle: d.startAngle, endAngle: d.startAngle },
          d
        );
        return (t) => arc(interpolate(t)) || '';
      });

    // Tooltip and hover handlers
    paths
      .on('pointerenter', function (e, d) {
        d3.select(this)
          .transition()
          .duration(180)
          .attr('d', (d: any) => arcHover(d) || '')
          .style('filter', 'drop-shadow(0 2px 8px rgba(0,0,0,0.25))');

        const rect = el.getBoundingClientRect();
        const share = ((d.data.value / total) * 100).toFixed(1) + '%';

        setTooltip({
          visible: true,
          x: e.clientX - rect.left + 12,
          y: e.clientY - rect.top - 20,
          title: d.data.label,
          share,
          count: d.data.value
        });
      })
      .on('pointermove', function (e) {
        const rect = el.getBoundingClientRect();
        setTooltip((prev) => ({
          ...prev,
          x: e.clientX - rect.left + 12,
          y: e.clientY - rect.top - 20
        }));
      })
      .on('pointerleave', function () {
        d3.select(this)
          .transition()
          .duration(180)
          .attr('d', (d: any) => arc(d) || '')
          .style('filter', 'none');

        setTooltip((prev) => ({ ...prev, visible: false }));
      });

    // Center text readout
    const centerTot = centerCount !== undefined ? centerCount : total;
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '.1em')
      .attr('class', 'num')
      .style('font-family', 'var(--font-d)')
      .style('font-size', `${S * 0.14}px`)
      .style('font-weight', '700')
      .style('fill', 'var(--text)')
      .text(centerTot.toLocaleString('en-US'));

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.8em')
      .style('font-family', 'var(--font-u)')
      .style('font-size', `${S * 0.065}px`)
      .style('font-weight', '600')
      .style('letter-spacing', '0.06em')
      .style('fill', 'var(--faint)')
      .text(centerLabel.toUpperCase());
  }, [data, size, centerCount, centerLabel]);

  return (
    <div ref={containerRef} style={{ width: `${size}px`, height: `${size}px`, position: 'relative' }}>
      {tooltip.visible && (
        <div
          style={{
            position: 'absolute',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            background: 'var(--surface-solid)',
            border: '1px solid var(--line-strong)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow)',
            padding: '8px 10px',
            fontSize: '11.5px',
            pointerEvents: 'none',
            zIndex: 50,
            whiteSpace: 'nowrap',
            color: 'var(--text)'
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '2px' }}>{tooltip.title}</div>
          <div style={{ display: 'flex', gap: '8px', color: 'var(--muted)', fontSize: '11px' }}>
            <span>Share: <b style={{ color: 'var(--text)' }}>{tooltip.share}</b></span>
            <span>Tracts: <b style={{ color: 'var(--text)' }}>{tooltip.count}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
