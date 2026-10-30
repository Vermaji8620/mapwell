'use client';

import React, { useEffect, useState } from 'react';
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
  TrendingUp,
  FileText,
  Clock,
  Sparkles,
  ChevronRight
} from 'lucide-react';

import { MapViewCanvas } from '@/components/MapViewCanvas';

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

export default function DashboardPage() {
  const { activeCounty, markWorkflowMilestone, trendYears, session, setWorkflowDrawerOpen } = useSession();

  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [trendMetric, setTrendMetric] = useState<string>('diabetes');
  const [trendData, setTrendData] = useState<any>(null);
  const [activeLayer, setActiveLayer] = useState<string>('sdoh');
  const [dashboardHeatmap, setDashboardHeatmap] = useState<boolean>(true);
  const [selectedTract, setSelectedTract] = useState<CensusTract | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    markWorkflowMilestone('dash');
  }, [markWorkflowMilestone]);

  // Fetch all live data from database endpoints
  useEffect(() => {
    if (!activeCounty) return;

    setLoading(true);
    setSelectedTract(null);

    Promise.all([
      fetch(`/api/tracts?county=${activeCounty._id}`).then(r => r.ok ? r.json() : { data: [] }),
      fetch(`/api/assessments?jurisdiction=${activeCounty._id}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/findings?jurisdiction=${activeCounty._id}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/reports?jurisdiction=${activeCounty._id}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/analytics/trends?county=${activeCounty._id}&metric=${trendMetric}&range=${trendYears}`).then(r => r.ok ? r.json() : null)
    ])
      .then(([tractsRes, assessmentsRes, findingsRes, reportsRes, trendRes]) => {
        setTracts(tractsRes.data || []);
        setAssessments(assessmentsRes || []);
        setFindings(findingsRes || []);
        setReports(reportsRes || []);
        setTrendData(trendRes);
      })
      .catch(err => console.error('[Dashboard Fetch Error]:', err))
      .finally(() => setLoading(false));
  }, [activeCounty, trendMetric, trendYears]);

  // SVI Tier Distribution
  const tiersCount = [0, 1, 2, 3, 4].map(tierIdx => tracts.filter(t => t.tier === tierIdx).length);
  const highNeedCount = tiersCount[3] + tiersCount[4];
  const inReviewAssessments = assessments.filter(a => a.status === 'In review').length;
  const inDraftAssessments = assessments.filter(a => a.status === 'Draft').length;

  // Program utilization data from database/county
  const programData = [
    { name: 'WIC Nutrition', key: 'wic', value: activeCounty?.prog?.wic || 74 },
    { name: 'Immunization', key: 'imm', value: activeCounty?.prog?.imm || 82 },
    { name: 'Diabetes Prevention (DPP)', key: 'dpp', value: activeCounty?.prog?.dpp || 46 },
    { name: 'Tobacco Cessation', key: 'tob', value: activeCounty?.prog?.tob || 38 },
    { name: 'Mobile Health Vans (MHV)', key: 'mhv', value: activeCounty?.prog?.mhv || 52 }
  ];

  // Combine real database activities (findings, reports, assessments)
  const activityItems = [
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
    .slice(0, 4);

  // Workflow steps counter
  const completedSteps = Object.keys(session?.workflowMilestones || {}).filter(
    k => session?.workflowMilestones?.[k]
  ).length;
  const nextStep = WORKFLOW_STEPS.find(s => !session?.workflowMilestones?.[s.id]);

  // Determine current active metric for the selected layer
  const activeMetric = activeLayer === 'disease' ? 'diabetes' : activeLayer === 'programs' ? 'utilization' : activeLayer === 'access' ? 'uninsured' : 'svi';

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-300">
      {/* Header with Title and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text)] tracking-tight">
            Community Health Dashboard
          </h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-0.5">
            Geographic health surveillance and vulnerability indicators for{' '}
            <span className="font-bold text-[var(--text)]">
              {activeCounty?.name || 'King County'}, {activeCounty?.stateAbbr || 'WA'}
            </span>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/assessments"
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[13px] font-bold text-[var(--text)] hover:bg-[var(--surface-2)] shadow-xs transition-all"
          >
            <ClipboardList className="w-4 h-4 text-[var(--violet)]" />
            <span>New Assessment</span>
          </Link>
          <Link
            href="/health-map"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--cyan)] hover:opacity-90 text-[13px] font-bold text-white shadow-md transition-all"
          >
            <MapPin className="w-4 h-4" />
            <span>Open Health Map</span>
          </Link>
        </div>
      </div>

      {/* 4-Metric Ruled KPI Strip (Matching Prototype) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-2xl glass-panel">
        <div className="p-3 border-r border-[var(--line)] last:border-r-0">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
            <Grid className="w-4 h-4 text-[var(--cyan)]" />
            <span>Census Tracts Analyzed</span>
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num">
            {tracts.length}
          </div>
          <div className="text-[11.5px] text-[var(--rose)] font-semibold mt-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--rose)] animate-pulse" />
            <span>{highNeedCount} high-need tracts in {activeCounty?.name}</span>
          </div>
        </div>

        <div className="p-3 border-r border-[var(--line)] last:border-r-0">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
            <MapPin className="w-4 h-4 text-[var(--teal)]" />
            <span>Geographic Coverage</span>
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num">
            3,142
          </div>
          <div className="text-[11.5px] text-[var(--faint)] mt-1">
            50 states and DC loaded
          </div>
        </div>

        <div className="p-3 border-r border-[var(--line)] last:border-r-0">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
            <Activity className="w-4 h-4 text-[var(--violet)]" />
            <span>Health Indicators</span>
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num">
            28
          </div>
          <div className="text-[11.5px] text-[var(--faint)] mt-1">
            Across 5 comprehensive layers
          </div>
        </div>

        <div className="p-3">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--muted)]">
            <ClipboardList className="w-4 h-4 text-[var(--amber)]" />
            <span>Active Assessments</span>
          </div>
          <div className="text-3xl font-display font-bold text-[var(--text)] mt-1.5 num">
            {assessments.length}
          </div>
          <div className="text-[11.5px] text-[var(--cyan)] font-semibold mt-1">
            {inReviewAssessments} in review, {inDraftAssessments} in draft
          </div>
        </div>
      </section>

      {/* Main Grid: Overview Map Card & Trends Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Community Health Map (Col 7) */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between min-h-[460px]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[var(--line)] gap-3">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Community Health Map</h3>
              <p className="text-[12px] text-[var(--muted)]">
                Census tracts in {activeCounty?.name || 'King County'}. Click a tract for details
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Hotspot Heatmap Switch */}
              <button
                onClick={() => setDashboardHeatmap(!dashboardHeatmap)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11.5px] font-bold border transition-all ${
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
                {['SDOH', 'Disease', 'Programs', 'Access'].map((l) => (
                  <button
                    key={l}
                    onClick={() => setActiveLayer(l.toLowerCase())}
                    className={`px-3 py-1.5 transition-colors ${
                      activeLayer === l.toLowerCase()
                        ? 'bg-[var(--cyan)] text-white shadow-xs'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* D3 Vector Map Canvas with Hotspots & Real Clipped Voronoi Tracts */}
          <div className="my-4 h-[350px] w-full rounded-xl overflow-hidden relative">
            <MapViewCanvas
              countyFips={activeCounty?._id || '53033'}
              tracts={tracts}
              heatmap={dashboardHeatmap}
              markers={true}
              layer={activeLayer}
              metric={activeMetric}
              height={350}
              onSelectTract={(t) => setSelectedTract(t)}
            />

            {/* Top-Right Floating Status Pill */}
            <div className="absolute top-3 right-3 max-w-[240px] p-2.5 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-lg text-[12px]">
              {selectedTract ? (
                <div>
                  <div className="font-bold text-[var(--text)]">{selectedTract.name}</div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    {TIER_LABELS[selectedTract.tier]} Vulnerability • {(selectedTract.population || 0).toLocaleString()} residents
                  </div>
                  <Link
                    href={`/census-tracts?tract=${selectedTract._id}`}
                    className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--cyan)] text-white text-[10.5px] font-bold hover:opacity-90 shadow-xs"
                  >
                    <span>Open in tract explorer</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              ) : (
                <div>
                  <div className="font-bold text-[var(--text)] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--rose)]" />
                    <span>{highNeedCount} high vulnerability tracts</span>
                  </div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    Highlighted with pulsing markers & heatmap
                  </div>
                </div>
              )}
            </div>

            {/* Bottom-Left Floating Legend */}
            <div className="absolute bottom-3 left-3 px-3 py-2 rounded-xl bg-[var(--surface-solid)]/95 backdrop-blur-md border border-[var(--line-strong)] shadow-lg text-[11px]">
              <div className="font-bold text-[var(--text)] capitalize">
                {METRICS_CONFIG[activeMetric]?.short || activeMetric} (Tracts)
              </div>
              <div className="flex items-center gap-1 mt-1">
                {['#B5E3F2', '#66B6F5', '#2584EB', '#1A55B8', '#123A7D'].map((c, i) => (
                  <span key={i} className="w-5 h-2 rounded-xs" style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex items-center justify-between text-[9.5px] text-[var(--faint)] mt-1">
                <span>Low</span>
                <span>Quantile</span>
                <span>High Need</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[var(--line)] text-[12px]">
            <span className="text-[var(--muted)]">
              All {tracts.length} census tracts loaded directly from database
            </span>
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

        {/* Right: Surveillance Trends (Col 5) */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Health Indicator Trends</h3>
              <p className="text-[12px] text-[var(--muted)]">
                {trendYears} Years surveillance • {activeCounty?.name} against {activeCounty?.stateName}
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

          {/* Trend Multi-Line Chart with Live Database Series */}
          <div className="my-6">
            <div className="flex items-center gap-4 text-[12px] mb-3">
              <div className="flex items-center gap-1.5 font-bold text-[var(--text)]">
                <span className="w-3 h-3 rounded-full bg-[var(--cyan)]" />
                <span>{activeCounty?.name}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[var(--muted)] font-semibold">
                <span className="w-3 h-3 rounded-full bg-[var(--teal)]" />
                <span>{activeCounty?.stateName} average</span>
              </div>
            </div>

            {trendData?.series ? (
              <div className="space-y-4">
                {trendData.series.map((s: any) => (
                  <div key={s.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="font-semibold text-[var(--text)] flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                      <span className="font-bold text-[var(--text)] num">
                        {s.values[s.values.length - 1]}%
                      </span>
                    </div>
                    <div className="h-3.5 w-full bg-[var(--surface-2)] rounded-full overflow-hidden p-0.5">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(100, (s.values[s.values.length - 1] / 35) * 100)}%`,
                          backgroundColor: s.color
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-[12px] text-[var(--muted)]">
                Loading database trend surveillance...
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between text-[12px] text-[var(--muted)]">
            <span>Source: CDC BRFSS & Census ACS</span>
            <Link href="/health-disparities" className="text-[var(--cyan)] font-bold hover:underline flex items-center gap-1">
              <span>Disparity analysis</span>
              <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </section>
      </div>

      {/* Ruled 3-Card Bottom Row: Vulnerability Donut, Program Bars, Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Community Vulnerability Tiers */}
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
                  const strokeLen = pct * 282.7; // circumference = 2 * pi * 45 ≈ 282.7
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

        {/* Card 3: Recent Activity & Workflow Progress */}
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

          {/* Activity Feed from Database */}
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

          {/* Workflow Next Step Action */}
          <div className="pt-3 border-t border-[var(--line)]">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-bold text-[var(--muted)]">
                Workflow: {completedSteps} / 10 steps
              </span>
              <button
                onClick={() => setWorkflowDrawerOpen(true)}
                className="text-[11px] font-bold text-[var(--cyan)] hover:underline"
              >
                Open Checklist
              </button>
            </div>
            {nextStep && (
              <div className="mt-2 p-2 rounded-xl bg-[var(--cyan)]/10 border border-[var(--cyan)]/30 flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-bold text-[var(--text)] truncate">
                  Next: {nextStep.title}
                </span>
                <Link
                  href={nextStep.route}
                  className="px-2.5 py-1 rounded-lg bg-[var(--cyan)] text-white text-[10.5px] font-bold hover:opacity-90 flex-shrink-0"
                >
                  Go
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
