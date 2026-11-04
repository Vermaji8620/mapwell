'use client';

import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import * as d3 from 'd3';
import { gsap } from 'gsap';
import { useSession } from '@/context/SessionContext';
import { StateCountyMap, createSdohColorScale } from '@/components/StateCountyMap';
import {
  CountyRecord,
  getCountyRepository,
  STATE_META
} from '@/utils/countyRepository';

/* ===== SDOH Domains matching prototype SCREEN 05 ===== */
const SDOH_DOMAINS: [string, string, string, string[]][] = [
  ['income', 'Income and poverty', 'dollar', ['poverty', 'childPoverty', 'income']],
  ['housing', 'Housing conditions', 'home', ['rentBurden', 'oldHousing', 'crowding']],
  ['transport', 'Transportation access', 'bus', ['noVehicle', 'transit', 'commute']],
  ['education', 'Education', 'book', ['noDiploma', 'bachelors', 'broadband']],
  ['employment', 'Employment', 'brief', ['unemployment', 'lfp']],
  ['access', 'Healthcare accessibility', 'cross', ['uninsured', 'pcp', 'driveTime']]
];

/* ===== Metric Definitions & Formatters matching prototype ===== */
const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-US'),
  pct: (v: number, d = 1) => v.toFixed(d) + '%',
  dec: (v: number, d = 1) => v.toFixed(d),
  usd: (v: number) => '$' + Math.round(v).toLocaleString('en-US'),
  k: (v: number) =>
    v >= 1e6
      ? (v / 1e6).toFixed(1) + 'M'
      : v >= 1e3
      ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k'
      : Math.round(v) + ''
};

const METRICS: Record<
  string,
  { label: string; short: string; f: (v: number) => string; bad: 'high' | 'low'; unit?: string }
> = {
  poverty: { label: 'Population below poverty line', short: 'Poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  childPoverty: { label: 'Children below poverty line', short: 'Child poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  income: { label: 'Median household income', short: 'Median income', f: v => fmt.usd(v), bad: 'low' },
  rentBurden: { label: 'Rent-burdened households', short: 'Rent burden', f: v => v.toFixed(1) + '%', bad: 'high' },
  oldHousing: { label: 'Housing built before 1960', short: 'Pre-1960 housing', f: v => v.toFixed(1) + '%', bad: 'high' },
  crowding: { label: 'Overcrowded housing units', short: 'Crowding', f: v => v.toFixed(1) + '%', bad: 'high' },
  noVehicle: { label: 'Households without a vehicle', short: 'No vehicle', f: v => v.toFixed(1) + '%', bad: 'high' },
  transit: { label: 'Residents within ½ mile of transit', short: 'Transit access', f: v => v.toFixed(0) + '%', bad: 'low' },
  commute: { label: 'Mean commute time', short: 'Commute', f: v => v.toFixed(0) + ' min', bad: 'high' },
  noDiploma: { label: 'Adults without a high school diploma', short: 'No diploma', f: v => v.toFixed(1) + '%', bad: 'high' },
  bachelors: { label: "Adults with a bachelor's degree", short: "Bachelor's+", f: v => v.toFixed(1) + '%', bad: 'low' },
  broadband: { label: 'Households with broadband', short: 'Broadband', f: v => v.toFixed(0) + '%', bad: 'low' },
  unemployment: { label: 'Unemployment rate', short: 'Unemployment', f: v => v.toFixed(1) + '%', bad: 'high' },
  lfp: { label: 'Labor force participation', short: 'Labor force', f: v => v.toFixed(1) + '%', bad: 'low' },
  uninsured: { label: 'Adults without health insurance', short: 'Uninsured', f: v => v.toFixed(1) + '%', bad: 'high' },
  pcp: { label: 'Primary care physicians per 100k', short: 'PCP per 100k', f: v => v.toFixed(0), bad: 'low' },
  driveTime: { label: 'Drive time to nearest clinic', short: 'Clinic drive time', f: v => v.toFixed(0) + ' min', bad: 'high' },
  sdoh: { label: 'SDOH composite burden', short: 'SDOH burden', f: v => v.toFixed(0), bad: 'high', unit: '/100' },
  access: { label: 'Healthcare access score', short: 'Access score', f: v => v.toFixed(0), bad: 'low', unit: '/100' }
};

const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

const countyLabel = (c: { name: string; st?: string; stateAbbr?: string }) =>
  `${c.name} ${c.st === '22' ? 'Parish' : c.st === '02' ? 'Borough' : 'County'}, ${c.stateAbbr || ''}`;

const pctRank = (arr: number[], v: number) => {
  let cnt = 0;
  for (const x of arr) if (x < v) cnt++;
  return arr.length ? cnt / arr.length : 0;
};

const getMetricVal = (c: any, k: string): number => (c?.indicators?.[k] ?? c?.[k] ?? 0);

/* ===== D3 Animated Histogram Chart matching prototype lines 1558-1577 ===== */
function HistogramView({
  values,
  format,
  mark,
  markLabel,
  colorScale
}: {
  values: number[];
  format: (v: number) => string;
  mark: number | null;
  markLabel: string;
  colorScale: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || values.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 450);
    const H = 200;
    const m = { t: 10, r: 8, b: 26, l: 8 };
    const f = format;

    const svg = d3
      .select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H);

    const extent = d3.extent(values) as [number, number];
    const x = d3.scaleLinear().domain(extent).nice().range([m.l, W - m.r]);
    const bins = d3.bin().domain(x.domain() as [number, number]).thresholds(x.ticks(20))(values);
    const y = d3.scaleLinear().domain([0, d3.max(bins, b => b.length) || 1]).range([H - m.b, m.t]);

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d => f(+d)).tickSize(0).tickPadding(8))
      .call(g => g.select('.domain').remove());

    const r = svg
      .selectAll('rect')
      .data(bins)
      .join('rect')
      .attr('x', b => x(b.x0 ?? 0) + 1)
      .attr('width', b => Math.max(0, x(b.x1 ?? 0) - x(b.x0 ?? 0) - 2))
      .attr('rx', 2)
      .attr('fill', b => colorScale(((b.x0 ?? 0) + (b.x1 ?? 0)) / 2))
      .attr('y', H - m.b)
      .attr('height', 0);

    r.transition()
      .duration(700)
      .delay((_, i) => i * 18)
      .attr('y', b => y(b.length))
      .attr('height', b => H - m.b - y(b.length));

    r.on('pointerenter', (e: MouseEvent, b: d3.Bin<number, number>) => {
      const tip = document.getElementById('tooltip');
      if (tip) {
        tip.innerHTML = `<b>${f(b.x0 ?? 0)} to ${f(b.x1 ?? 0)}</b><div class="tv"><span>Counties</span><span>${b.length}</span></div>`;
        tip.classList.add('on');
        const w = tip.offsetWidth || 180, h = tip.offsetHeight || 60;
        let px = e.clientX + 16, py = e.clientY + 14;
        if (px + w > window.innerWidth - 8) px = e.clientX - w - 16;
        if (py + h > window.innerHeight - 8) py = e.clientY - h - 14;
        tip.style.left = `${px}px`;
        tip.style.top = `${py}px`;
      }
    })
      .on('pointermove', (e: MouseEvent) => {
        const tip = document.getElementById('tooltip');
        if (tip) {
          const w = tip.offsetWidth || 180, h = tip.offsetHeight || 60;
          let px = e.clientX + 16, py = e.clientY + 14;
          if (px + w > window.innerWidth - 8) px = e.clientX - w - 16;
          if (py + h > window.innerHeight - 8) py = e.clientY - h - 14;
          tip.style.left = `${px}px`;
          tip.style.top = `${py}px`;
        }
      })
      .on('pointerleave', () => {
        const tip = document.getElementById('tooltip');
        if (tip) tip.classList.remove('on');
      });

    if (mark != null && !isNaN(mark)) {
      const mx = x(mark);
      const gm = svg.append('g').attr('transform', `translate(${mx},0)`);
      gm.append('line')
        .attr('y1', m.t - 4)
        .attr('y2', H - m.b)
        .attr('stroke', 'var(--cyan)')
        .attr('stroke-width', 2);
      gm.append('text')
        .attr('y', m.t + 4)
        .attr('x', mx > W - 120 ? -6 : 6)
        .attr('text-anchor', mx > W - 120 ? 'end' : 'start')
        .attr('class', 'val')
        .attr('fill', 'var(--cyan)')
        .text(markLabel || f(mark));
    }

    return () => {
      const tip = document.getElementById('tooltip');
      if (tip) tip.classList.remove('on');
    };
  }, [values, format, mark, markLabel, colorScale]);

  return <div ref={ref} id="sd-hist" style={{ height: '200px' }} />;
}

function SocialDeterminantsContent() {
  const router = useRouter();
  const { activeCounty, markWorkflowMilestone } = useSession();

  const [repo, setRepo] = useState<{
    counties: CountyRecord[];
    countyById: Map<string, CountyRecord>;
    countiesByState: Map<string, CountyRecord[]>;
  } | null>(null);

  const [activeStateFips, setActiveStateFips] = useState<string>(
    activeCounty?.stateFips || '27'
  );
  const [activeDomainId, setActiveDomainId] = useState<string>('income');
  const [activeMetric, setActiveMetric] = useState<string>('poverty');
  const [selectedCountyId, setSelectedCountyId] = useState<string | null>(
    activeCounty?._id || '27053'
  );

  const dumbbellRef = useRef<HTMLDivElement>(null);

  // Load comprehensive county repository
  useEffect(() => {
    getCountyRepository().then(res => {
      setRepo(res);
    });
  }, []);

  useEffect(() => {
    markWorkflowMilestone('layer');
  }, [markWorkflowMilestone]);

  // Synchronize state and county when activeCounty changes from Topbar
  useEffect(() => {
    if (activeCounty?.stateFips) {
      setActiveStateFips(activeCounty.stateFips);
      setSelectedCountyId(activeCounty._id);
    }
  }, [activeCounty]);

  const activeDomain = useMemo(() => {
    return SDOH_DOMAINS.find(d => d[0] === activeDomainId) || SDOH_DOMAINS[0];
  }, [activeDomainId]);

  // Ensure activeMetric belongs to current domain
  useEffect(() => {
    if (!activeDomain[3].includes(activeMetric)) {
      setActiveMetric(activeDomain[3][0]);
    }
  }, [activeDomain, activeMetric]);

  // All 50 states sorted by name
  const availableStates = useMemo(() => {
    return Object.entries(STATE_META)
      .map(([fips, meta]) => ({
        fips,
        abbr: meta[0],
        name: meta[1],
        region: meta[2]
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // Active state object
  const currentState = useMemo(() => {
    return (
      availableStates.find(s => s.fips === activeStateFips) ||
      availableStates.find(s => s.fips === '27') ||
      availableStates[0]
    );
  }, [availableStates, activeStateFips]);

  // Counties in the selected state
  const stateCounties = useMemo(() => {
    if (!repo) return [];
    return repo.countiesByState.get(activeStateFips) || [];
  }, [repo, activeStateFips]);

  const allCounties = useMemo(() => {
    return repo ? repo.counties : [];
  }, [repo]);

  // Focus County record
  const focusCounty = useMemo(() => {
    if (!repo || !selectedCountyId) return null;
    return repo.countyById.get(selectedCountyId) || null;
  }, [repo, selectedCountyId]);

  // Active Metric Config
  const currentMetricMeta = useMemo(() => {
    return (
      METRICS[activeMetric] || {
        label: activeMetric,
        short: activeMetric,
        f: (v: number) => String(v),
        bad: 'high'
      }
    );
  }, [activeMetric]);

  // Histogram values for all counties in state
  const stateCountyValues = useMemo(() => {
    return stateCounties.map(c => getMetricVal(c, activeMetric));
  }, [stateCounties, activeMetric]);

  // SDOH Color Scale & Legend Bins matching prototype
  const scaleInfo = useMemo(() => {
    return createSdohColorScale(
      stateCountyValues,
      activeMetric,
      activeDomainId === 'access' ? 'access' : 'sdoh',
      currentMetricMeta.bad
    );
  }, [stateCountyValues, activeMetric, activeDomainId, currentMetricMeta]);

  // State median for active metric
  const stateMedianVal = useMemo(() => {
    if (stateCountyValues.length === 0) return 0;
    const sorted = [...stateCountyValues].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  }, [stateCountyValues]);

  // National median for active metric
  const nationalMedianVal = useMemo(() => {
    if (!repo || allCounties.length === 0) return 0;
    const all = allCounties.map(c => getMetricVal(c, activeMetric)).sort((a, b) => a - b);
    return all[Math.floor(all.length / 2)] || 0;
  }, [repo, allCounties, activeMetric]);

  // Counties with Greatest Need (sorted worst outcome first, matching prototype line 2278)
  const greatestNeedCounties = useMemo(() => {
    const isBadLow = currentMetricMeta.bad === 'low';
    return [...stateCounties]
      .sort((a, b) => {
        const vA = getMetricVal(a, activeMetric);
        const vB = getMetricVal(b, activeMetric);
        return isBadLow ? vA - vB : vB - vA;
      })
      .slice(0, 8);
  }, [stateCounties, activeMetric, currentMetricMeta]);

  // Animate dumbbell connection bars with GSAP matching prototype line 2275
  useEffect(() => {
    if (typeof window !== 'undefined' && dumbbellRef.current) {
      const bars = dumbbellRef.current.querySelectorAll('.dumb');
      if (bars.length > 0) {
        gsap.fromTo(
          bars,
          { scaleX: 0 },
          { scaleX: 1, transformOrigin: 'left', duration: 0.9, ease: 'power3.out', stagger: 0.08 }
        );
      }
    }
  }, [activeDomainId, activeStateFips]);

  return (
    <>
      {/* Page Header matching prototype lines 2237-2238 */}
      <div className="page-head">
        <div>
          <h1>Social determinants of health</h1>
          <p>
            Explore the conditions where people live, learn, work and age. Switch domains, indicators and states to compare.
          </p>
        </div>
        <div className="head-actions">
          <span
            className="pill demo"
            title="Synthetic values generated for this demo. Not real surveillance or Census data."
          >
            <span className="dot"></span>Synthetic demo data
          </span>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            State
            <select
              className="input"
              id="sd-st"
              value={activeStateFips}
              onChange={e => {
                const nextSt = e.target.value;
                setActiveStateFips(nextSt);
                setSelectedCountyId(null);
              }}
            >
              {availableStates.map(s => (
                <option key={s.fips} value={s.fips}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Domain Navigation Tabs matching prototype line 2239 */}
      <div className="tabs" id="sd-tabs" role="tablist">
        {SDOH_DOMAINS.map(d => {
          const isOn = d[0] === activeDomainId;
          return (
            <button
              key={d[0]}
              role="tab"
              className={isOn ? 'on' : ''}
              data-d={d[0]}
              onClick={() => {
                setActiveDomainId(d[0]);
                setActiveMetric(d[3][0]);
              }}
            >
              {d[1]}
            </button>
          );
        })}
      </div>

      {/* Main Grid Layout matching prototype line 2240 */}
      <div className="grid g-12">
        {/* Panel 1: State Choropleth Map (c-7) matching prototype lines 2241-2246 */}
        <section
          className="panel c-7"
          style={{ padding: 0, overflow: 'hidden', minHeight: '470px', position: 'relative' }}
        >
          <div style={{ position: 'absolute', inset: 0 }} id="sd-map">
            <StateCountyMap
              stateFips={activeStateFips}
              metric={activeMetric}
              selectedCountyId={selectedCountyId}
              onSelectCounty={c => {
                setSelectedCountyId(c.id);
                markWorkflowMilestone('region');
              }}
              layerId={activeDomainId === 'access' ? 'access' : 'sdoh'}
              height={470}
              showControls={false}
            />
          </div>

          {/* Floating Indicator Chips overlay */}
          <div
            className="map-float"
            style={{
              position: 'absolute',
              left: '14px',
              top: '14px',
              padding: '10px 12px',
              maxWidth: 'calc(100% - 28px)',
              zIndex: 10
            }}
          >
            <div className="chips" id="sd-k">
              {activeDomain[3].map(x => {
                const meta = METRICS[x] || { short: x };
                const isChipOn = x === activeMetric;
                return (
                  <button
                    key={x}
                    className={`chip ${isChipOn ? 'on' : ''}`}
                    data-k={x}
                    onClick={() => setActiveMetric(x)}
                  >
                    {meta.short}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Floating Legend overlay matching legendHTML */}
          <div
            className="map-float legend"
            style={{ position: 'absolute', left: '14px', bottom: '14px', zIndex: 10 }}
            id="sd-leg"
          >
            <div className="ttl">
              <span>{currentMetricMeta.label}</span>
            </div>
            <div className="ramp">
              {scaleInfo.bins.map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </div>
            <div className="ends">
              <span>{currentMetricMeta.f(scaleInfo.extent[0])}</span>
              <span>Quantile bins</span>
              <span>{currentMetricMeta.f(scaleInfo.extent[1])}</span>
            </div>
          </div>

          {/* Floating Selected County Readout matching prototype line 2263 */}
          <div
            className="map-float"
            style={{
              position: 'absolute',
              right: '14px',
              bottom: '14px',
              padding: '10px 14px',
              maxWidth: '240px',
              zIndex: 10
            }}
            id="sd-hov"
          >
            {focusCounty && focusCounty.st === activeStateFips ? (
              <>
                <b>{countyLabel(focusCounty)}</b>
                <div className="big-metric" style={{ margin: '6px 0 0' }}>
                  <span className="v num" style={{ fontSize: '26px' }}>
                    {currentMetricMeta.f(getMetricVal(focusCounty, activeMetric))}
                  </span>
                </div>
                <div className="note">
                  {Math.round(
                    pctRank(
                      stateCounties.map(c => getMetricVal(c, activeMetric)),
                      getMetricVal(focusCounty, activeMetric)
                    ) * 100
                  )}
                  th percentile in {currentState.name}
                </div>
              </>
            ) : (
              <div className="note">Click a county to compare it with state and national values</div>
            )}
          </div>
        </section>

        {/* Panel 2: Geographic Comparison Dumbbell Plot (c-5) matching prototype lines 2247, 2264-2275 */}
        <section className="panel c-5">
          <div className="panel-h">
            <div>
              <h3>Geographic comparison</h3>
              <div className="sub" id="sd-cmp-sub">
                {activeDomain[1]}:{' '}
                {focusCounty && focusCounty.st === activeStateFips
                  ? `${countyLabel(focusCounty)} against `
                  : ''}
                {currentState.name} and national county medians
              </div>
            </div>
          </div>
          <div id="sd-cmp" ref={dumbbellRef} className="stack" style={{ gap: '18px' }}>
            {activeDomain[3].map(x => {
              const mm = METRICS[x] || { label: x, short: x, f: (v: number) => String(v), bad: 'high' };
              const allVals = allCounties.map(c => getMetricVal(c, x));
              const lo = d3.min(allVals) ?? 0;
              const sorted = [...allVals].sort(d3.ascending);
              const hi = d3.quantile(sorted, 0.99) ?? (d3.max(allVals) || 100);
              const pos = (val: number) => clamp(((val - lo) / (hi - lo || 1)) * 100, 0, 100);
              const s2 = d3.median(stateCounties, c => getMetricVal(c, x)) ?? 0;
              const n2 = d3.median(allCounties, c => getMetricVal(c, x)) ?? 0;
              const fc = focusCounty && focusCounty.st === activeStateFips ? focusCounty : null;

              const dots: [number, string, string][] = [
                [n2, 'var(--faint)', 'National'],
                [s2, 'var(--violet)', currentState.abbr],
                ...(fc ? [[getMetricVal(fc, x), 'var(--cyan)', 'County'] as [number, string, string]] : [])
              ];

              return (
                <div key={x} onClick={() => setActiveMetric(x)} style={{ cursor: 'pointer' }}>
                  <div className="row between" style={{ fontSize: '12.5px', marginBottom: '8px' }}>
                    <b className={x === activeMetric ? '' : 'muted'}>{mm.label}</b>
                    <span className="note">{mm.bad === 'low' ? 'Higher is better' : 'Lower is better'}</span>
                  </div>
                  <div style={{ position: 'relative', height: '26px' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: '12px',
                        height: '3px',
                        borderRadius: '2px',
                        background: 'var(--surface-2)'
                      }}
                    />
                    <div
                      className="dumb"
                      style={{
                        position: 'absolute',
                        top: '12px',
                        height: '3px',
                        background: 'linear-gradient(90deg,var(--teal),var(--violet))',
                        left: `${Math.min(pos(s2), pos(n2))}%`,
                        width: `${Math.abs(pos(s2) - pos(n2))}%`
                      }}
                    />
                    {dots.map(([val, col, l], di) => (
                      <span
                        key={di}
                        title={`${l}: ${mm.f(val)}`}
                        style={{
                          position: 'absolute',
                          top: '6px',
                          left: `calc(${pos(val)}% - 7px)`,
                          width: '15px',
                          height: '15px',
                          borderRadius: '50%',
                          background: col,
                          border: '3px solid var(--surface-solid)',
                          boxShadow: `0 0 10px ${col}`,
                          transition: 'left .8s cubic-bezier(.2,.8,.2,1)'
                        }}
                      />
                    ))}
                  </div>
                  <div className="row" style={{ gap: '14px', fontSize: '11.5px', color: 'var(--muted)' }}>
                    <span>
                      National <b className="num" style={{ color: 'var(--text)' }}>{mm.f(n2)}</b>
                    </span>
                    <span style={{ color: 'var(--violet)' }}>
                      {currentState.abbr} <b className="num">{mm.f(s2)}</b>
                    </span>
                    {fc && (
                      <span style={{ color: 'var(--cyan)' }}>
                        {fc.name} <b className="num">{mm.f(getMetricVal(fc, x))}</b>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Panel 3: Distribution across counties (c-6) matching prototype lines 2248, 2276-2277 */}
        <section className="panel c-6">
          <div className="panel-h">
            <div>
              <h3>Distribution across counties</h3>
              <div className="sub" id="sd-hist-sub">
                {currentMetricMeta.label}, {stateCounties.length} counties in {currentState.name}
              </div>
            </div>
          </div>
          <HistogramView
            values={stateCountyValues}
            format={v => currentMetricMeta.f(+v)}
            mark={
              focusCounty && focusCounty.st === activeStateFips
                ? getMetricVal(focusCounty, activeMetric)
                : stateMedianVal
            }
            markLabel={
              focusCounty && focusCounty.st === activeStateFips ? focusCounty.name : 'State median'
            }
            colorScale={scaleInfo.getColor}
          />
        </section>

        {/* Panel 4: Counties with greatest need (c-6) matching prototype lines 2249, 2278-2282 */}
        <section className="panel c-6">
          <div className="panel-h">
            <div>
              <h3>Counties with the greatest need</h3>
              <div className="sub" id="sd-top-sub">
                {currentMetricMeta.label}, ranked within {currentState.name}. National median{' '}
                {currentMetricMeta.f(nationalMedianVal)}
              </div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>County</th>
                  <th className="r">Value</th>
                  <th className="r">Population</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="sd-top">
                {greatestNeedCounties.map(c => {
                  const isSel = c.id === selectedCountyId;
                  return (
                    <tr
                      key={c.id}
                      className={`clickable ${isSel ? 'sel' : ''}`}
                      data-c={c.id}
                      onClick={e => {
                        if ((e.target as HTMLElement).closest('[data-m]')) {
                          router.push(`/health-map?county=${c.id}`);
                          return;
                        }
                        setSelectedCountyId(c.id);
                        markWorkflowMilestone('region');
                      }}
                    >
                      <td>
                        <b>{c.name}</b>
                      </td>
                      <td className="r num">{currentMetricMeta.f(getMetricVal(c, activeMetric))}</td>
                      <td className="r num">{fmt.k(c.pop)}</td>
                      <td className="r">
                        <button
                          className="btn sm ghost"
                          data-m={c.id}
                          onClick={e => {
                            e.stopPropagation();
                            router.push(`/health-map?county=${c.id}`);
                          }}
                        >
                          <svg
                            className="ic"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" />
                            <path d="M9 4v13.5M15 6.5V20" />
                          </svg>
                          Map
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

export default function SocialDeterminantsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[13px] text-[var(--muted)]">
          Loading social determinants analysis...
        </div>
      }
    >
      <SocialDeterminantsContent />
    </Suspense>
  );
}
