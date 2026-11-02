'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Assessment, Finding, Report } from '@/types';
import { TIER_LABELS, TIER_COLORS, METRICS_CONFIG, MAP_LAYERS, WORKFLOW_STEPS } from '@/config/metrics';
import Link from 'next/link';
import {
  Grid,
  MapPin,
  Activity,
  ClipboardList,
  Flame,
  ArrowRight,
  ChevronRight,
  TrendingUp,
  FileText,
  Clock,
  Sparkles,
  CheckCircle2,
  Sliders,
  Scale,
  Flag,
  FileSpreadsheet,
  Layers,
  Database
} from 'lucide-react';

import { MapViewCanvas, getMetricVal } from '@/components/MapViewCanvas';
import { DashboardCoverageMap } from '@/components/DashboardCoverageMap';
import { CountyRecord } from '@/utils/countyRepository';

function formatRelativeTime(dateString?: string) {
  if (!dateString) return 'recently';
  const d = new Date(dateString);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

// 5 Assessment Pipeline Workflow Stages matching prototype
const ASSESSMENT_PIPELINE = [
  { step: 1, name: 'Scope & Jurisdiction', icon: MapPin },
  { step: 2, name: 'Indicator Prioritization', icon: Sliders },
  { step: 3, name: 'Disparity Analysis', icon: Scale },
  { step: 4, name: 'Needs Tagging', icon: Flag },
  { step: 5, name: 'Report & Presentation', icon: FileSpreadsheet }
];

// Regional coverage data matching prototype
const REGION_COVERAGE = [
  { name: 'Midwest', cov: 96.2, counties: 1055, color: '#2584EB' },
  { name: 'Northeast', cov: 98.4, counties: 217, color: '#66B6F5' },
  { name: 'South', cov: 94.8, counties: 1424, color: '#37C8CF' },
  { name: 'West', cov: 97.1, counties: 446, color: '#9FE3E7' }
];

// Recent data imports matching prototype
const RECENT_DATA_IMPORTS = [
  {
    id: 'IMP-3391',
    name: 'ACS 5-year tract estimates',
    src: 'Census Bureau API',
    rows: '2,841,203 rows',
    status: 'Completed',
    statusClass: 'bg-[var(--teal)]/15 text-[var(--teal)] border-[var(--teal)]/30',
    when: '2026-10-27 06:12'
  },
  {
    id: 'IMP-3388',
    name: 'Chronic disease prevalence (tract)',
    src: 'File upload',
    rows: '72,337 rows',
    status: 'Warnings',
    statusClass: 'bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30',
    when: '2026-10-25 15:40'
  },
  {
    id: 'IMP-3384',
    name: 'Program enrollment extract',
    src: 'State program registry',
    rows: '18,422 rows',
    status: 'Failed',
    statusClass: 'bg-[var(--rose)]/15 text-[var(--rose)] border-[var(--rose)]/30',
    when: '2026-10-24 09:03'
  },
  {
    id: 'IMP-3379',
    name: 'TIGER/Line tract geometries',
    src: 'Census Bureau',
    rows: '85,187 rows',
    status: 'Completed',
    statusClass: 'bg-[var(--teal)]/15 text-[var(--teal)] border-[var(--teal)]/30',
    when: '2026-10-20 02:00'
  }
];

export default function DashboardPage() {
  const {
    activeCounty,
    setActiveJurisdiction,
    markWorkflowMilestone,
    trendYears,
    session,
    setWorkflowDrawerOpen
  } = useSession();

  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [trendMetric, setTrendMetric] = useState<string>('diabetes');
  const [trendsData, setTrendsData] = useState<{
    years: string[];
    countyVals: number[];
    stateVals: number[];
  } | null>(null);
  const [importsData, setImportsData] = useState<any[] | null>(null);
  const [activeLayer, setActiveLayer] = useState<string>('sdoh');
  const [dashboardHeatmap, setDashboardHeatmap] = useState<boolean>(true);
  const [selectedTract, setSelectedTract] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    markWorkflowMilestone('dash');
  }, [markWorkflowMilestone]);

  // Fetch live import logs from database
  useEffect(() => {
    fetch('/api/data/imports')
      .then(r => r.ok ? r.json() : [])
      .then(logs => {
        if (Array.isArray(logs) && logs.length > 0) {
          const formatted = logs.slice(0, 4).map(l => ({
            id: l._id || `IMP-${l.id}`,
            name: l.name || l.dataset || 'Data Import',
            src: l.source || 'Automated Sync',
            rows: `${(l.rows || 0).toLocaleString()} rows`,
            status: l.status || 'Completed',
            statusClass: l.status === 'Failed'
              ? 'bg-[var(--rose)]/15 text-[var(--rose)] border-[var(--rose)]/30'
              : l.status === 'Completed with warnings' || l.status === 'Warnings'
              ? 'bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30'
              : 'bg-[var(--teal)]/15 text-[var(--teal)] border-[var(--teal)]/30',
            when: l.startedAt ? l.startedAt.slice(0, 16).replace('T', ' ') : 'Recent'
          }));
          setImportsData(formatted);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch live trends from analytics endpoint
  useEffect(() => {
    if (!activeCounty?._id) return;
    fetch(`/api/analytics/trends?metric=${trendMetric}&county=${activeCounty._id}&range=10`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.years && data.series && data.series.length >= 2) {
          setTrendsData({
            years: data.years,
            countyVals: data.series[0].values,
            stateVals: data.series[1].values
          });
        } else {
          setTrendsData(null);
        }
      })
      .catch(() => setTrendsData(null));
  }, [activeCounty?._id, trendMetric]);

  // Fetch live data from endpoints
  useEffect(() => {
    if (!activeCounty) return;

    setLoading(true);
    setSelectedTract(null);

    Promise.all([
      fetch(`/api/tracts?county=${activeCounty._id}`).then(r => r.ok ? r.json() : { data: [] }),
      fetch(`/api/assessments?jurisdiction=${activeCounty._id}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/findings?jurisdiction=${activeCounty._id}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/reports?jurisdiction=${activeCounty._id}`).then(r => r.ok ? r.json() : [])
    ])
      .then(([tractsRes, assessmentsRes, findingsRes, reportsRes]) => {
        setTracts(tractsRes.data || []);
        setAssessments(assessmentsRes || []);
        setFindings(findingsRes || []);
        setReports(reportsRes || []);
      })
      .catch(err => console.error('[Dashboard Fetch Error]:', err))
      .finally(() => setLoading(false));
  }, [activeCounty]);

  // SVI Tier Distribution
  const tiersCount = useMemo(() => {
    return [0, 1, 2, 3, 4].map(tierIdx => tracts.filter(t => t.tier === tierIdx).length);
  }, [tracts]);

  const highNeedCount = tiersCount[3] + tiersCount[4];
  const inReviewAssessments = assessments.filter(a => a.status === 'In review').length;
  const inDraftAssessments = assessments.filter(a => a.status === 'Draft').length;

  // Program utilization
  const programData = useMemo(() => [
    { name: 'WIC Nutrition', key: 'wic', value: activeCounty?.prog?.wic || 74 },
    { name: 'Immunization', key: 'imm', value: activeCounty?.prog?.imm || 82 },
    { name: 'Diabetes Prevention (DPP)', key: 'dpp', value: activeCounty?.prog?.dpp || 46 },
    { name: 'Tobacco Cessation', key: 'tob', value: activeCounty?.prog?.tob || 38 },
    { name: 'Mobile Health Vans (MHV)', key: 'mhv', value: activeCounty?.prog?.mhv || 52 }
  ], [activeCounty]);

  // Activity Feed
  const activityItems = useMemo(() => [
    ...findings.map(f => ({
      id: f._id,
      type: 'finding',
      title: f.tractName ? `Finding on ${f.tractName}: ${f.note}` : `Finding: ${f.note}`,
      time: f.addedDate || f.createdAt || '',
      badge: 'Finding'
    })),
    ...reports.map(r => ({
      id: r._id,
      type: 'report',
      title: `Report generated: ${r.title}`,
      time: r.createdAt,
      badge: r.status
    })),
    ...assessments.map(a => ({
      id: a._id,
      type: 'assessment',
      title: `${a.title} (${a.status})`,
      time: a.updatedAt || a.createdAt || a.due || '',
      badge: 'CHNA'
    }))
  ]
    .sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime())
    .slice(0, 4), [findings, reports, assessments]);

  // Workflow steps counter
  const completedSteps = Object.keys(session?.workflowMilestones || {}).filter(
    k => session?.workflowMilestones?.[k]
  ).length;

  // Active Metric for map layer
  const activeMetric = useMemo(() => {
    if (activeLayer === 'disease') return 'incidence';
    if (activeLayer === 'programs') return 'utilization';
    if (activeLayer === 'access') return 'access';
    return 'sdoh';
  }, [activeLayer]);

  // Tier groupings for Disparity Analysis Table
  const tierAverages = useMemo(() => {
    return [4, 3, 2, 1, 0].map(tierIdx => {
      const tierTracts = tracts.filter(t => t.tier === tierIdx);
      const tractCount = tierTracts.length;
      const popSum = tierTracts.reduce((sum, t) => sum + (t.population || 2800), 0);

      // Diabetes average
      const dmVals = tierTracts.map(t => getMetricVal(t, 'diabetes'));
      const dmAvg = dmVals.length ? dmVals.reduce((a, b) => a + b, 0) / dmVals.length : (14.5 - tierIdx * 1.8);

      // Uninsured average
      const unVals = tierTracts.map(t => getMetricVal(t, 'uninsured'));
      const unAvg = unVals.length ? unVals.reduce((a, b) => a + b, 0) / unVals.length : (16.2 - tierIdx * 2.2);

      // Life expectancy average
      const leVals = tierTracts.map(t => getMetricVal(t, 'lifeExp'));
      const leAvg = leVals.length ? leVals.reduce((a, b) => a + b, 0) / leVals.length : (72.5 + tierIdx * 1.9);

      return {
        tierIdx,
        label: TIER_LABELS[tierIdx],
        color: TIER_COLORS[tierIdx],
        count: tractCount,
        population: popSum,
        diabetes: dmAvg,
        uninsured: unAvg,
        lifeExp: leAvg
      };
    });
  }, [tracts]);

  // 10-year trend data comparison (County vs State average)
  const trendComparison = useMemo(() => {
    if (trendsData) return trendsData;

    const years = ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
    const baseVal = (activeCounty?.indicators as any)?.[trendMetric] ?? (trendMetric === 'diabetes' ? 10.5 : trendMetric === 'hypertension' ? 31.0 : 12.0);
    const countyVals = years.map((_, i) => Math.max(2, parseFloat((baseVal * (0.88 + i * 0.014)).toFixed(1))));
    const stateVals = years.map((_, i) => Math.max(2, parseFloat(((baseVal * 0.92) * (0.90 + i * 0.011)).toFixed(1))));
    return { years, countyVals, stateVals };
  }, [activeCounty, trendMetric, trendsData]);

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* 1. Header with Title and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text)] tracking-tight">
            Community Health Dashboard
          </h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-0.5">
            Geographic health insights for smarter public health decisions in{' '}
            <span className="font-bold text-[var(--text)]">
              {activeCounty?.name || 'Cook County'}, {activeCounty?.stateAbbr || 'IL'}
            </span>.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="px-3 py-1.5 rounded-full text-[11px] font-bold bg-[var(--amber)]/10 text-[var(--amber)] border border-[var(--amber)]/25 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]" />
            <span>Synthetic demo data</span>
          </span>

          <Link
            href="/assessments"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[12.5px] font-bold text-[var(--text)] hover:bg-[var(--surface-2)] shadow-xs transition-all"
          >
            <ClipboardList className="w-4 h-4 text-[var(--violet)]" />
            <span>New assessment</span>
          </Link>

          <Link
            href="/health-map"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--cyan)] hover:opacity-90 text-[12.5px] font-bold text-[#07111F] shadow-md transition-all"
          >
            <MapPin className="w-4 h-4" />
            <span>Open health map</span>
          </Link>
        </div>
      </div>

      {/* 2. Top Metrics Strip (4 Ruled Cards matching prototype) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-2xl glass-panel">
        <div className="p-3 border-r border-[var(--line)] last:border-r-0">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
            <Grid className="w-4 h-4 text-[var(--cyan)]" />
            <span>Census tracts analyzed</span>
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num">
            {tracts.length}
          </div>
          <div className="text-[11.5px] text-[var(--cyan)] font-semibold mt-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--cyan)]" />
            <span>{highNeedCount} high-need tracts in {activeCounty?.name || 'Cook County'}</span>
          </div>
        </div>

        <div className="p-3 border-r border-[var(--line)] last:border-r-0">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
            <MapPin className="w-4 h-4 text-[var(--teal)]" />
            <span>Geographic coverage</span>
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num">
            3,142 <small className="text-sm font-normal text-[var(--muted)]">counties</small>
          </div>
          <div className="text-[11.5px] text-[var(--faint)] mt-1">
            50 states and DC loaded
          </div>
        </div>

        <div className="p-3 border-r border-[var(--line)] last:border-r-0">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
            <Activity className="w-4 h-4 text-[var(--violet)]" />
            <span>Health indicators</span>
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num">
            28
          </div>
          <div className="text-[11.5px] text-[var(--faint)] mt-1">
            Across 5 map layers
          </div>
        </div>

        <div className="p-3">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
            <ClipboardList className="w-4 h-4 text-[var(--amber)]" />
            <span>Active assessments</span>
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num">
            {assessments.length}
          </div>
          <div className="text-[11.5px] text-[var(--teal)] font-semibold mt-1">
            {inReviewAssessments} in review, {inDraftAssessments} in draft
          </div>
        </div>
      </section>

      {/* 3. Row 1: Interactive Health Map & Indicator Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Community Health Map (Col 7) */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between min-h-[470px]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[var(--line)] gap-3">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Community Health Map</h3>
              <p className="text-[12px] text-[var(--muted)]">
                Census tracts in {activeCounty?.name || 'Cook County'}, {activeCounty?.stateAbbr || 'IL'}. Click a tract for details
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Hotspot Toggle */}
              <button
                onClick={() => setDashboardHeatmap(!dashboardHeatmap)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                  dashboardHeatmap
                    ? 'bg-[var(--rose)]/15 border-[var(--rose)] text-[var(--rose)] shadow-xs'
                    : 'border-[var(--line)] text-[var(--muted)] bg-[var(--surface-2)]'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Hotspots {dashboardHeatmap ? 'ON' : 'OFF'}</span>
              </button>

              {/* Layer Selector */}
              <div className="flex rounded-xl border border-[var(--line)] overflow-hidden text-[11px] font-bold bg-[var(--surface-2)]">
                {['SDOH', 'Disease', 'Programs', 'Access'].map((l) => {
                  const lId = l.toLowerCase();
                  return (
                    <button
                      key={l}
                      onClick={() => setActiveLayer(lId)}
                      className={`px-3 py-1.5 transition-colors ${
                        activeLayer === lId
                          ? 'bg-[var(--cyan)] text-white shadow-xs'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Map View Canvas (with surrounding dimmed counties, hover highlight, and click-to-demonstrate) */}
          <div className="my-3 h-[370px] w-full rounded-xl overflow-hidden relative border border-[var(--line)]">
            <MapViewCanvas
              countyFips={activeCounty?._id || '17031'}
              tracts={tracts}
              heatmap={dashboardHeatmap}
              markers={true}
              layer={activeLayer}
              metric={activeMetric}
              height={370}
              onSelectTract={(t) => setSelectedTract(t)}
              onSelectCounty={(c) => {
                setActiveJurisdiction(c.id);
              }}
            />

            {/* Top-Right Floating Status Card */}
            <div className="absolute top-3 right-3 max-w-[250px] p-3 rounded-xl bg-[#0c1427]/95 backdrop-blur-md border border-[rgba(255,255,255,0.18)] shadow-2xl text-[12px] text-white">
              {selectedTract ? (
                <div>
                  <b className="block text-[13px] text-white font-bold leading-tight">{selectedTract.name}</b>
                  <div className="text-[11px] text-[rgba(255,255,255,0.6)] mt-0.5">
                    {TIER_LABELS[selectedTract.tier]} vulnerability • {(selectedTract.pop || selectedTract.population || 0).toLocaleString()} residents
                  </div>
                  <Link
                    href={`/census-tracts?county=${activeCounty?._id}&tract=${selectedTract.id || selectedTract._id}`}
                    className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--cyan)] text-[#07111F] text-[11px] font-bold hover:opacity-90 shadow-md transition-all"
                  >
                    <span>Open in tract explorer</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ) : (
                <div>
                  <b className="block text-[12.5px] text-white font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--rose)]" />
                    <span>{highNeedCount} high vulnerability tracts</span>
                  </b>
                  <div className="text-[11px] text-[rgba(255,255,255,0.55)] mt-1">
                    Highlighted with pulsing markers & outside region tap to switch county
                  </div>
                </div>
              )}
            </div>

            {/* Bottom-Left Floating Legend */}
            <div className="absolute bottom-3 left-3 px-3 py-2 rounded-xl bg-[#0c1427]/95 backdrop-blur-md border border-[rgba(255,255,255,0.18)] shadow-xl text-[11px] text-white min-w-[200px]">
              <div className="font-bold text-white capitalize mb-1">
                {METRICS_CONFIG[activeMetric]?.short || activeMetric} (Tracts in county)
              </div>
              <div className="flex h-2.5 rounded overflow-hidden mb-1">
                {['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'].map((c, i) => (
                  <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex justify-between items-center text-[9.5px] text-[rgba(255,255,255,0.5)]">
                <span>Lowest</span>
                <span>Quantile bins</span>
                <span>Highest</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[var(--line)] text-[12px] text-[var(--muted)]">
            <span>Tap outside region to focus neighbor county</span>
            <div className="flex items-center gap-3">
              {TIER_LABELS.map((lbl, idx) => (
                <div key={lbl} className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS[idx] }} />
                  <span className="hidden sm:inline">{lbl}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right: Health Indicator Trends (Col 5) */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Health Indicator Trends</h3>
              <p className="text-[12px] text-[var(--muted)]">
                10 Years surveillance • {activeCounty?.name || 'Cook County'} against {activeCounty?.stateName || 'Illinois'}
              </p>
            </div>
            <select
              value={trendMetric}
              onChange={(e) => setTrendMetric(e.target.value)}
              className="text-[12px] font-bold px-2.5 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text)] outline-none"
            >
              <option value="diabetes">Diabetes</option>
              <option value="hypertension">Hypertension</option>
              <option value="uninsured">Uninsured</option>
              <option value="asthma">Asthma</option>
              <option value="obesity">Obesity</option>
            </select>
          </div>

          {/* Legend row */}
          <div className="flex items-center gap-4 text-[12px] my-2">
            <div className="flex items-center gap-1.5 font-bold text-[var(--text)]">
              <span className="w-3 h-3 rounded-full bg-[var(--cyan)]" />
              <span>{activeCounty?.name || 'Cook County'}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--muted)] font-semibold">
              <span className="w-3 h-3 rounded-full bg-[var(--teal)]" />
              <span>{activeCounty?.stateName || 'Illinois'} average</span>
            </div>
          </div>

          {/* SVG Line Chart */}
          <div className="my-2 h-[260px] w-full relative flex items-center justify-center">
            <svg viewBox="0 0 440 220" className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="trendCyanFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* County Line & Area */}
              {(() => {
                const allVals = [...trendComparison.countyVals, ...trendComparison.stateVals];
                const minRaw = Math.min(...allVals);
                const maxRaw = Math.max(...allVals);
                const yMin = Math.max(0, Math.floor(minRaw - 2));
                const yMax = Math.ceil(maxRaw + 2);
                const ySpan = Math.max(1, yMax - yMin);
                const numSteps = Math.max(1, trendComparison.years.length - 1);

                const pts = trendComparison.countyVals.map((v, i) => {
                  const x = 50 + (i * 360) / numSteps;
                  const y = 180 - ((Math.min(yMax, Math.max(yMin, v)) - yMin) / ySpan) * 160;
                  return [x, y];
                });
                const dPath = pts.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`, '');
                const areaPath = `${dPath} L${pts[pts.length - 1][0]},180 L${pts[0][0]},180 Z`;

                const statePts = trendComparison.stateVals.map((v, i) => {
                  const x = 50 + (i * 360) / numSteps;
                  const y = 180 - ((Math.min(yMax, Math.max(yMin, v)) - yMin) / ySpan) * 160;
                  return [x, y];
                });
                const statePath = statePts.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`, '');

                const yTicks = [0, 1, 2, 3, 4].map(idx => {
                  const val = yMax - (idx * ySpan) / 4;
                  const y = 20 + idx * 40;
                  return { val, y };
                });

                return (
                  <g>
                    {/* Dynamic Y Axis labels & grid lines */}
                    {yTicks.map(tick => (
                      <g key={tick.y}>
                        <line
                          x1="40"
                          y1={tick.y}
                          x2="420"
                          y2={tick.y}
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth="1"
                          strokeDasharray="4 4"
                        />
                        <text x="32" y={tick.y + 4} textAnchor="end" fill="var(--faint)" fontSize="10" className="num">
                          {tick.val.toFixed(0)}%
                        </text>
                      </g>
                    ))}

                    <path d={areaPath} fill="url(#trendCyanFill)" />
                    <path d={statePath} fill="none" stroke="var(--teal)" strokeWidth="2.4" strokeDasharray="5 3" />
                    <path d={dPath} fill="none" stroke="var(--cyan)" strokeWidth="3" />
                    {pts.map((p, i) => (
                      <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="var(--cyan)" stroke="#07111F" strokeWidth="2" />
                    ))}
                  </g>
                );
              })()}

              {/* X Axis Years */}
              {trendComparison.years.map((yr, i) => (
                <text
                  key={yr}
                  x={50 + (i * 360) / 9}
                  y="204"
                  textAnchor="middle"
                  fill="var(--faint)"
                  fontSize="10"
                  className="num"
                >
                  {yr}
                </text>
              ))}
            </svg>
          </div>

          <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between text-[12px] text-[var(--muted)]">
            <span>Source: CDC BRFSS surveillance</span>
            <Link href="/health-disparities" className="text-[var(--cyan)] font-bold hover:underline flex items-center gap-1">
              <span>Disparity analysis</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </section>
      </div>

      {/* 4. Row 2: Vulnerability Donut, Program Bars, Recent Activity (3 Columns) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Community Vulnerability Tiers Donut */}
        <div className="rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Community Vulnerability</h3>
              <p className="text-[12px] text-[var(--muted)]">Tracts by vulnerability tier</p>
            </div>
            <Link href="/census-tracts" className="text-[12px] font-bold text-[var(--cyan)] hover:underline flex items-center gap-1">
              <span>View all</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="my-4 flex items-center gap-5">
            {/* SVG Donut Visualizer */}
            <div className="relative w-32 h-32 flex-shrink-0 flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                {tiersCount.map((count, i) => {
                  const total = Math.max(tracts.length, 1);
                  const pct = count / total;
                  const strokeLen = pct * 282.7;
                  const prevPct = tiersCount.slice(0, i).reduce((sum, c) => sum + c / total, 0);
                  const strokeOffset = -prevPct * 282.7;

                  return (
                    <circle
                      key={i}
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke={TIER_COLORS[i]}
                      strokeWidth="14"
                      strokeDasharray={`${strokeLen} 282.7`}
                      strokeDashoffset={strokeOffset}
                      className="transition-all duration-500"
                    />
                  );
                })}
              </svg>
              <div className="absolute text-center leading-tight">
                <span className="block text-xl font-bold font-display text-[var(--text)] num">
                  {tracts.length}
                </span>
                <span className="text-[10px] text-[var(--faint)] font-bold uppercase">
                  Tracts
                </span>
              </div>
            </div>

            {/* Tier Breakdown Percentages */}
            <div className="flex-1 space-y-1.5">
              {[4, 3, 2, 1, 0].map(tierIdx => {
                const count = tiersCount[tierIdx];
                const pct = tracts.length ? Math.round((count / tracts.length) * 100) : 0;
                return (
                  <div key={tierIdx} className="flex items-center justify-between text-[11.5px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TIER_COLORS[tierIdx] }} />
                      <span className="text-[var(--text)] font-semibold">{TIER_LABELS[tierIdx]}</span>
                    </div>
                    <span className="font-bold text-[var(--muted)] num">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-2 text-[11.5px] text-[var(--faint)]">
            CDC Social Vulnerability Index methodology
          </div>
        </div>

        {/* Card 2: Program Utilization */}
        <div className="rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Program Utilization</h3>
              <p className="text-[12px] text-[var(--muted)]">Share of eligible residents enrolled</p>
            </div>
            <Link href="/program-utilization" className="text-[12px] font-bold text-[var(--cyan)] hover:underline flex items-center gap-1">
              <span>Details</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="my-4 space-y-3">
            {programData.map((prog) => (
              <div key={prog.key} className="space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-[var(--text)]">{prog.name}</span>
                  <span className="font-bold text-[var(--cyan)] num">{prog.value}%</span>
                </div>
                <div className="h-2 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--teal)] to-[var(--cyan)] rounded-full transition-all duration-500"
                    style={{ width: `${prog.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 text-[11.5px] text-[var(--faint)]">
            Target benchmark: 80% community saturation
          </div>
        </div>

        {/* Card 3: Recent Activity Feed */}
        <div className="rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Recent Activity</h3>
              <p className="text-[12px] text-[var(--muted)]">Live findings & assessments</p>
            </div>
            <Link href="/assessments" className="text-[12px] font-bold text-[var(--cyan)] hover:underline flex items-center gap-1">
              <span>View all</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="my-3 space-y-2.5">
            {activityItems.length > 0 ? (
              activityItems.map((act) => (
                <div key={act.id} className="flex items-start gap-2.5 p-2 rounded-xl bg-[var(--surface-2)]/60 text-[12px]">
                  <FileText className="w-4 h-4 text-[var(--violet)] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[var(--text)] truncate">{act.title}</div>
                    <div className="text-[10.5px] text-[var(--faint)] flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      <span>{formatRelativeTime(act.time)}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[12px] text-[var(--muted)] text-center py-6">
                No recent activity recorded yet.
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between text-[11.5px] text-[var(--muted)]">
            <span>Workflow: {completedSteps} / 10 steps</span>
            <button
              onClick={() => setWorkflowDrawerOpen(true)}
              className="font-bold text-[var(--cyan)] hover:underline"
            >
              Checklist
            </button>
          </div>
        </div>
      </div>

      {/* 5. Row 3: Health Disparity Analysis Table & Guided Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Table: Health Disparity Analysis (Col 7) */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Health Disparity Analysis</h3>
              <p className="text-[12px] text-[var(--muted)]">Tract averages by vulnerability tier</p>
            </div>
            <Link
              href="/health-disparities"
              className="text-[12px] font-bold text-[var(--cyan)] hover:underline flex items-center gap-1"
            >
              <span>Open analysis</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="my-3 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--faint)] font-bold">
                  <th className="py-2.5 pr-4">Vulnerability tier</th>
                  <th className="py-2.5 px-3 text-right">Tracts</th>
                  <th className="py-2.5 px-3 text-right">Residents</th>
                  <th className="py-2.5 px-3">Diabetes</th>
                  <th className="py-2.5 px-3 text-right">Uninsured</th>
                  <th className="py-2.5 pl-3 text-right">Life exp.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]/50">
                {tierAverages.map((row) => (
                  <tr key={row.tierIdx} className="hover:bg-[var(--surface-2)]/40 transition-colors">
                    <td className="py-2.5 pr-4 flex items-center gap-2 font-semibold text-[var(--text)]">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                      <span>{row.label}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right num text-[var(--muted)] font-medium">
                      {row.count}
                    </td>
                    <td className="py-2.5 px-3 text-right num font-semibold text-[var(--text)]">
                      {Math.round(row.population / 1000)}k
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                          <div
                            className="h-full bg-[var(--cyan)] rounded-full"
                            style={{ width: `${Math.min(100, (row.diabetes / 18) * 100)}%` }}
                          />
                        </div>
                        <span className="num font-bold text-[var(--text)] text-[11px] w-10 text-right">
                          {row.diabetes.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right num font-semibold text-[var(--muted)]">
                      {row.uninsured.toFixed(1)}%
                    </td>
                    <td className="py-2.5 pl-3 text-right num font-bold text-[var(--text)]">
                      {row.lifeExp.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-2 text-[11.5px] text-[var(--faint)]">
            Based on active jurisdiction census tracts surveillance data
          </div>
        </section>

        {/* Guided Analysis Workflow (Col 5) */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Guided Analysis</h3>
              <p className="text-[12px] text-[var(--muted)]">From map selection to exported report</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--cyan)]/15 text-[var(--cyan)] border border-[var(--cyan)]/30">
              {completedSteps} of 10 steps
            </span>
          </div>

          <div className="my-3 space-y-2.5">
            {WORKFLOW_STEPS.slice(0, 4).map((step, idx) => {
              const isDone = !!session?.workflowMilestones?.[step.id];
              return (
                <div
                  key={step.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                        isDone
                          ? 'bg-[var(--teal)] text-[#07111F]'
                          : 'bg-[var(--surface-solid)] border border-[var(--line-strong)] text-[var(--muted)]'
                      }`}
                    >
                      {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                    </span>
                    <div className="truncate">
                      <b className="block text-[12.5px] font-bold text-[var(--text)] truncate">{step.title}</b>
                      <small className="block text-[10.5px] text-[var(--faint)] truncate">{step.desc}</small>
                    </div>
                  </div>
                  <Link
                    href={step.route}
                    className="ml-3 px-3 py-1 rounded-lg bg-[var(--surface-solid)] hover:bg-[var(--cyan)] hover:text-[#07111F] text-[11px] font-bold text-[var(--cyan)] border border-[var(--line)] transition-all flex-shrink-0"
                  >
                    Go
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Progress Bar */}
          <div className="pt-3 border-t border-[var(--line)]">
            <div className="h-2 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[var(--teal)] to-[var(--cyan)] rounded-full transition-all duration-700"
                style={{ width: `${Math.max(10, completedSteps * 10)}%` }}
              />
            </div>
          </div>
        </section>
      </div>

      {/* 6. Row 4: Community Needs Assessment Progress Pipeline (Col 12) */}
      <section className="rounded-2xl glass-panel p-5">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--line)] mb-4">
          <div>
            <h3 className="text-base font-bold text-[var(--text)]">Community Needs Assessment Progress</h3>
            <p className="text-[12px] text-[var(--muted)]">Assessments at each stage of the workflow</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--teal)]/15 text-[var(--teal)] border border-[var(--teal)]/30 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--teal)]" />
            <span>{assessments.length} assessments</span>
          </span>
        </div>

        {/* 5 Stages Pipeline */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {ASSESSMENT_PIPELINE.map((stage) => {
            const Icon = stage.icon;
            const countInStage = assessments.filter(a => {
              if (stage.step === 5) return a.status === 'Completed';
              return (a.step ?? 1) === stage.step;
            }).length;

            return (
              <Link
                key={stage.step}
                href="/assessments"
                className="p-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/50 hover:border-[var(--cyan)] hover:bg-[var(--surface-2)] transition-all flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-7 h-7 rounded-lg bg-[var(--cyan)]/15 text-[var(--cyan)] flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-bold text-[var(--faint)]">Stage {stage.step}</span>
                </div>
                <div>
                  <b className="block text-[12.5px] font-bold text-[var(--text)] leading-tight">{stage.name}</b>
                  <small className="block text-[11px] text-[var(--muted)] mt-1 font-semibold">
                    {countInStage} {stage.step === 5 ? 'completed' : 'active'}
                  </small>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 7. Row 5: Geographic Coverage & Recent Data Updates */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Geographic Coverage (Col 7) */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Geographic Coverage</h3>
              <p className="text-[12px] text-[var(--muted)]">Share of tracts with complete indicator data, by state</p>
            </div>
            <Link
              href="/data-management"
              className="text-[12px] font-bold text-[var(--cyan)] hover:underline flex items-center gap-1"
            >
              <span>Data quality</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="my-4 flex flex-col md:flex-row items-center gap-5">
            {/* Real SVG US State Coverage Map with active jurisdiction & peer county pins */}
            <div className="flex-1 w-full min-w-0">
              <DashboardCoverageMap
                activeCountyFips={activeCounty?._id || '17031'}
                onSelectCounty={(c) => setActiveJurisdiction(c.id)}
              />
            </div>

            {/* Region breakdown list */}
            <div className="w-full md:w-[210px] space-y-2 flex-shrink-0">
              {REGION_COVERAGE.map((r) => (
                <div key={r.name} className="p-2 rounded-xl bg-[var(--surface-2)]/60 border border-[var(--line)]/50 flex items-center justify-between text-[11.5px]">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="font-semibold text-[var(--text)]">{r.name}</span>
                  </div>
                  <div className="text-right">
                    <b className="num text-[var(--text)] font-bold">{r.cov}%</b>
                    <small className="block text-[10px] text-[var(--faint)]">{r.counties.toLocaleString()} counties</small>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 text-[11.5px] text-[var(--faint)]">
            Census ACS & CDC PLACES synchronized nightly
          </div>
        </section>

        {/* Right: Recent Data Updates (Col 5) */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Recent Data Updates</h3>
              <p className="text-[12px] text-[var(--muted)]">Automated ingest & verification logs</p>
            </div>
            <Link
              href="/data-management"
              className="text-[12px] font-bold text-[var(--cyan)] hover:underline flex items-center gap-1"
            >
              <span>View all</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="my-3 space-y-2.5">
            {(importsData || RECENT_DATA_IMPORTS).map((imp) => (
              <div
                key={imp.id}
                className="p-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/50 flex items-center justify-between text-[12px]"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <b className="block text-[12.5px] font-bold text-[var(--text)] truncate">{imp.name}</b>
                  <small className="block text-[10.5px] text-[var(--faint)] truncate">
                    {imp.src} • {imp.rows} • {imp.when}
                  </small>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border flex-shrink-0 ${imp.statusClass}`}>
                  {imp.status}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-2 text-[11.5px] text-[var(--faint)] flex items-center justify-between">
            <span>Next scheduled sync: 02:00 UTC</span>
            <Link href="/data-management" className="text-[var(--cyan)] font-bold hover:underline">
              Manage pipelines
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
