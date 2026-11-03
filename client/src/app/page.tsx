'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Assessment, Finding, Report } from '@/types';
import { TIER_LABELS, TIER_COLORS, METRICS_CONFIG, MAP_LAYERS, WORKFLOW_STEPS } from '@/config/metrics';
import Link from 'next/link';
import { Icon } from '@/components/Icons';
import { MapViewCanvas, getMetricVal } from '@/components/MapViewCanvas';
import { DashboardCoverageMap } from '@/components/DashboardCoverageMap';

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

const ASSESSMENT_PIPELINE = [
  { step: 1, name: 'Scope & Jurisdiction', icon: 'map' },
  { step: 2, name: 'Indicator Prioritization', icon: 'sliders' },
  { step: 3, name: 'Disparity Analysis', icon: 'scale' },
  { step: 4, name: 'Needs Tagging', icon: 'flag' },
  { step: 5, name: 'Report & Presentation', icon: 'file' }
];

const REGION_COVERAGE = [
  { name: 'Midwest', cov: 96.2, counties: 1055, color: '#2584EB' },
  { name: 'Northeast', cov: 98.4, counties: 217, color: '#66B6F5' },
  { name: 'South', cov: 94.8, counties: 1424, color: '#37C8CF' },
  { name: 'West', cov: 97.1, counties: 446, color: '#9FE3E7' }
];

const RECENT_DATA_IMPORTS = [
  {
    id: 'IMP-3391',
    name: 'ACS 5-year tract estimates',
    src: 'Census Bureau API',
    rows: '2,841,203 rows',
    status: 'Completed',
    when: '2026-10-27 06:12'
  },
  {
    id: 'IMP-3388',
    name: 'Chronic disease prevalence (tract)',
    src: 'File upload',
    rows: '72,337 rows',
    status: 'Warnings',
    when: '2026-10-25 15:40'
  },
  {
    id: 'IMP-3384',
    name: 'Program enrollment extract',
    src: 'State program registry',
    rows: '18,422 rows',
    status: 'Failed',
    when: '2026-10-24 09:03'
  },
  {
    id: 'IMP-3379',
    name: 'TIGER/Line tract geometries',
    src: 'Census Bureau',
    rows: '85,187 rows',
    status: 'Completed',
    when: '2026-10-20 02:00'
  }
];

export default function DashboardPage() {
  const { activeCounty, session, trendYears, markWorkflowMilestone } = useSession();

  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [trendMetric, setTrendMetric] = useState<string>('diabetes');
  const [trendsData, setTrendsData] = useState<any>(null);
  const [importsData, setImportsData] = useState<any[]>(RECENT_DATA_IMPORTS);
  const [activeLayer, setActiveLayer] = useState<'sdoh' | 'disease' | 'program' | 'access'>('sdoh');
  const [dashboardHeatmap, setDashboardHeatmap] = useState<boolean>(false);
  const [selectedTract, setSelectedTract] = useState<CensusTract | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch real data imports from backend if available
  useEffect(() => {
    fetch('/api/data/imports')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data) && data.length > 0) {
          setImportsData(data.slice(0, 4));
        }
      })
      .catch(() => {});
  }, []);

  // Fetch trend line data for active jurisdiction
  useEffect(() => {
    if (!activeCounty?._id) return;
    fetch(`/api/analytics/trends?metric=${trendMetric}&county=${activeCounty._id}&range=10`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setTrendsData(data);
      })
      .catch(() => {});
  }, [activeCounty?._id, trendMetric, trendYears]);

  // Fetch core analytics data for active jurisdiction
  useEffect(() => {
    if (!activeCounty?._id) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/tracts?county=${activeCounty._id}`).then((r) => (r.ok ? r.json() : { data: [] })),
      fetch(`/api/assessments?jurisdiction=${activeCounty._id}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/findings?jurisdiction=${activeCounty._id}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/reports?jurisdiction=${activeCounty._id}`).then((r) => (r.ok ? r.json() : []))
    ])
      .then(([tRes, aRes, fRes, rRes]) => {
        const rawTracts = Array.isArray(tRes) ? tRes : tRes.data || [];
        setTracts(rawTracts);
        setAssessments(Array.isArray(aRes) ? aRes : []);
        setFindings(Array.isArray(fRes) ? fRes : []);
        setReports(Array.isArray(rRes) ? rRes : []);
        markWorkflowMilestone('dash');
      })
      .catch((err) => {
        console.error('Failed to load dashboard data', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [activeCounty?._id, markWorkflowMilestone]);

  // Group tracts into 5 vulnerability tiers
  const tierDistribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    tracts.forEach((t) => {
      const tier = t.tier !== undefined ? t.tier : Math.min(4, Math.floor((t.svi || 0) * 5));
      counts[tier] = (counts[tier] || 0) + 1;
    });
    return counts;
  }, [tracts]);

  const highNeedCount = tierDistribution[3] + tierDistribution[4];
  const activeAssessments = assessments.filter((a) => a.status !== 'Completed');
  const inReviewCount = assessments.filter((a) => a.status === 'In review').length;
  const inDraftCount = assessments.filter((a) => a.status === 'Draft').length;

  const countyName = activeCounty?.name || 'King County';
  const stateName = activeCounty?.stateName || activeCounty?.stateAbbr || 'Washington';

  // Compute tier averages for the Disparity Table
  const tierAverages = useMemo(() => {
    return [4, 3, 2, 1, 0].map((tierIdx) => {
      const tierTracts = tracts.filter((t) => {
        const tier = t.tier !== undefined ? t.tier : Math.min(4, Math.floor((t.svi || 0) * 5));
        return tier === tierIdx;
      });

      const count = tierTracts.length;
      const pop = tierTracts.reduce((sum, t) => sum + (t.population || 0), 0);
      const diabetes =
        count > 0 ? tierTracts.reduce((sum, t) => sum + (getMetricVal(t, 'diabetes') || 0), 0) / count : 12.0 + tierIdx * 1.5;
      const uninsured =
        count > 0 ? tierTracts.reduce((sum, t) => sum + (getMetricVal(t, 'uninsured') || 0), 0) / count : 5.0 + tierIdx * 2.2;
      const lifeExp =
        count > 0
          ? tierTracts.reduce((sum, t) => sum + (t.indicators?.lifeExpectancy || 78.5 - tierIdx * 1.4), 0) / count
          : 81.2 - tierIdx * 1.4;

      return {
        tierIdx,
        label: TIER_LABELS[tierIdx],
        color: TIER_COLORS[tierIdx],
        count,
        pop,
        diabetes,
        uninsured,
        lifeExp
      };
    });
  }, [tracts]);

  // Program utilization items
  const programs = [
    { name: 'WIC Nutrition', rate: 71, target: 80, enrolled: '3,410' },
    { name: 'Immunizations', rate: 84, target: 90, enrolled: '8,920' },
    { name: 'Diabetes Prevention', rate: 58, target: 70, enrolled: '1,240' },
    { name: 'Tobacco Cessation', rate: 42, target: 60, enrolled: '890' },
    { name: 'Maternal Health', rate: 79, target: 85, enrolled: '2,150' }
  ];

  return (
    <>
      {/* Page Header */}
      <div className="page-head">
        <div>
          <h1>Community Health Dashboard</h1>
          <p>Geographic health insights for smarter public health decisions.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot"></span>Demo environment
          </span>
          <Link href="/assessments?new=1" className="btn">
            <Icon name="plus" size={14} />
            <span>New assessment</span>
          </Link>
          <Link href="/health-map" className="btn primary">
            <Icon name="map" size={14} />
            <span>Open health map</span>
          </Link>
        </div>
      </div>

      {/* KPI Strip */}
      <section className="strip">
        <div className="strip-i">
          <span className="m-ico">
            <Icon name="grid" size={20} />
          </span>
          <div className="strip-l">Census tracts analyzed</div>
          <div className="strip-v">
            <span className="num">{tracts.length || 398}</span>
          </div>
          <div className="strip-f">
            <span className="up-ok">{highNeedCount || 86}</span> high-need tracts in {countyName}
          </div>
        </div>

        <div className="strip-i">
          <span className="m-ico t">
            <Icon name="map" size={20} />
          </span>
          <div className="strip-l">Geographic coverage</div>
          <div className="strip-v">
            <span className="num">3,142</span>
            <small> counties</small>
          </div>
          <div className="strip-f">50 states and DC loaded</div>
        </div>

        <div className="strip-i">
          <span className="m-ico">
            <Icon name="activity" size={20} />
          </span>
          <div className="strip-l">Health indicators</div>
          <div className="strip-v">
            <span className="num">24</span>
          </div>
          <div className="strip-f">Across 5 map layers</div>
        </div>

        <div className="strip-i">
          <span className="m-ico t">
            <Icon name="clipboard" size={20} />
          </span>
          <div className="strip-l">Active assessments</div>
          <div className="strip-v">
            <span className="num">{activeAssessments.length || 3}</span>
          </div>
          <div className="strip-f">
            {inReviewCount || 2} in review, {inDraftCount || 1} in draft
          </div>
        </div>
      </section>

      {/* Main Dashboard Grid */}
      <div className="dgrid">
        {/* Panel 1: Community Health Map */}
        <section className="panel d-c7" style={{ gridColumn: 'span 7' }}>
          <div className="panel-h">
            <div>
              <h3>Community Health Map</h3>
              <div className="sub">
                Census tracts in {countyName}, {activeCounty?.stateAbbr || 'WA'}. Click a tract for details
              </div>
            </div>
            <div className="seg" id="d-layer">
              <button
                className={activeLayer === 'sdoh' ? 'on' : ''}
                onClick={() => setActiveLayer('sdoh')}
              >
                SDOH
              </button>
              <button
                className={activeLayer === 'disease' ? 'on' : ''}
                onClick={() => setActiveLayer('disease')}
              >
                Disease
              </button>
              <button
                className={activeLayer === 'program' ? 'on' : ''}
                onClick={() => setActiveLayer('program')}
              >
                Programs
              </button>
              <button
                className={activeLayer === 'access' ? 'on' : ''}
                onClick={() => setActiveLayer('access')}
              >
                Access
              </button>
            </div>
          </div>

          <div style={{ position: 'relative', height: '400px', borderRadius: '14px', overflow: 'hidden' }}>
            <div id="d-map" style={{ position: 'absolute', inset: 0 }}>
              <MapViewCanvas
                metric={
                  activeLayer === 'sdoh'
                    ? 'svi'
                    : activeLayer === 'disease'
                    ? 'diabetes'
                    : activeLayer === 'program'
                    ? 'utilization'
                    : 'uninsured'
                }
                countyFips={activeCounty?._id || '53033'}
                onSelectTract={(t: any) => setSelectedTract(t)}
                selectedTractId={selectedTract?._id}
              />
            </div>

            {/* Bottom-left Legend */}
            <div
              className="map-float legend"
              style={{
                position: 'absolute',
                left: '12px',
                bottom: '12px',
                minWidth: '200px',
                zIndex: 10
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', marginBottom: '4px' }}>
                {activeLayer.toUpperCase()} Index (Tract Level)
              </div>
              <div
                style={{
                  height: '8px',
                  borderRadius: '4px',
                  background: 'linear-gradient(90deg, #E4ECFA, #2584EB, #123A7D)'
                }}
              />
              <div
                className="ends"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '3px',
                  fontSize: '10.5px',
                  color: 'var(--faint)'
                }}
              >
                <span>Lower need</span>
                <span>Higher need</span>
              </div>
            </div>

            {/* Top-right Callout */}
            <div
              className="map-float"
              style={{
                position: 'absolute',
                right: '12px',
                top: '12px',
                padding: '10px 12px',
                fontSize: '12px',
                maxWidth: '220px',
                zIndex: 10
              }}
              id="d-sel"
            >
              {selectedTract ? (
                <div>
                  <b style={{ display: 'block', fontSize: '13px' }}>{selectedTract.name}</b>
                  <div className="note" style={{ color: 'var(--muted)', fontSize: '11.5px', margin: '3px 0 6px' }}>
                    {TIER_LABELS[selectedTract.tier]} vulnerability. {(selectedTract.population || 0).toLocaleString()} residents
                  </div>
                  <Link
                    href={`/census-tracts?county=${activeCounty?._id}&tract=${selectedTract._id}`}
                    className="btn sm primary"
                    style={{ fontSize: '11px', padding: '3px 8px', height: 'auto' }}
                  >
                    Open in tract explorer
                  </Link>
                </div>
              ) : (
                <div>
                  <b style={{ display: 'block', fontSize: '12.5px' }}>{highNeedCount || 86} high vulnerability tracts</b>
                  <div className="note" style={{ color: 'var(--muted)', fontSize: '11.5px', marginTop: '2px' }}>
                    Highlighted with markers
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Panel 2: Health Indicator Trends */}
        <section className="panel d-c5" style={{ gridColumn: 'span 5' }}>
          <div className="panel-h">
            <div>
              <h3>Health Indicator Trends</h3>
              <div className="sub">
                2016 – 2025. {countyName} against {stateName}
              </div>
            </div>
            <select
              className="input"
              id="d-tk"
              style={{ height: '34px', width: 'auto', borderRadius: '8px', padding: '0 8px', fontSize: '12px' }}
              value={trendMetric}
              onChange={(e) => setTrendMetric(e.target.value)}
              aria-label="Indicator"
            >
              <option value="diabetes">Diabetes</option>
              <option value="hypertension">Hypertension</option>
              <option value="uninsured">Uninsured</option>
              <option value="asthma">Asthma</option>
              <option value="obesity">Obesity</option>
            </select>
          </div>

          <div className="legend-row" style={{ margin: '0 0 10px', display: 'flex', gap: '16px', fontSize: '12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i style={{ width: '8px', height: '8px', background: 'var(--cyan)', borderRadius: '50%', display: 'inline-block' }} />
              {countyName}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i style={{ width: '8px', height: '8px', background: 'var(--teal)', borderRadius: '50%', display: 'inline-block' }} />
              {stateName} average
            </span>
          </div>

          {/* Inline SVG Multi-Series Trend Line Chart matching prototype */}
          <div id="d-trend" style={{ height: '330px', position: 'relative' }}>
            <svg viewBox="0 0 440 280" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0090C2" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#0090C2" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Y Grid lines */}
              {[40, 100, 160, 220].map((y, i) => (
                <g key={y}>
                  <line x1="36" y1={y} x2="420" y2={y} stroke="var(--line)" strokeDasharray="3 3" />
                  <text x="30" y={y + 4} textAnchor="end" fontSize="10.5" fill="var(--faint)" fontFamily="var(--font-u)">
                    {[16, 12, 8, 4][i]}%
                  </text>
                </g>
              ))}

              {/* X Axis years */}
              {[2016, 2018, 2020, 2022, 2024, 2025].map((year, i) => (
                <text
                  key={year}
                  x={50 + i * 70}
                  y="250"
                  textAnchor="middle"
                  fontSize="10.5"
                  fill="var(--muted)"
                  fontFamily="var(--font-u)"
                >
                  {year}
                </text>
              ))}

              {/* State baseline trendline (Teal dashed) */}
              <path
                d="M 50 170 Q 120 165, 190 155 T 330 148 T 400 142"
                fill="none"
                stroke="var(--teal)"
                strokeWidth="2.2"
                strokeDasharray="4 4"
              />

              {/* County Area Fill */}
              <path
                d="M 50 145 Q 120 135, 190 120 T 330 105 T 400 95 L 400 230 L 50 230 Z"
                fill="url(#area-grad)"
              />

              {/* County Trendline (Cyan Solid) */}
              <path
                d="M 50 145 Q 120 135, 190 120 T 330 105 T 400 95"
                fill="none"
                stroke="var(--cyan)"
                strokeWidth="2.8"
                strokeLinecap="round"
              />

              {/* Key Data Point Dots */}
              {[
                { cx: 50, cy: 145, v: '9.2%' },
                { cx: 190, cy: 120, v: '11.0%' },
                { cx: 330, cy: 105, v: '12.4%' },
                { cx: 400, cy: 95, v: '13.1%' }
              ].map((pt, i) => (
                <g key={i}>
                  <circle cx={pt.cx} cy={pt.cy} r="4.5" fill="#fff" stroke="var(--cyan)" strokeWidth="2.5" />
                  <text
                    x={pt.cx}
                    y={pt.cy - 10}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="var(--text)"
                    fontFamily="var(--font-u)"
                  >
                    {pt.v}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </section>

        {/* Panel 3: Community Vulnerability Tier Distribution */}
        <section className="panel d-c4" style={{ gridColumn: 'span 4' }}>
          <div className="panel-h">
            <div>
              <h3>Community Vulnerability</h3>
              <div className="sub">Tracts by vulnerability tier</div>
            </div>
            <Link href="/census-tracts" className="btn sm ghost">
              View all <Icon name="chevr" size={12} />
            </Link>
          </div>

          <div className="row" style={{ flexWrap: 'nowrap', gap: '18px', alignItems: 'center', minHeight: '190px' }}>
            {/* SVG Donut Chart */}
            <div id="d-donut" style={{ width: '160px', height: '160px', flex: 'none', position: 'relative' }}>
              <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                {(() => {
                  const total = tracts.length || 398;
                  let cumulative = 0;
                  const c = 2 * Math.PI * 34; // r=34

                  return [4, 3, 2, 1, 0].map((tIdx) => {
                    const cnt = tierDistribution[tIdx] || [36, 50, 110, 122, 80][tIdx];
                    const frac = cnt / total;
                    const strokeLen = frac * c;
                    const offset = c - cumulative;
                    cumulative += strokeLen;

                    return (
                      <circle
                        key={tIdx}
                        cx="50"
                        cy="50"
                        r="34"
                        fill="none"
                        stroke={TIER_COLORS[tIdx]}
                        strokeWidth="15"
                        strokeDasharray={`${strokeLen} ${c}`}
                        strokeDashoffset={-offset}
                      />
                    );
                  });
                })()}
              </svg>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none'
                }}
              >
                <span className="num" style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
                  {tracts.length || 398}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 600 }}>TRACTS</span>
              </div>
            </div>

            {/* Tier Legend */}
            <div className="dlegend" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[4, 3, 2, 1, 0].map((tIdx) => {
                const cnt = tierDistribution[tIdx] || [36, 50, 110, 122, 80][tIdx];
                const pct = Math.round((cnt / (tracts.length || 398)) * 100);

                return (
                  <div
                    key={tIdx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <i
                        style={{
                          width: '9px',
                          height: '9px',
                          background: TIER_COLORS[tIdx],
                          borderRadius: '2px',
                          display: 'inline-block'
                        }}
                      />
                      <span style={{ color: 'var(--text)' }}>{TIER_LABELS[tIdx]}</span>
                    </div>
                    <b className="num" style={{ color: 'var(--muted)' }}>
                      {pct}%
                    </b>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Panel 4: Program Utilization */}
        <section className="panel d-c4" style={{ gridColumn: 'span 4' }}>
          <div className="panel-h">
            <div>
              <h3>Program Utilization</h3>
              <div className="sub">Share of eligible residents enrolled</div>
            </div>
            <Link href="/program-utilization" className="btn sm ghost">
              Details <Icon name="chevr" size={12} />
            </Link>
          </div>

          <div id="d-prog" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
            {programs.map((p, i) => (
              <div key={i} style={{ fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</span>
                  <span className="num" style={{ fontWeight: 700, color: 'var(--cyan)' }}>
                    {p.rate}% <small style={{ color: 'var(--faint)', fontWeight: 400 }}>({p.enrolled})</small>
                  </span>
                </div>
                <div className="prog" style={{ height: '7px', background: 'var(--surface-2)', borderRadius: '4px', overflow: 'hidden' }}>
                  <i
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${p.rate}%`,
                      background: p.rate >= p.target ? 'var(--teal)' : 'var(--cyan)',
                      borderRadius: '4px'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Panel 5: Recent Assessment Activity */}
        <section className="panel d-c4" style={{ gridColumn: 'span 4' }}>
          <div className="panel-h">
            <div>
              <h3>Recent Assessment Activity</h3>
            </div>
            <Link href="/assessments" className="btn sm ghost">
              View all <Icon name="chevr" size={12} />
            </Link>
          </div>

          <div id="d-act" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(assessments.length > 0 ? assessments.slice(0, 3) : [
              { _id: '1', title: 'South County Health Disparities', status: 'In review', updatedAt: new Date().toISOString(), totalTracts: 42 },
              { _id: '2', title: 'Eastside Maternal & Child Health', status: 'Draft', updatedAt: new Date().toISOString(), totalTracts: 28 },
              { _id: '3', title: 'Downtown Chronic Disease Survey', status: 'Completed', updatedAt: new Date().toISOString(), totalTracts: 64 }
            ]).map((a: any) => (
              <Link
                key={a._id}
                href={`/assessments?id=${a._id}`}
                className="act"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'var(--surface-2)',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'background 0.2s'
                }}
              >
                <span
                  className="m-ico"
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: '#EAF4FF',
                    color: 'var(--cyan)',
                    display: 'grid',
                    placeItems: 'center',
                    flex: 'none'
                  }}
                >
                  <Icon name="clipboard" size={16} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.title}
                  </b>
                  <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                    {formatRelativeTime(a.updatedAt)} • {a.totalTracts || 35} tracts
                  </small>
                </div>
                <span
                  className={`pill ${a.status === 'Completed' ? 'ok' : a.status === 'In review' ? 'info' : 'warn'}`}
                  style={{ fontSize: '11px', flex: 'none' }}
                >
                  {a.status}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Panel 6: Health Disparity Analysis Table */}
        <section className="panel d-c7" style={{ gridColumn: 'span 7' }}>
          <div className="panel-h">
            <div>
              <h3>Health Disparity Analysis</h3>
              <div className="sub">Tract averages by vulnerability tier</div>
            </div>
            <Link href="/health-disparities" className="btn sm ghost">
              Open analysis <Icon name="chevr" size={12} />
            </Link>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Vulnerability tier</th>
                  <th className="r">Tracts</th>
                  <th className="r">Residents</th>
                  <th>Diabetes</th>
                  <th className="r">Uninsured</th>
                  <th className="r">Life exp.</th>
                </tr>
              </thead>
              <tbody>
                {tierAverages.map((t) => (
                  <tr key={t.tierIdx}>
                    <td>
                      <i
                        className="tier"
                        style={{
                          width: '9px',
                          height: '9px',
                          borderRadius: '50%',
                          display: 'inline-block',
                          background: t.color,
                          marginRight: '8px'
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>{t.label}</span>
                    </td>
                    <td className="r num">{t.count}</td>
                    <td className="r num">{(t.pop || 0).toLocaleString()}</td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap', gap: '10px', alignItems: 'center' }}>
                        <div className="prog" style={{ flex: 1, minWidth: '60px', height: '6px', background: 'var(--surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                          <i
                            style={{
                              display: 'block',
                              height: '100%',
                              width: `${Math.min(100, (t.diabetes / 18) * 100)}%`,
                              background: 'var(--cyan)'
                            }}
                          />
                        </div>
                        <span className="num" style={{ width: '42px', fontSize: '12px' }}>
                          {t.diabetes.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="r num">{t.uninsured.toFixed(1)}%</td>
                    <td className="r num">{t.lifeExp.toFixed(1)} yrs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel 7: Guided Analysis Workflow */}
        <section className="panel d-c5" style={{ gridColumn: 'span 5' }}>
          <div className="panel-h">
            <div>
              <h3>Guided Analysis</h3>
              <div className="sub">From map selection to exported report</div>
            </div>
            <span className="pill info" id="d-wfp">
              Active
            </span>
          </div>

          <div id="d-wf" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {WORKFLOW_STEPS.slice(0, 4).map((step, idx) => {
              const isDone = !!session?.workflowMilestones?.[step.id];

              return (
                <div
                  key={step.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    borderRadius: '10px',
                    background: isDone ? 'rgba(7, 154, 126, 0.08)' : 'var(--surface-2)',
                    fontSize: '12.5px'
                  }}
                >
                  <span
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      background: isDone ? 'var(--teal)' : 'var(--surface-solid)',
                      color: isDone ? '#fff' : 'var(--muted)',
                      border: isDone ? 'none' : '1px solid var(--line-strong)',
                      fontSize: '11px',
                      fontWeight: 700,
                      flex: 'none'
                    }}
                  >
                    {isDone ? '✓' : idx + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: '13px' }}>{step.title}</b>
                    <small style={{ color: 'var(--muted)', fontSize: '11px' }}>{step.desc}</small>
                  </div>
                  <Link href={step.route} className="btn sm ghost" style={{ padding: '2px 8px', height: '26px' }}>
                    Go
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        {/* Panel 8: Community Needs Assessment Pipeline Stepper */}
        <section className="panel" style={{ gridColumn: 'span 12' }}>
          <div className="panel-h">
            <div>
              <h3>Community Needs Assessment Progress</h3>
              <div className="sub">Assessments at each stage of the workflow</div>
            </div>
            <span className="pill ok">
              <span className="dot"></span>
              {assessments.length || 3} assessments
            </span>
          </div>

          <div className="pipe" style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', padding: '10px 0' }}>
            {ASSESSMENT_PIPELINE.map((st, i) => {
              const countAtStep = assessments.filter((a) => (a.status === 'Completed' ? 5 : a.step || 1) === st.step).length;

              return (
                <React.Fragment key={st.step}>
                  {i > 0 && (
                    <span
                      className="pipe-a"
                      style={{
                        width: '18px',
                        height: '2px',
                        background: 'var(--line-strong)',
                        flex: 'none'
                      }}
                    />
                  )}
                  <Link
                    href="/assessments"
                    className="pipe-s"
                    style={{
                      flex: 1,
                      minWidth: '160px',
                      padding: '14px',
                      borderRadius: '12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <span
                      className={`m-ico ${i % 2 === 1 ? 't' : ''}`}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        display: 'grid',
                        placeItems: 'center',
                        background: '#EAF4FF',
                        color: 'var(--cyan)'
                      }}
                    >
                      <Icon name={st.icon} size={16} />
                    </span>
                    <b style={{ fontSize: '13px', marginTop: '6px' }}>{st.name}</b>
                    <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                      {countAtStep} {st.step === 5 ? 'completed' : 'active'}
                    </small>
                  </Link>
                </React.Fragment>
              );
            })}
          </div>
        </section>

        {/* Panel 9: Geographic Coverage */}
        <section className="panel d-c7" style={{ gridColumn: 'span 7' }}>
          <div className="panel-h">
            <div>
              <h3>Geographic Coverage</h3>
              <div className="sub">Share of tracts with complete indicator data, by state</div>
            </div>
            <Link href="/data-management" className="btn sm ghost">
              Data quality <Icon name="chevr" size={12} />
            </Link>
          </div>

          <div className="row" style={{ flexWrap: 'nowrap', gap: '20px', alignItems: 'center' }}>
            <div id="d-cov" style={{ flex: 1.6, minWidth: 0, height: '240px', position: 'relative' }}>
              <DashboardCoverageMap />
            </div>
            <div style={{ flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {REGION_COVERAGE.map((r, i) => (
                <div
                  key={i}
                  className="reg-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12.5px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i
                      style={{
                        width: '8px',
                        height: '8px',
                        background: r.color,
                        borderRadius: '50%',
                        display: 'inline-block'
                      }}
                    />
                    <span>{r.name}</span>
                  </div>
                  <span className="r num" style={{ fontWeight: 700, color: 'var(--text)' }}>
                    {r.cov}% <small style={{ color: 'var(--muted)', fontWeight: 400 }}>({r.counties} counties)</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Panel 10: Recent Data Updates */}
        <section className="panel d-c5" style={{ gridColumn: 'span 5' }}>
          <div className="panel-h">
            <div>
              <h3>Recent Data Updates</h3>
            </div>
            <Link href="/data-management" className="btn sm ghost">
              View all <Icon name="chevr" size={12} />
            </Link>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {importsData.map((r) => (
              <div
                key={r.id || r._id}
                className="act"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'var(--surface-2)'
                }}
              >
                <span
                  className={`m-ico ${r.status === 'Failed' ? '' : 't'}`}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: r.status === 'Failed' ? '#FDECEE' : '#EAF4FF',
                    color: r.status === 'Failed' ? 'var(--rose)' : 'var(--cyan)',
                    display: 'grid',
                    placeItems: 'center',
                    flex: 'none'
                  }}
                >
                  <Icon
                    name={r.src?.includes('Census') ? 'cloud' : r.src?.includes('upload') ? 'upload' : 'server'}
                    size={16}
                  />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name}
                  </b>
                  <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                    {r.src}. {r.when || r.createdAt}
                  </small>
                </div>
                <span
                  className={`pill ${
                    r.status === 'Completed' ? 'ok' : r.status === 'Failed' ? 'bad' : 'warn'
                  }`}
                  style={{ fontSize: '11px', flex: 'none' }}
                >
                  {r.status === 'Completed with warnings' ? 'Warnings' : r.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
