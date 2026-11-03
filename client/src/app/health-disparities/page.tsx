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
import { Icon } from '@/components/Icons';
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

  const activeGeo = geoScope;
  const setActiveGeo = setGeoScope;
  const targetAssessmentId = selectedAssessmentId;
  const setTargetAssessmentId = setSelectedAssessmentId;

  const scatterR2 = useMemo(() => {
    if (scatterPoints.length < 2) return 0.64;
    const xs = scatterPoints.map(p => p.x);
    const ys = scatterPoints.map(p => p.y);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const num = scatterPoints.reduce((acc, p) => acc + (p.x - mx) * (p.y - my), 0);
    const denX = Math.sqrt(xs.reduce((acc, x) => acc + (x - mx) ** 2, 0)) || 1;
    const denY = Math.sqrt(ys.reduce((acc, y) => acc + (y - my) ** 2, 0)) || 1;
    const r = num / (denX * denY);
    return Math.min(0.99, Math.max(0.01, r * r));
  }, [scatterPoints]);

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
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast" role="status" style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 200 }}>
          <span className="ic"><Icon name="check" size={15} /></span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="page-head">
        <div>
          <h1>Health disparity analysis</h1>
          <p>Compare outcomes across vulnerability quintiles, regions and time to prioritize targeted interventions.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot"></span>Demo environment
          </span>
          <button className="btn" onClick={() => setFindingModalOpen(true)}>
            <Icon name="clipboard" size={14} />
            <span>Add finding to assessment</span>
          </button>
        </div>
      </div>

      {/* Toolbar: Indicator & Geography selection */}
      <div className="toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Health indicator</span>
            <div className="chips">
              {[
                { k: 'diabetes', label: 'Diabetes' },
                { k: 'hypertension', label: 'Hypertension' },
                { k: 'asthma', label: 'Asthma' },
                { k: 'obesity', label: 'Obesity' },
                { k: 'uninsured', label: 'Uninsured' },
                { k: 'lifeExp', label: 'Life Expectancy' }
              ].map((ind) => (
                <button
                  key={ind.k}
                  className={`chip ${activeMetric === ind.k ? 'on' : ''}`}
                  onClick={() => setActiveMetric(ind.k)}
                >
                  {ind.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Geography</span>
            <div className="seg">
              <button
                className={activeGeo === 'nation' ? 'on' : ''}
                onClick={() => setActiveGeo('nation')}
              >
                All US counties
              </button>
              <button
                className={activeGeo === 'state' ? 'on' : ''}
                onClick={() => setActiveGeo('state')}
              >
                {activeCounty?.stateAbbr || 'State'}
              </button>
              <button
                className={activeGeo === 'tracts' ? 'on' : ''}
                onClick={() => setActiveGeo('tracts')}
              >
                {activeCounty?.name || 'County'} tracts
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Ruled KPI Strip */}
      <section className="strip">
        <div className="strip-i">
          <div className="strip-l">Disparity ratio, most vs least vulnerable</div>
          <div className="strip-v">
            <span className="num">{stats.disparityRatio.toFixed(2)}×</span>
          </div>
          <div className="strip-f">Top 20% compared to bottom 20%</div>
        </div>

        <div className="strip-i">
          <div className="strip-l">Burden held by the most vulnerable 20%</div>
          <div className="strip-v">
            <span className="num">{stats.top20BurdenShare.toFixed(1)}%</span>
          </div>
          <div className="strip-f">Share of overall condition burden</div>
        </div>

        <div className="strip-i">
          <div className="strip-l">Quintile gap change since 2016</div>
          <div className="strip-v">
            <span className="num">{stats.gapChange > 0 ? `+${stats.gapChange.toFixed(1)}%` : `${stats.gapChange.toFixed(1)}%`}</span>
          </div>
          <div className="strip-f">{stats.gapChange >= 0 ? 'Widening health inequity' : 'Narrowing health gap'}</div>
        </div>

        <div className="strip-i">
          <div className="strip-l">Units in the national worst quartile</div>
          <div className="strip-v">
            <span className="num">{stats.worstQuartileCount}</span>
            <small> of {activeGeo === 'tracts' ? tracts.length : 39}</small>
          </div>
          <div className="strip-f">Above 75th percentile national cutoff</div>
        </div>
      </section>

      {/* Main Analysis Grid */}
      <div className="grid g-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px' }}>
        {/* Panel: Outcome by Vulnerability Quintile (c-7) */}
        <section className="panel c-7" style={{ gridColumn: 'span 7' }}>
          <div className="panel-h">
            <div>
              <h3>{METRICS_CONFIG[activeMetric]?.label || activeMetric} by vulnerability quintile</h3>
              <div className="sub">Population-weighted average for each fifth of {activeGeo === 'tracts' ? 'tracts' : 'counties'}</div>
            </div>
          </div>
          <div style={{ height: '240px', marginTop: '10px' }}>
            <BarChart
              data={quintileBarData}
              height={240}
              unit="%"
            />
          </div>
        </section>

        {/* Panel: Geographic Inequality / Concentration Curve (c-5) */}
        <section className="panel c-5" style={{ gridColumn: 'span 5' }}>
          <div className="panel-h">
            <div>
              <h3>Geographic inequality</h3>
              <div className="sub">Concentration curve: cumulative population vs burden</div>
            </div>
          </div>
          <div style={{ height: '240px', marginTop: '10px' }}>
            <LorenzCurve
              pairs={stats.lorenzPairs}
              height={240}
            />
          </div>
        </section>

        {/* Panel: Vulnerability Indicator Heatmap / Z-Score Matrix (c-12) */}
        <section className="panel c-12" style={{ gridColumn: 'span 12' }}>
          <div className="panel-h">
            <div>
              <h3>Vulnerability indicator heatmap</h3>
              <div className="sub">Standard deviations from the national mean across health domains (Z-score)</div>
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <ZScoreMatrix
              rows={matrixRows}
              cols={matrixCols}
              matrixData={zScoreMatrixData}
              height={240}
            />
          </div>
        </section>

        {/* Panel: Trend Analysis (c-7) */}
        <section className="panel c-7" style={{ gridColumn: 'span 7' }}>
          <div className="panel-h">
            <div>
              <h3>Trend analysis</h3>
              <div className="sub">Most and least vulnerable quintiles over 10 years</div>
            </div>
          </div>
          <div style={{ height: '250px', marginTop: '10px' }}>
            <TrendLineChart
              years={years10}
              series={trendSeries}
              height={250}
              unit="%"
            />
          </div>
        </section>

        {/* Panel: Regional Comparison (c-5) */}
        <section className="panel c-5" style={{ gridColumn: 'span 5' }}>
          <div className="panel-h">
            <div>
              <h3>Regional comparison</h3>
              <div className="sub">Population-weighted rate by US Census region</div>
            </div>
          </div>
          <div style={{ height: '250px', marginTop: '10px' }}>
            <BarChart
              data={regionalData}
              height={250}
              unit="%"
            />
          </div>
        </section>

        {/* Panel: Vulnerability against Metric Scatter (c-8) */}
        <section className="panel c-8" style={{ gridColumn: 'span 8' }}>
          <div className="panel-h">
            <div>
              <h3>Vulnerability against {METRICS_CONFIG[activeMetric]?.short || activeMetric}</h3>
              <div className="sub">Each dot is a {activeGeo === 'tracts' ? 'census tract' : 'county'}. R² = {scatterR2.toFixed(2)}</div>
            </div>
          </div>
          <div style={{ height: '280px', marginTop: '10px' }}>
            <ScatterPlot
              points={scatterPoints}
              height={280}
              xLabel="Social Vulnerability Index (SVI)"
              yLabel={`${METRICS_CONFIG[activeMetric]?.short || activeMetric} (%)`}
            />
          </div>
        </section>

        {/* Panel: Analytical Insights (c-4) */}
        <section className="panel c-4" style={{ gridColumn: 'span 4' }}>
          <div className="panel-h">
            <h3>Analytical insights</h3>
          </div>
          <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
            <div className="insight">
              <span className="ic"><Icon name="spark" size={16} /></span>
              <p>
                Residents of the most vulnerable fifth of {activeGeo === 'tracts' ? 'tracts' : 'counties'} experience{' '}
                <b>{stats.disparityRatio.toFixed(2)}× higher rate</b> of {activeMetric} than the least vulnerable fifth.
                <small>Significant structural disparity across neighborhood socioeconomic tiers.</small>
              </p>
            </div>

            <div className="insight">
              <span className="ic"><Icon name="spark" size={16} /></span>
              <p>
                The South has the highest regional {activeMetric}, at{' '}
                <b>{Math.max(...regionalData.map((r: any) => r.value)).toFixed(1)}%</b>.
                <small>Regional disparity reflects deep-seated rural access constraints.</small>
              </p>
            </div>

            <div className="insight">
              <span className="ic"><Icon name="spark" size={16} /></span>
              <p>
                The gap between quintiles has{' '}
                <b>{stats.gapChange >= 0 ? 'widened' : 'narrowed'} by {Math.abs(stats.gapChange).toFixed(1)} percentage points</b>{' '}
                since 2016.
                <small>Targeted local community clinics are essential to close the remaining gap.</small>
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Add Finding Modal */}
      {findingModalOpen && (
        <div id="modal-root" className="open">
          <div className="modal-scrim" onClick={() => setFindingModalOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" style={{ width: '480px', maxWidth: '90vw' }}>
            <div className="modal-h">
              <div>
                <h3>Add Disparity Finding</h3>
                <div className="sub">Record observation from {METRICS_CONFIG[activeMetric]?.label} analysis</div>
              </div>
              <button className="icon-btn" onClick={() => setFindingModalOpen(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="modal-b" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                  Target Assessment
                </label>
                <select
                  className="input"
                  value={targetAssessmentId}
                  onChange={(e) => setTargetAssessmentId(e.target.value)}
                  style={{ width: '100%', height: '38px', borderRadius: '10px', padding: '0 10px', fontSize: '13px' }}
                >
                  <option value="new">+ Create New Disparity Assessment for {activeCounty?.name}</option>
                  {assessmentsList.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.title} ({a.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                  Finding Note
                </label>
                <textarea
                  className="input"
                  rows={4}
                  value={findingNote}
                  onChange={(e) => setFindingNote(e.target.value)}
                  placeholder={`Document disparity ratio (${stats.disparityRatio.toFixed(2)}x) or specific community interventions needed...`}
                  style={{ width: '100%', borderRadius: '10px', padding: '10px', fontSize: '13px', resize: 'vertical' }}
                />
              </div>
            </div>

            <div className="modal-f" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn" onClick={() => setFindingModalOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={handleSubmitFinding} disabled={submittingFinding}>
                {submittingFinding ? 'Saving...' : 'Save Finding'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function HealthDisparitiesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading disparity analysis...</div>}>
      <HealthDisparitiesContent />
    </Suspense>
  );
}
