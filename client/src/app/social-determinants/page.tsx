'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { METRICS_CONFIG } from '@/config/metrics';
import {
  DollarSign,
  Home,
  Bus,
  BookOpen,
  Briefcase,
  HeartPulse,
  MapPin,
  ExternalLink,
  ChevronRight,
  X
} from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icons';
import { StateCountyMap, createSdohColorScale } from '@/components/StateCountyMap';
import { DumbbellPlot, DumbbellItem } from '@/components/DumbbellPlot';
import { HistogramChart } from '@/components/HistogramChart';
import {
  CountyRecord,
  getCountyRepository,
  STATE_META
} from '@/utils/countyRepository';

interface DomainDef {
  id: string;
  label: string;
  icon: any;
  indicators: string[];
}

const SDOH_DOMAINS: DomainDef[] = [
  {
    id: 'income',
    label: 'Income & Poverty',
    icon: DollarSign,
    indicators: ['poverty', 'childPoverty', 'income']
  },
  {
    id: 'housing',
    label: 'Housing Conditions',
    icon: Home,
    indicators: ['rentBurden', 'oldHousing', 'crowding']
  },
  {
    id: 'transport',
    label: 'Transportation Access',
    icon: Bus,
    indicators: ['noVehicle', 'transit', 'commute']
  },
  {
    id: 'education',
    label: 'Education & Connectivity',
    icon: BookOpen,
    indicators: ['noDiploma', 'bachelors', 'broadband']
  },
  {
    id: 'employment',
    label: 'Employment & Labor',
    icon: Briefcase,
    indicators: ['unemployment', 'lfp']
  },
  {
    id: 'access',
    label: 'Healthcare Accessibility',
    icon: HeartPulse,
    indicators: ['uninsured', 'pcp', 'driveTime']
  }
];

function SocialDeterminantsContent() {
  const { activeCounty, markWorkflowMilestone } = useSession();

  const [repo, setRepo] = useState<{
    counties: CountyRecord[];
    countyById: Map<string, CountyRecord>;
    countiesByState: Map<string, CountyRecord[]>;
  } | null>(null);

  const [activeStateFips, setActiveStateFips] = useState<string>(
    activeCounty?.stateFips || '27' // Default to 27 (MN) or activeCounty
  );
  const [activeDomainId, setActiveDomainId] = useState<string>('employment');
  const [activeMetric, setActiveMetric] = useState<string>('unemployment');
  const [selectedCountyId, setSelectedCountyId] = useState<string | null>(
    activeCounty?._id || '27053'
  );

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
    return SDOH_DOMAINS.find(d => d.id === activeDomainId) || SDOH_DOMAINS[0];
  }, [activeDomainId]);

  // Ensure activeMetric is in current domain
  useEffect(() => {
    if (!activeDomain.indicators.includes(activeMetric)) {
      setActiveMetric(activeDomain.indicators[0]);
    }
  }, [activeDomain, activeMetric]);

  // All 50 states sorted by name
  const availableStates = useMemo(() => {
    return Object.entries(STATE_META).map(([fips, meta]) => ({
      fips,
      abbr: meta[0],
      name: meta[1],
      region: meta[2]
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // Active state object
  const currentState = useMemo(() => {
    return (
      availableStates.find(s => s.fips === activeStateFips) ||
      availableStates.find(s => s.fips === '27') ||
      availableStates[0]
    );
  }, [availableStates, activeStateFips]);

  // Counties in the selected state (all 87 for MN, 39 for WA, etc.)
  const stateCounties = useMemo(() => {
    if (!repo) return [];
    return repo.countiesByState.get(activeStateFips) || [];
  }, [repo, activeStateFips]);

  // Focus County record
  const focusCounty = useMemo(() => {
    if (!repo || !selectedCountyId) return null;
    return repo.countyById.get(selectedCountyId) || null;
  }, [repo, selectedCountyId]);

  // Active Metric Config
  const metricMeta = useMemo(() => {
    return METRICS_CONFIG[activeMetric] || {
      label: activeMetric,
      short: activeMetric,
      bad: 'high',
      unit: '%'
    };
  }, [activeMetric]);

  // Percentile rank calculation for focus county within state
  const percentileRank = useMemo(() => {
    if (!focusCounty || stateCounties.length === 0) return null;
    const values = stateCounties.map(c => (c.indicators as any)[activeMetric] ?? 0).sort((a, b) => a - b);
    const targetVal = (focusCounty.indicators as any)[activeMetric] ?? 0;
    const rankIdx = values.findIndex(v => v >= targetVal);
    const pct = Math.round(((rankIdx === -1 ? values.length : rankIdx) / values.length) * 100);
    return Math.max(1, Math.min(99, pct));
  }, [focusCounty, stateCounties, activeMetric]);

  // Dumbbell comparison items for current domain
  const dumbbellItems: DumbbellItem[] = useMemo(() => {
    if (!repo) return [];

    return activeDomain.indicators.map(indKey => {
      const meta = METRICS_CONFIG[indKey] || { label: indKey, short: indKey, bad: 'high', unit: '%' };

      const allNatVals = repo.counties.map(c => (c.indicators as any)[indKey] ?? 0).sort((a, b) => a - b);
      const allStateVals = stateCounties.map(c => (c.indicators as any)[indKey] ?? 0).sort((a, b) => a - b);

      const natMedian = allNatVals[Math.floor(allNatVals.length / 2)] || 10;
      const stateMedian = allStateVals[Math.floor(allStateVals.length / 2)] || 10;

      const countyVal = focusCounty ? (focusCounty.indicators as any)[indKey] ?? null : null;

      const minVal = allNatVals[0] || 0;
      const maxVal = allNatVals[allNatVals.length - 1] || 100;

      const formatFn = (v: number) => {
        if (indKey === 'income') return `$${Math.round(v).toLocaleString()}`;
        return `${v.toFixed(1)}${meta.unit || '%'}`;
      };

      return {
        key: indKey,
        label: meta.label,
        direction: meta.bad === 'low' ? 'higher' : 'lower',
        nationalVal: natMedian,
        stateVal: stateMedian,
        stateAbbr: currentState.abbr,
        countyVal: countyVal,
        countyName: focusCounty ? focusCounty.name : null,
        format: formatFn,
        minVal,
        maxVal,
        isActive: indKey === activeMetric,
        onSelect: () => setActiveMetric(indKey)
      };
    });
  }, [repo, activeDomain, stateCounties, focusCounty, currentState, activeMetric]);

  // Histogram values for all counties in state
  const histogramValues = useMemo(() => {
    return stateCounties.map(c => (c.indicators as any)[activeMetric] ?? 0);
  }, [stateCounties, activeMetric]);

  // SDOH Color Scale & Legend Bins matching prototype
  const scaleInfo = useMemo(() => {
    return createSdohColorScale(
      histogramValues,
      activeMetric,
      activeDomainId === 'access' ? 'access' : 'sdoh',
      metricMeta.bad as any
    );
  }, [histogramValues, activeMetric, activeDomainId, metricMeta]);

  // State median for active metric
  const stateMedianVal = useMemo(() => {
    if (histogramValues.length === 0) return 0;
    const sorted = [...histogramValues].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  }, [histogramValues]);

  // National median for active metric
  const nationalMedianVal = useMemo(() => {
    if (!repo) return 0;
    const all = repo.counties.map(c => (c.indicators as any)[activeMetric] ?? 0).sort((a, b) => a - b);
    return all[Math.floor(all.length / 2)] || 0;
  }, [repo, activeMetric]);

  // Counties with Greatest Need (sorted worst outcome first)
  const greatestNeedCounties = useMemo(() => {
    const isBadLow = metricMeta.bad === 'low';
    return [...stateCounties].sort((a, b) => {
      const vA = (a.indicators as any)[activeMetric] ?? 0;
      const vB = (b.indicators as any)[activeMetric] ?? 0;
      return isBadLow ? vA - vB : vB - vA;
    }).slice(0, 8);
  }, [stateCounties, activeMetric, metricMeta]);

  const formatMetricVal = (val: number) => {
    if (activeMetric === 'income') return `$${Math.round(val).toLocaleString()}`;
    return `${val.toFixed(1)}${metricMeta.unit || '%'}`;
  };

  const selectedStateFips = activeStateFips;
  const setSelectedStateFips = setActiveStateFips;
  const activeMetricKey = activeMetric;
  const setActiveMetricKey = setActiveMetric;
  const activeMetricMeta = metricMeta;
  const selectedStateMeta = currentState;
  const selectedCounty = focusCounty;
  const allStates = availableStates.map(s => ({ ...s, countiesCount: repo?.countiesByState.get(s.fips)?.length || 0 }));
  const stateStats = { median: stateMedianVal };
  const nationalStats = { median: nationalMedianVal };
  const stateCountyValues = histogramValues;
  const rankedCounties = greatestNeedCounties;
  const metricVal = (c: any, k: string) => ((c.indicators as any)?.[k] ?? (c as any)[k] ?? 0);
  const handleSelectDomain = (dId: string) => {
    setActiveDomainId(dId);
    const d = SDOH_DOMAINS.find(x => x.id === dId);
    if (d && d.indicators[0]) setActiveMetric(d.indicators[0]);
  };

  return (
    <>
      {/* Page Header */}
      <div className="page-head">
        <div>
          <h1>Social determinants of health</h1>
          <p>Explore the conditions where people live, learn, work and age. Track structural barriers by domain.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot"></span>Demo environment
          </span>
          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>State</span>
            <select
              className="input"
              value={selectedStateFips}
              onChange={(e) => {
                setSelectedStateFips(e.target.value);
                setSelectedCountyId(null);
              }}
              style={{ height: '36px', borderRadius: '10px', padding: '0 10px', fontSize: '13px', background: 'var(--surface-solid)' }}
            >
              {allStates.map((st) => (
                <option key={st.fips} value={st.fips}>
                  {st.name} ({st.countiesCount} counties)
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Domain Navigation Tabs */}
      <div className="tabs" id="sd-tabs" role="tablist" style={{ marginBottom: '16px' }}>
        {SDOH_DOMAINS.map((d) => {
          const isOn = d.id === activeDomainId;
          return (
            <button
              key={d.id}
              role="tab"
              aria-selected={isOn}
              className={isOn ? 'on' : ''}
              onClick={() => handleSelectDomain(d.id)}
            >
              <Icon name={d.id === 'income' ? 'dollar' : d.id === 'housing' ? 'home' : d.id === 'transport' ? 'bus' : d.id === 'education' ? 'book' : d.id === 'employment' ? 'brief' : 'cross'} size={15} />
              <span>{d.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Grid Layout */}
      <div className="grid g-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px' }}>
        {/* Panel 1: State Choropleth Map (c-7) */}
        <section className="panel c-7" style={{ gridColumn: 'span 7', padding: 0, overflow: 'hidden', minHeight: '470px', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0 }} id="sd-map">
            <StateCountyMap
              stateFips={selectedStateFips}
              metric={activeMetricKey}
              selectedCountyId={selectedCountyId}
              onSelectCounty={(c) => setSelectedCountyId(c.id)}
              layerId={activeDomainId === 'access' ? 'access' : 'sdoh'}
              height={470}
            />
          </div>

          {/* Indicator Chips overlay */}
          <div className="map-float" style={{ position: 'absolute', left: '14px', top: '14px', padding: '10px 12px', maxWidth: 'calc(100% - 28px)', zIndex: 10 }}>
            <div className="chips" id="sd-k">
              {activeDomain.indicators.map((k) => {
                const meta = METRICS_CONFIG[k] || { short: k };
                const isChipOn = k === activeMetricKey;
                return (
                  <button
                    key={k}
                    className={`chip ${isChipOn ? 'on' : ''}`}
                    onClick={() => setActiveMetricKey(k)}
                  >
                    {meta.short || meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Float Legend */}
          <div className="map-float legend" style={{ position: 'absolute', left: '14px', bottom: '14px', zIndex: 10 }} id="sd-leg">
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', marginBottom: '4px' }}>
              {activeMetricMeta.label || activeMetricMeta.short}
            </div>
            <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', width: '170px' }}>
              {['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'].map((c, i) => (
                <div key={i} style={{ flex: 1, height: '100%', backgroundColor: c }} />
              ))}
            </div>
            <div className="ends" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--faint)', marginTop: '2px' }}>
              <span>Low</span>
              <span>High burden</span>
            </div>
          </div>

          {/* Float Selected County Readout */}
          <div className="map-float" style={{ position: 'absolute', right: '14px', bottom: '14px', padding: '10px 14px', maxWidth: '240px', zIndex: 10 }} id="sd-hov">
            {selectedCounty ? (
              <div>
                <b style={{ fontSize: '13px', display: 'block' }}>{selectedCounty.name} County, {selectedCounty.stateAbbr}</b>
                <div className="big-metric" style={{ margin: '4px 0 0' }}>
                  <span className="v num" style={{ fontSize: '26px', fontWeight: 700, color: 'var(--cyan)' }}>
                    {metricVal(selectedCounty, activeMetricKey).toFixed(1)}%
                  </span>
                  <small style={{ color: 'var(--muted)', fontSize: '12px', marginLeft: '4px' }}>{activeMetricMeta.short}</small>
                </div>
                <div className="note" style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '2px' }}>
                  State median {stateStats.median.toFixed(1)}%
                </div>
              </div>
            ) : (
              <div>
                <b style={{ fontSize: '12.5px', display: 'block' }}>{selectedStateMeta?.name}</b>
                <div className="note" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                  Click a county to inspect local rates
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Panel 2: Geographic Comparison Dumbbell Plot (c-5) */}
        <section className="panel c-5" style={{ gridColumn: 'span 5' }}>
          <div className="panel-h">
            <div>
              <h3>Geographic comparison</h3>
              <div className="sub" id="sd-cmp-sub">
                {activeDomain.label}: {selectedCounty ? `${selectedCounty.name} County against ` : ''}
                {selectedStateMeta?.name} and national median
              </div>
            </div>
          </div>
          <div style={{ marginTop: '14px' }}>
            <DumbbellPlot
              items={dumbbellItems}
            />
          </div>
        </section>

        {/* Panel 3: Distribution Histogram across Counties (c-6) */}
        <section className="panel c-6" style={{ gridColumn: 'span 6' }}>
          <div className="panel-h">
            <div>
              <h3>Distribution across counties</h3>
              <div className="sub" id="sd-hist-sub">
                {activeMetricMeta.label}, {stateCounties.length} counties in {selectedStateMeta?.name}
              </div>
            </div>
          </div>
          <div style={{ height: '220px', marginTop: '10px' }}>
            <HistogramChart
              values={stateCountyValues}
              mark={selectedCounty ? metricVal(selectedCounty, activeMetricKey) : stateStats.median}
              markLabel={selectedCounty ? `${selectedCounty.name}` : `${selectedStateMeta?.abbr} Median`}
              height={220}
              unit="%"
            />
          </div>
        </section>

        {/* Panel 4: Counties with Greatest Need Ranked Table (c-6) */}
        <section className="panel c-6" style={{ gridColumn: 'span 6' }}>
          <div className="panel-h">
            <div>
              <h3>Counties with the greatest need</h3>
              <div className="sub" id="sd-top-sub">
                {activeMetricMeta.label}, ranked within {selectedStateMeta?.name}. National median {nationalStats.median.toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="tbl-wrap" style={{ marginTop: '10px', maxHeight: '220px', overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>Rank</th>
                  <th>County</th>
                  <th className="r">Population</th>
                  <th className="r">{activeMetricMeta.short}</th>
                  <th className="r">SVI</th>
                </tr>
              </thead>
              <tbody>
                {rankedCounties.slice(0, 8).map((c: any, i: number) => (
                  <tr
                    key={c.id}
                    className={`clickable ${c.id === selectedCountyId ? 'sel' : ''}`}
                    onClick={() => setSelectedCountyId(c.id)}
                  >
                    <td className="num" style={{ fontWeight: 600, color: 'var(--muted)' }}>#{i + 1}</td>
                    <td><b>{c.name} County</b></td>
                    <td className="r num">{(c.pop || 0).toLocaleString()}</td>
                    <td className="r num" style={{ fontWeight: 700, color: 'var(--cyan)' }}>
                      {metricVal(c, activeMetricKey).toFixed(1)}%
                    </td>
                    <td className="r num">{(c.svi || 0).toFixed(2)}</td>
                  </tr>
                ))}
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
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading social determinants analysis...</div>}>
      <SocialDeterminantsContent />
    </Suspense>
  );
}
