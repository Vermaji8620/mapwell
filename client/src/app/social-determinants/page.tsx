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

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* Screen Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text)] tracking-tight">
            Social Determinants of Health
          </h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Explore the conditions where people live, learn, work and age. Switch domains, indicators and states to compare.
          </p>
        </div>

        {/* State Selector Dropdown */}
        <div className="flex items-center gap-3">
          <label className="text-[12px] font-bold text-[var(--faint)] uppercase flex items-center gap-2">
            <span>State:</span>
            <select
              value={activeStateFips}
              onChange={(e) => {
                setActiveStateFips(e.target.value);
                const nextCounties = repo?.countiesByState.get(e.target.value) || [];
                setSelectedCountyId(nextCounties[0]?.id || null);
              }}
              className="h-10 px-3.5 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[13px] font-bold text-[var(--text)] outline-none cursor-pointer hover:border-[var(--cyan)] transition-colors shadow-xs"
            >
              {availableStates.map((s) => (
                <option key={s.fips} value={s.fips}>
                  {s.name} ({s.abbr})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* 6 SDOH Domain Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[var(--line)]">
        {SDOH_DOMAINS.map((dom) => {
          const Icon = dom.icon;
          const isActive = dom.id === activeDomainId;
          return (
            <button
              key={dom.id}
              onClick={() => setActiveDomainId(dom.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-[var(--cyan)] text-white shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{dom.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main 12-Column Responsive Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 7: Interactive State County Map with Overlay Controls */}
        <section className="lg:col-span-7 rounded-2xl glass-panel relative overflow-hidden flex flex-col justify-between min-h-[500px] border border-[var(--line)] bg-[var(--surface-solid)]/70">
          {/* Floating Indicator Chips inside Map */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 flex-wrap max-w-[calc(100%-32px)]">
            <div className="px-2.5 py-1.5 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] flex items-center gap-1.5 shadow-md">
              {activeDomain.indicators.map((indKey) => {
                const meta = METRICS_CONFIG[indKey] || { short: indKey };
                const isChipActive = indKey === activeMetric;
                return (
                  <button
                    key={indKey}
                    onClick={() => setActiveMetric(indKey)}
                    className={`px-3 py-1 rounded-lg text-[11.5px] font-bold transition-all ${
                      isChipActive
                        ? 'bg-[var(--cyan)] text-white shadow-xs'
                        : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    {meta.short}
                  </button>
                );
              })}
            </div>
          </div>

          {/* D3 Pre-projected Albers TopoJSON State County Choropleth */}
          <div className="w-full h-full flex-1 min-h-[480px]">
            <StateCountyMap
              stateFips={activeStateFips}
              selectedCountyId={selectedCountyId}
              onSelectCounty={(c) => setSelectedCountyId(c.id)}
              onClearCounty={() => setSelectedCountyId(null)}
              metric={activeMetric}
              layerId={activeDomainId === 'access' ? 'access' : 'sdoh'}
              height={490}
            />
          </div>

          {/* Floating Bottom Left: Legend matching prototype */}
          <div className="absolute bottom-4 left-4 z-20 px-3.5 py-2.5 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-lg min-w-[220px] text-[11px]">
            <div className="font-bold text-[var(--text)] mb-1.5 flex justify-between items-center">
              <span>{metricMeta.short || metricMeta.label}</span>
            </div>
            <div className="flex h-2.5 rounded overflow-hidden mb-1.5">
              {scaleInfo.bins.map((c, i) => (
                <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex justify-between items-center text-[10px] text-[var(--faint)]">
              <span>{formatMetricVal(scaleInfo.extent[0] ?? 0)}</span>
              <span>Quantile bins</span>
              <span>{formatMetricVal(scaleInfo.extent[1] ?? 0)}</span>
            </div>
          </div>

          {/* Floating Bottom Right: Selected County Inspection Badge */}
          <div className="absolute bottom-4 right-4 z-20 p-3.5 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-xl max-w-[250px] text-[12px]">
            {focusCounty ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[var(--text)] truncate">
                    {focusCounty.name} County
                  </span>
                  <button
                    onClick={() => setSelectedCountyId(null)}
                    className="text-[var(--faint)] hover:text-[var(--text)]"
                    title="Clear selection"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-2xl font-bold font-display text-[var(--cyan)] num mt-1">
                  {formatMetricVal((focusCounty.indicators as any)[activeMetric] ?? 0)}
                </div>
                {percentileRank != null && (
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    <strong className="text-[var(--text)]">{percentileRank}th</strong> percentile in {currentState.name}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11.5px] text-[var(--muted)] flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-[var(--cyan)] flex-shrink-0" />
                <span>Click any county to compare against state & nation</span>
              </div>
            )}
          </div>
        </section>

        {/* Col 5: Geographic Comparison (Dumbbell Range Plots) */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Geographic Comparison</h3>
            <p className="text-[12px] text-[var(--muted)]">
              {activeDomain.label}: {focusCounty ? `${focusCounty.name} County against ` : ''}
              {currentState.name} and national county medians
            </p>
          </div>

          <div className="my-4">
            <DumbbellPlot items={dumbbellItems} />
          </div>

          <div className="pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)] flex items-center justify-between">
            <span>Click any indicator card to switch active map overlay</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </section>

        {/* Col 6: Distribution Across Counties (Histogram) */}
        <section className="lg:col-span-6 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Distribution Across Counties</h3>
            <p className="text-[12px] text-[var(--muted)]">
              {metricMeta.label}, {stateCounties.length} counties in {currentState.name}
            </p>
          </div>

          <div className="my-4">
            <HistogramChart
              values={histogramValues}
              height={200}
              binsCount={20}
              format={formatMetricVal}
              mark={
                focusCounty
                  ? (focusCounty.indicators as any)[activeMetric] ?? stateMedianVal
                  : stateMedianVal
              }
              markLabel={focusCounty ? `${focusCounty.name} County` : `${currentState.abbr} Median`}
              unit="Counties"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            <span>Vertical line marks active county or state median</span>
            <span>State Median: <strong className="text-[var(--text)] num">{formatMetricVal(stateMedianVal)}</strong></span>
          </div>
        </section>

        {/* Col 6: Counties with the Greatest Need (Ranked Table) */}
        <section className="lg:col-span-6 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Counties with Greatest Need</h3>
            <p className="text-[12px] text-[var(--muted)]">
              {metricMeta.label}, ranked within {currentState.name}. National median {formatMetricVal(nationalMedianVal)}
            </p>
          </div>

          <div className="my-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-solid)]">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-[var(--surface-2)] text-[10.5px] font-bold text-[var(--faint)] uppercase border-b border-[var(--line)]">
                <tr>
                  <th className="p-3">County</th>
                  <th className="p-3 text-right">Value</th>
                  <th className="p-3 text-right">Population</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {greatestNeedCounties.map((c) => {
                  const val = (c.indicators as any)[activeMetric] ?? 0;
                  const isSelected = c.id === selectedCountyId;

                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedCountyId(c.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[var(--glow)]/80 text-[var(--text)] font-semibold'
                          : 'hover:bg-[var(--surface-2)] text-[var(--text)]'
                      }`}
                    >
                      <td className="p-3 font-bold">{c.name}</td>
                      <td className="p-3 text-right num font-semibold text-[var(--rose)]">
                        {formatMetricVal(val)}
                      </td>
                      <td className="p-3 text-right num text-[var(--muted)]">
                        {c.pop.toLocaleString()}
                      </td>
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/health-map?county=${c.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--cyan)] hover:text-white border border-[var(--line)] text-[11px] font-bold text-[var(--text)] transition-colors shadow-xs"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Map</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)] flex items-center justify-between">
            <span>Click any row to inspect on the state map and histogram</span>
            <span className="text-[var(--cyan)] font-semibold">Live CDC/ACS Indicators</span>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function SocialDeterminantsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading social determinants analysis...</div>}>
      <SocialDeterminantsContent />
    </Suspense>
  );
}
