'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

interface ZScoreMatrixProps {
  rows: string[];
  cols: string[];
  matrixData: number[][]; // [rowIdx][colIdx] z-scores
  height?: number;
}

export function ZScoreMatrix({
  rows,
  cols,
  matrixData,
  height = 240
}: ZScoreMatrixProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    row: string;
    col: string;
    val: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    row: '',
    col: '',
    val: ''
  });

  useEffect(() => {
    if (!containerRef.current || matrixData.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const width = container.clientWidth || 800;
    const labelW = Math.min(140, width * 0.25);
    const cellW = (width - labelW - 10) / cols.length;
    const cellH = 34;
    const totalH = rows.length * cellH + 36;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${totalH}`)
      .attr('width', '100%')
      .attr('height', '100%');

    // Diverging color interpolator: Teal (-1.6) -> Neutral Dark (0) -> Rose (+1.6)
    const colorScale = (v: number) => {
      const t = Math.max(0, Math.min(1, (v + 1.6) / 3.2));
      return d3.piecewise(d3.interpolateRgb, ['#37C8CF', '#101B45', '#F43F5E'])(t);
    };

    // Column Headers
    cols.forEach((col, j) => {
      svg.append('text')
        .attr('x', labelW + j * cellW + cellW / 2)
        .attr('y', 16)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--muted, rgba(255,255,255,0.65))')
        .attr('font-size', '11px')
        .attr('font-weight', 'bold')
        .text(col);
    });

    // Rows and Heatmap Cells
    rows.forEach((row, i) => {
      // Row Label
      svg.append('text')
        .attr('x', 0)
        .attr('y', 36 + i * cellH + cellH / 2 + 3)
        .attr('fill', 'var(--text, #ffffff)')
        .attr('font-size', '11.5px')
        .attr('font-weight', '600')
        .text(row);

      // Row Cells
      cols.forEach((col, j) => {
        const val = matrixData[i]?.[j] ?? 0;
        const cellX = labelW + j * cellW + 2;
        const cellY = 28 + i * cellH + 2;
        const fmtVal = (val > 0 ? '+' : '') + val.toFixed(2);

        const rect = svg.append('rect')
          .attr('x', cellX)
          .attr('y', cellY)
          .attr('width', cellW - 4)
          .attr('height', cellH - 4)
          .attr('rx', 4)
          .attr('fill', colorScale(val))
          .attr('stroke', 'rgba(255, 255, 255, 0.1)')
          .attr('stroke-width', 0.8)
          .attr('class', 'cursor-pointer hover:opacity-80 transition-opacity')
          .on('pointerenter', (event) => {
            const b = container.getBoundingClientRect();
            setTooltip({
              visible: true,
              x: event.clientX - b.left + 10,
              y: event.clientY - b.top - 10,
              row,
              col,
              val: `${fmtVal} SD vs national mean`
            });
          })
          .on('pointermove', (event) => {
            const b = container.getBoundingClientRect();
            setTooltip(prev => ({
              ...prev,
              x: event.clientX - b.left + 10,
              y: event.clientY - b.top - 10
            }));
          })
          .on('pointerleave', () => setTooltip(prev => ({ ...prev, visible: false })));

        if (cellW > 48) {
          svg.append('text')
            .attr('x', cellX + (cellW - 4) / 2)
            .attr('y', cellY + (cellH - 4) / 2 + 3.5)
            .attr('text-anchor', 'middle')
            .attr('fill', '#ffffff')
            .attr('font-size', '10.5px')
            .attr('font-weight', 'bold')
            .attr('font-family', 'var(--font-m, monospace)')
            .attr('pointer-events', 'none')
            .text(fmtVal);
        }
      });
    });

  }, [rows, cols, matrixData, height]);

  return (
    <div className="relative w-full overflow-x-auto">
      <div ref={containerRef} className="w-full min-w-[600px]" style={{ minHeight: `${height}px` }} />

      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-2 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-xl text-left animate-in fade-in"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="text-[11px] font-bold text-[var(--muted)]">{tooltip.row} • {tooltip.col}</div>
          <div className="text-[12px] font-bold text-[var(--cyan)] num mt-0.5">{tooltip.val}</div>
        </div>
      )}
    </div>
  );
}
