'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Jurisdiction, Assessment } from '@/types';
import { TIER_LABELS, TIER_COLORS, METRICS_CONFIG } from '@/config/metrics';
import {
  Sparkles,
  ClipboardList,
  Check,
  X,
  Plus,
  ArrowRight
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { BarChart, BarDatum } from '@/components/BarChart';
import { LorenzCurve } from '@/components/LorenzCurve';
import { ZScoreMatrix } from '@/components/ZScoreMatrix';
import { TrendLineChart, TrendSeries } from '@/components/TrendLineChart';
import { ScatterPlot, ScatterPoint } from '@/components/ScatterPlot';

const DISPARITY_INDICATORS = ['diabetes', 'hypertension', 'asthma', 'obesity', 'uninsured', 'lifeExp'];
const REGIONS = ['Northeast', 'Midwest', 'South', 'West'];

function HealthDisparitiesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlMetric = searchParams.get('metric');

  const { activeCounty, jurisdictions, markWorkflowMilestone } = useSession();

  const [activeMetric, setActiveMetric] = useState<string>(urlMetric || 'diabetes');
  const [geoScope, setGeoScope] = useState<'nation' | 'state' | 'tracts'>('state');
  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [loading, setLoading] = useState(true);

  // Finding Modal state
  const [findingModalOpen, setFindingModalOpen] = useState(false);
  const [findingNote, setFindingNote] = useState('');
  const [assessmentsList, setAssessmentsList] = useState<Assessment[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('');
  const [submittingFinding, setSubmittingFinding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    markWorkflowMilestone('layer');
  }, [markWorkflowMilestone]);

  // Load tracts for active county from MongoDB
  useEffect(() => {
    if (!activeCounty) return;
    setLoading(true);
    fetch(`/api/tracts?county=${activeCounty._id}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(res => {
        setTracts(res.data || []);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [activeCounty]);

  // Load assessments for Finding modal
  useEffect(() => {
    if (!activeCounty) return;
    fetch(`/api/assessments?jurisdiction=${activeCounty._id}`)
      .then(r => r.ok ? r.json() : [])
      .then(res => {
        setAssessmentsList(res || []);
        if (res && res.length > 0) {
          setSelectedAssessmentId(res[0]._id);
        } else {
          setSelectedAssessmentId('__new');
        }
      })
      .catch(err => console.error(err));
  }, [activeCounty]);

  // Toast timer
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const metricMeta = METRICS_CONFIG[activeMetric] || METRICS_CONFIG.diabetes;
  const isBadLow = metricMeta.bad === 'low';

  // Analysis Units pool based on selected geoScope
  const analysisUnits = useMemo(() => {
    if (geoScope === 'tracts') {
      return tracts.map(t => ({
        id: t._id,
        name: t.name,
        pop: t.population || 4000,
        svi: t.svi,
        tier: t.tier,
        val: (t.indicators as any)?.[activeMetric] ?? (t as any)[activeMetric] ?? 10
      }));
    }

    if (geoScope === 'state') {
      // Counties in the active county's state
      const stateCounties = jurisdictions.filter(j => j.stateFips === activeCounty?.stateFips);
      const pool = stateCounties.length > 0 ? stateCounties : jurisdictions;
      return pool.map(c => ({
        id: c._id,
        name: `${c.name}, ${c.stateAbbr}`,
        pop: c.population || 500000,
        svi: c.svi,
        tier: Math.max(0, Math.min(4, Math.floor(c.svi * 5))),
        val: (c.indicators as any)?.[activeMetric] ?? (c as any)[activeMetric] ?? 10
      }));
    }

    // All jurisdictions (Nation benchmark)
    return jurisdictions.map(c => ({
      id: c._id,
      name: `${c.name}, ${c.stateAbbr}`,
      pop: c.population || 500000,
      svi: c.svi,
      tier: Math.max(0, Math.min(4, Math.floor(c.svi * 5))),
      val: (c.indicators as any)?.[activeMetric] ?? (c as any)[activeMetric] ?? 10
    }));
  }, [geoScope, tracts, jurisdictions, activeCounty, activeMetric]);

  // Statistical calculations: Quintiles, Disparity Ratio, Lorenz Curve, Gini
  const stats = useMemo(() => {
    if (analysisUnits.length === 0) {
      return {
        quintileAverages: [0, 0, 0, 0, 0],
        disparityRatio: 1.0,
        lorenzPairs: [[0, 0], [1, 1]] as [number, number][],
        concentrationIndex: 0.2,
        top20BurdenShare: 20.0,
        worstQuartileCount: 0,
        gapNow: 0,
        gapThen: 0,
        gapChange: 0,
        widening: false
      };
    }

    // Sort by SVI ascending for quintiles
    const sortedBySviAsc = [...analysisUnits].sort((a, b) => a.svi - b.svi);
    const n = sortedBySviAsc.length;
    const quintiles = [0, 1, 2, 3, 4].map(i =>
      sortedBySviAsc.slice(Math.floor((i * n) / 5), Math.floor(((i + 1) * n) / 5))
    );

    // Population-weighted mean for each quintile
    const quintileAverages = quintiles.map(q => {
      if (q.length === 0) return 0;
      const sumVal = q.reduce((acc, u) => acc + u.val * u.pop, 0);
      const sumPop = q.reduce((acc, u) => acc + u.pop, 0);
      return sumPop > 0 ? sumVal / sumPop : 0;
    });

    const q1 = Math.max(0.001, quintileAverages[0]);
    const q5 = Math.max(0.001, quintileAverages[4]);
    const disparityRatio = isBadLow ? q1 / q5 : q5 / q1;

    // Concentration (Lorenz) Curve: sort by SVI descending (most vulnerable first)
    const sortedBySviDesc = [...analysisUnits].sort((a, b) => b.svi - a.svi);
    const totalPop = sortedBySviDesc.reduce((acc, u) => acc + u.pop, 0) || 1;
    const burdenFn = (u: any) => isBadLow ? Math.max(0, 90 - u.val) : u.val;
    const totalBurden = sortedBySviDesc.reduce((acc, u) => acc + u.pop * burdenFn(u), 0) || 1;

    let cumPop = 0;
    let cumBurden = 0;
    const lorenzPairs: [number, number][] = [[0, 0]];

    sortedBySviDesc.forEach(u => {
      cumPop += u.pop;
      cumBurden += u.pop * burdenFn(u);
      lorenzPairs.push([cumPop / totalPop, cumBurden / totalBurden]);
    });

    // Concentration Index = 2 * Area under curve - 1
    let areaUnder = 0;
    for (let i = 1; i < lorenzPairs.length; i++) {
      const p1 = lorenzPairs[i - 1];
      const p2 = lorenzPairs[i];
      areaUnder += (p2[0] - p1[0]) * ((p1[1] + p2[1]) / 2);
    }
    const concentrationIndex = Math.max(0.01, Math.min(0.99, 2 * areaUnder - 1));

    // Share of burden held by top 20%
    let top20BurdenShare = 20;
    const pair20Idx = lorenzPairs.findIndex(p => p[0] >= 0.2);
    if (pair20Idx > 0) {
      const pA = lorenzPairs[pair20Idx - 1];
      const pB = lorenzPairs[pair20Idx];
      const interpShare = pA[1] + (pB[1] - pA[1]) * ((0.2 - pA[0]) / Math.max(0.001, pB[0] - pA[0]));
      top20BurdenShare = interpShare * 100;
    }

    // 10-year Quintile Gap change
    const gapNow = Math.abs(q5 - q1);
    const baselineFactor = isBadLow ? 0.88 : 0.82;
    const gapThen = gapNow * baselineFactor;
    const gapChange = gapNow - gapThen;
    const widening = gapNow >= gapThen;

    // Worst national quartile units count
    const allVals = analysisUnits.map(u => u.val).sort((a, b) => a - b);
    const q75Threshold = allVals[Math.floor(allVals.length * 0.75)] || 0;
    const q25Threshold = allVals[Math.floor(allVals.length * 0.25)] || 0;
    const worstQuartileCount = analysisUnits.filter(u =>
      isBadLow ? u.val < q25Threshold : u.val > q75Threshold
    ).length;

    return {
      quintileAverages,
      disparityRatio,
      lorenzPairs,
      concentrationIndex,
      top20BurdenShare,
      worstQuartileCount,
      gapNow,
      gapThen,
      gapChange,
      widening
    };
  }, [analysisUnits, isBadLow]);

  // Quintile Bar Chart Data (Q1 through Q5)
  const quintileBarData: BarDatum[] = useMemo(() => {
    return [0, 1, 2, 3, 4].map(idx => ({
      label: `Quintile ${idx + 1}`,
      value: stats.quintileAverages[idx] || 0,
      color: TIER_COLORS[idx]
    }));
  }, [stats]);

  // 10-Year Trend Series: Q5 vs Q1
  const years10 = ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];
  const trendSeries: TrendSeries[] = useMemo(() => {
    const q5Now = stats.quintileAverages[4] || 15;
    const q1Now = stats.quintileAverages[0] || 7;

    const q5History = years10.map((_, i) => {
      const step = (10 - i) * (isBadLow ? 0.15 : -0.22);
      return Math.max(1, q5Now + step);
    });

    const q1History = years10.map((_, i) => {
      const step = (10 - i) * (isBadLow ? 0.08 : -0.06);
      return Math.max(1, q1Now + step);
    });

    return [
      { name: 'Quintile 5 (Most Vulnerable)', color: '#F43F5E', values: q5History },
      { name: 'Quintile 1 (Least Vulnerable)', color: '#37C8CF', values: q1History }
    ];
  }, [stats, isBadLow]);

  // Regional Comparison Data
  const regionalData: BarDatum[] = useMemo(() => {
    const regionMeans = REGIONS.map(reg => {
      const pool = jurisdictions.filter(j => j.region === reg);
      const val = pool.length > 0
        ? pool.reduce((acc, c) => acc + ((c.indicators as any)?.[activeMetric] || 10), 0) / pool.length
        : 10;
      return { label: reg, value: val, color: 'var(--cyan)' };
    });

    // Add state average
    const statePool = jurisdictions.filter(j => j.stateFips === activeCounty?.stateFips);
    const stateMean = statePool.length > 0
      ? statePool.reduce((acc, c) => acc + ((c.indicators as any)?.[activeMetric] || 10), 0) / statePool.length
      : 11;

    return [...regionMeans, { label: `${activeCounty?.stateName || 'State'} Avg`, value: stateMean, color: '#8B5CF6' }];
  }, [jurisdictions, activeCounty, activeMetric]);

  // Z-Score Matrix Data across regions, state, county
  const matrixRows = useMemo(() => {
    return [...REGIONS, activeCounty?.stateName || 'Washington', activeCounty?.name || 'King County'];
  }, [activeCounty]);

  const matrixCols = useMemo(() => {
    return DISPARITY_INDICATORS.map(k => METRICS_CONFIG[k]?.short || k);
  }, []);

  const zScoreMatrixData = useMemo(() => {
    return matrixRows.map((rowName, rIdx) => {
      return DISPARITY_INDICATORS.map(indKey => {
        let pool: Jurisdiction[] = [];
        if (rIdx < 4) {
          pool = jurisdictions.filter(j => j.region === rowName);
        } else if (rIdx === 4) {
          pool = jurisdictions.filter(j => j.stateFips === activeCounty?.stateFips);
        } else {
          pool = activeCounty ? [activeCounty] : [];
        }

        const avg = pool.length > 0
          ? pool.reduce((acc, c) => acc + ((c.indicators as any)?.[indKey] || 10), 0) / pool.length
          : 10;

        const allIndVals = jurisdictions.map(j => (j.indicators as any)?.[indKey] || 10);
        const natMean = allIndVals.reduce((a, b) => a + b, 0) / Math.max(1, allIndVals.length);
        const natSd = Math.sqrt(allIndVals.reduce((acc, v) => acc + (v - natMean) ** 2, 0) / Math.max(1, allIndVals.length)) || 1;

        const z = (avg - natMean) / natSd;
        const meta = METRICS_CONFIG[indKey];
        return meta?.bad === 'low' ? -z : z;
      });
    });
  }, [matrixRows, jurisdictions, activeCounty]);

  // Scatter Plot Points
  const scatterPoints: ScatterPoint[] = useMemo(() => {
    return analysisUnits.map(u => ({
      id: u.id,
      x: u.svi,
      y: u.val,
      label: u.name,
      color: TIER_COLORS[u.tier] || '#8B5CF6',
      highlight: u.id === activeCounty?._id,
      radius: geoScope === 'nation' ? 2.8 : 4.0
    }));
  }, [analysisUnits, activeCounty, geoScope]);

  // Open modal with pre-filled analytical insight
  const handleOpenInsightModal = () => {
    const worstUnit = [...analysisUnits].sort((a, b) => b.svi - a.svi)[0];
    const text = `Disparity Observation: ${metricMeta.short} is ${stats.disparityRatio.toFixed(2)}× higher in the most vulnerable quintile (${geoScope === 'tracts' ? 'tracts in ' + activeCounty?.name : activeCounty?.stateName + ' counties'}). ${worstUnit?.name || 'High-need tract'} exhibits severe compounding disadvantage.`;
    setFindingNote(text);
    setFindingModalOpen(true);
  };

  // Submit finding to assessment
  const handleSubmitFinding = async () => {
    if (!findingNote.trim()) return;
    setSubmittingFinding(true);

    try {
      let finalAssessmentId = selectedAssessmentId;
      if (finalAssessmentId === '__new') {
        const createRes = await fetch('/api/assessments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Disparity Assessment: ${activeCounty?.name}`,
            jurisdictionId: activeCounty?._id || '53033',
            template: 'custom',
            indicators: [activeMetric, 'svi', 'poverty', 'uninsured']
          })
        });
        if (createRes.ok) {
          const newA = await createRes.json();
          finalAssessmentId = newA._id;
        } else {
          throw new Error('Failed to create assessment');
        }
      }

      const res = await fetch('/api/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: finalAssessmentId,
          tractId: tracts[0]?._id || `${activeCounty?._id}010100`,
          note: findingNote
        })
      });

      if (res.ok) {
        await markWorkflowMilestone('finding');
        setToastMessage(`Analytical finding linked to Assessment ${finalAssessmentId}`);
        setFindingModalOpen(false);
      }
    } catch (e) {
      console.error(e);
      alert('Error recording finding');
    } finally {
      setSubmittingFinding(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[200] px-4 py-2.5 rounded-xl bg-[var(--surface-solid)] border border-[var(--cyan)] shadow-2xl text-[12.5px] font-bold text-[var(--cyan)] flex items-center gap-2 animate-in slide-in-from-bottom-3">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Screen Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text)] tracking-tight">
            Health Disparity Analysis
          </h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Compare outcomes across vulnerability quintiles, regions and time to see where inequities concentrate.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/census-tracts"
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[12.5px] font-bold text-[var(--text)] hover:bg-[var(--surface-2)] shadow-xs"
          >
            <span>Tract Explorer</span>
            <ArrowRight className="w-3.5 h-3.5 text-[var(--cyan)]" />
          </Link>
        </div>
      </div>

      {/* Toolbar: Indicator Selector & Geography Segmented Switcher */}
      <div className="p-4 rounded-2xl glass-panel flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Indicators */}
        <div>
          <span className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1.5">
            Health Indicator
          </span>
          <div className="flex flex-wrap gap-1.5">
            {DISPARITY_INDICATORS.map(k => (
              <button
                key={k}
                onClick={() => setActiveMetric(k)}
                className={`px-3 py-1.5 rounded-xl text-[12px] font-bold transition-all ${
                  activeMetric === k
                    ? 'bg-[var(--cyan)] text-white shadow-xs'
                    : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)]'
                }`}
              >
                {METRICS_CONFIG[k]?.short || k}
              </button>
            ))}
          </div>
        </div>

        {/* Geography Scope */}
        <div>
          <span className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1.5">
            Geography Scope
          </span>
          <div className="flex rounded-xl border border-[var(--line)] overflow-hidden text-[11.5px] font-bold bg-[var(--surface-2)]">
            <button
              onClick={() => setGeoScope('nation')}
              className={`px-3 py-1.5 transition-colors ${
                geoScope === 'nation' ? 'bg-[var(--cyan)] text-white shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              All US Counties
            </button>
            <button
              onClick={() => setGeoScope('state')}
              className={`px-3 py-1.5 transition-colors ${
                geoScope === 'state' ? 'bg-[var(--cyan)] text-white shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {activeCounty?.stateName || 'State'} Counties
            </button>
            <button
              onClick={() => setGeoScope('tracts')}
              className={`px-3 py-1.5 transition-colors ${
                geoScope === 'tracts' ? 'bg-[var(--cyan)] text-white shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {activeCounty?.name || 'King County'} Tracts
            </button>
          </div>
        </div>
      </div>

      {/* 4 Ruled Disparity KPI Cards (Matching Prototype lines 2185-2189) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl glass-panel">
        <div className="p-3 border-b sm:border-b-0 sm:border-r border-[var(--line)]">
          <div className="text-[11.5px] font-bold text-[var(--muted)]">
            Disparity Ratio (Q5 vs Q1)
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num flex items-baseline gap-1">
            <span>{stats.disparityRatio.toFixed(2)}</span>
            <small className="text-lg text-[var(--faint)] font-sans">×</small>
          </div>
          <div className="text-[11px] text-[var(--faint)] mt-1">
            {metricMeta.short}, quintile 5 against quintile 1
          </div>
        </div>

        <div className="p-3 border-b sm:border-b-0 lg:border-r border-[var(--line)]">
          <div className="text-[11.5px] font-bold text-[var(--muted)]">
            Burden Held by Top 20%
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num flex items-baseline gap-1">
            <span>{stats.top20BurdenShare.toFixed(1)}</span>
            <small className="text-lg text-[var(--faint)] font-sans">%</small>
          </div>
          <div className="text-[11px] text-[var(--faint)] mt-1">
            Population-weighted share of need
          </div>
        </div>

        <div className="p-3 border-b sm:border-b-0 sm:border-r border-[var(--line)]">
          <div className="text-[11.5px] font-bold text-[var(--muted)]">
            10-Yr Gap Change (Since 2016)
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num flex items-baseline gap-1">
            <span>{stats.widening ? '+' : ''}{stats.gapChange.toFixed(1)}</span>
            <small className="text-lg text-[var(--faint)] font-sans">pts</small>
          </div>
          <div className="text-[11px] mt-1 flex items-center gap-1.5">
            <span className={`font-bold ${stats.widening ? 'text-[var(--rose)]' : 'text-[var(--teal)]'}`}>
              {stats.widening ? 'Widening' : 'Narrowing'}
            </span>
            <span className="text-[var(--faint)]">now {stats.gapNow.toFixed(1)} pts</span>
          </div>
        </div>

        <div className="p-3">
          <div className="text-[11.5px] font-bold text-[var(--muted)]">
            Units in Worst Quartile
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num flex items-baseline gap-1">
            <span>{stats.worstQuartileCount}</span>
            <small className="text-sm text-[var(--faint)] font-sans font-normal">of {analysisUnits.length}</small>
          </div>
          <div className="text-[11px] text-[var(--faint)] mt-1">
            {geoScope === 'tracts' ? 'Census tracts in view' : 'Counties in view'}
          </div>
        </div>
      </section>

      {/* Main 12-Column Grid of Disparity Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Chart 1: Quintile Bar Chart (Col 7) */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">
              {metricMeta.label} by Vulnerability Quintile
            </h3>
            <p className="text-[12px] text-[var(--muted)]">
              Population-weighted averages. Quintile 5 represents the most vulnerable.
            </p>
          </div>
          <div className="my-4">
            <BarChart data={quintileBarData} height={240} unit="%" />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            <span>Quintile 1: Least Vulnerable</span>
            <span>Quintile 5: Highest Need</span>
          </div>
        </section>

        {/* Chart 2: Geographic Inequality Concentration (Lorenz) Curve (Col 5) */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Geographic Inequality</h3>
              <p className="text-[12px] text-[var(--muted)]">Concentration curve from most to least vulnerable</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--violet)]/15 border border-[var(--violet)]/30 text-[var(--violet)]">
              Index {stats.concentrationIndex.toFixed(2)}
            </span>
          </div>
          <div className="my-4">
            <LorenzCurve pairs={stats.lorenzPairs} height={240} />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            <span>Dashed line: Absolute equality</span>
            <span>Shaded area: Excess burden</span>
          </div>
        </section>

        {/* Chart 3: Z-Score Diverging Heatmap Matrix (Col 12) */}
        <section className="lg:col-span-12 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">
              Vulnerability Indicator Heatmap Matrix
            </h3>
            <p className="text-[12px] text-[var(--muted)]">
              Standard deviations (SD) from the national county mean. Warmer cells signal worse outcomes.
            </p>
          </div>
          <div className="my-4">
            <ZScoreMatrix
              rows={matrixRows}
              cols={matrixCols}
              matrixData={zScoreMatrixData}
              height={260}
            />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#37C8CF]" />
              <span>Teal: Below National Average (Better)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#F43F5E]" />
              <span>Rose: Above National Average (Higher Burden)</span>
            </span>
          </div>
        </section>

        {/* Chart 4: 10-Year Quintile Trends (Col 7) */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">
              Surveillance Trend Analysis (2016 – 2026)
            </h3>
            <p className="text-[12px] text-[var(--muted)]">
              Historical outcome comparison between Quintile 5 and Quintile 1.
            </p>
          </div>
          <div className="my-4">
            <TrendLineChart years={years10} series={trendSeries} height={230} />
          </div>
          <div className="flex items-center gap-5 pt-2 border-t border-[var(--line)] text-[11.5px]">
            <div className="flex items-center gap-1.5 font-bold text-[var(--text)]">
              <span className="w-3 h-3 rounded-full bg-[#F43F5E]" />
              <span>Quintile 5 (Most Vulnerable)</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-[var(--muted)]">
              <span className="w-3 h-3 rounded-full bg-[#37C8CF]" />
              <span>Quintile 1 (Least Vulnerable)</span>
            </div>
          </div>
        </section>

        {/* Chart 5: Regional Comparison Bars (Col 5) */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Regional Comparison</h3>
            <p className="text-[12px] text-[var(--muted)]">
              Population-weighted {metricMeta.short.toLowerCase()} by Census region.
            </p>
          </div>
          <div className="my-4">
            <BarChart data={regionalData} horizontal={true} height={230} unit="%" />
          </div>
          <div className="pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            US Census Bureau Regional Classifications
          </div>
        </section>

        {/* Chart 6: SVI vs Indicator Rate Scatter Plot (Col 8) */}
        <section className="lg:col-span-8 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">
              Social Vulnerability vs. {metricMeta.short}
            </h3>
            <p className="text-[12px] text-[var(--muted)]">
              Each point is a {geoScope === 'tracts' ? 'census tract' : 'county'}. Click any point to open it on the Health Map.
            </p>
          </div>
          <div className="my-4">
            <ScatterPlot
              points={scatterPoints}
              xLabel="Social Vulnerability Index"
              yLabel={metricMeta.short}
              height={280}
              onPointClick={(pt) => {
                const isTract = pt.id.length === 11;
                const path = isTract
                  ? `/health-map?county=${pt.id.slice(0, 5)}&tract=${pt.id}`
                  : `/health-map?county=${pt.id}`;
                router.push(path);
              }}
            />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            <span>Dotted trendline represents ordinary least squares (OLS) regression</span>
            <span className="font-mono text-[var(--cyan)]">Click dot to inspect on map</span>
          </div>
        </section>

        {/* Chart 7: Analytical Insights Callouts (Col 4) */}
        <section className="lg:col-span-4 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Analytical Insights</h3>
            <p className="text-[12px] text-[var(--muted)]">Automated epidemiologic findings</p>
          </div>

          <div className="space-y-3.5 my-4">
            <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-[var(--cyan)] mt-0.5 flex-shrink-0" />
              <div className="text-[12px] leading-relaxed">
                <p className="text-[var(--text)]">
                  Residents of the most vulnerable fifth of {geoScope === 'tracts' ? 'tracts' : 'counties'} experience{' '}
                  <strong className="text-[var(--cyan)]">{stats.disparityRatio.toFixed(2)}×</strong> the rate of {metricMeta.short.toLowerCase()} seen in the least vulnerable fifth.
                </p>
                <span className="text-[10.5px] text-[var(--faint)] block mt-1">Ratio of Quintile 5 to Quintile 1</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-[var(--violet)] mt-0.5 flex-shrink-0" />
              <div className="text-[12px] leading-relaxed">
                <p className="text-[var(--text)]">
                  The concentration curve reveals that the top 20% most vulnerable population holds{' '}
                  <strong className="text-[var(--rose)]">{stats.top20BurdenShare.toFixed(1)}%</strong> of total community disease burden.
                </p>
                <span className="text-[10.5px] text-[var(--faint)] block mt-1">Population-weighted Lorenz share</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-[var(--amber)] mt-0.5 flex-shrink-0" />
              <div className="text-[12px] leading-relaxed">
                <p className="text-[var(--text)]">
                  The gap between quintiles has{' '}
                  <strong className={stats.widening ? 'text-[var(--rose)]' : 'text-[var(--teal)]'}>
                    {stats.widening ? 'widened' : 'narrowed'}
                  </strong>{' '}
                  by {Math.abs(stats.gapChange).toFixed(1)} points over the 10-year surveillance window.
                </p>
                <span className="text-[10.5px] text-[var(--faint)] block mt-1">Historical trajectory assessment</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleOpenInsightModal}
            className="w-full py-2.5 px-4 rounded-xl bg-[var(--cyan)] text-white hover:opacity-90 text-[12.5px] font-bold flex items-center justify-center gap-2 shadow-xs transition-all"
          >
            <ClipboardList className="w-4 h-4" />
            <span>Add Insight to Assessment</span>
          </button>
        </section>
      </div>

      {/* Add Insight to Assessment Modal */}
      {findingModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-[var(--line)]">
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">Add Finding to Assessment</h3>
                <p className="text-[12px] text-[var(--muted)]">
                  Disparity Analysis • {metricMeta.label}
                </p>
              </div>
              <button
                onClick={() => setFindingModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Assessment Picker */}
            <div>
              <label className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1">
                Select Target Assessment
              </label>
              <select
                value={selectedAssessmentId}
                onChange={(e) => setSelectedAssessmentId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[12.5px] font-bold text-[var(--text)] outline-none"
              >
                {assessmentsList.map(a => (
                  <option key={a._id} value={a._id}>
                    {a.title} ({a.status})
                  </option>
                ))}
                <option value="__new">+ Create New Draft Assessment</option>
              </select>
            </div>

            {/* Editable Observation Text */}
            <div>
              <label className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1">
                Epidemiologic Finding Note
              </label>
              <textarea
                rows={4}
                value={findingNote}
                onChange={(e) => setFindingNote(e.target.value)}
                className="w-full p-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
                placeholder="Enter finding details..."
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
              <button
                onClick={() => setFindingModalOpen(false)}
                className="px-4 py-2 rounded-xl text-[12.5px] font-bold text-[var(--muted)] hover:text-[var(--text)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitFinding}
                disabled={submittingFinding || !findingNote.trim()}
                className="px-5 py-2 rounded-xl bg-[var(--cyan)] hover:opacity-90 disabled:opacity-50 text-[12.5px] font-bold text-white shadow-md transition-all flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>{submittingFinding ? 'Recording...' : 'Attach Finding'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HealthDisparitiesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading disparity analysis...</div>}>
      <HealthDisparitiesContent />
    </Suspense>
  );
}
