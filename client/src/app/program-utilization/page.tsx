'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Assessment } from '@/types';
import { TIER_COLORS, TIER_LABELS } from '@/config/metrics';
import {
  Users,
  ClipboardList,
  Download,
  Search,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Sparkles,
  Sliders,
  Plus,
  X,
  Check,
  AlertCircle
} from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icons';
import { useRouter } from 'next/navigation';
import { BivariateMap } from '@/components/BivariateMap';
import { DonutChart } from '@/components/DonutChart';
import { TrendLineChart, TrendSeries } from '@/components/TrendLineChart';
import { GroupedBarChart } from '@/components/GroupedBarChart';
import { STATE_META } from '@/utils/countyRepository';

interface ProgramConfig {
  key: string;
  name: string;
  short: string;
  eligibilityFactor: number;
  color: string;
}

const PROGRAMS: Record<string, ProgramConfig> = {
  wic: {
    key: 'wic',
    name: 'WIC nutrition',
    short: 'WIC',
    eligibilityFactor: 0.07,
    color: '#37C8CF'
  },
  imm: {
    key: 'imm',
    name: 'Childhood immunization',
    short: 'Immunization',
    eligibilityFactor: 0.05,
    color: '#8B5CF6'
  },
  dpp: {
    key: 'dpp',
    name: 'Diabetes prevention',
    short: 'DPP',
    eligibilityFactor: 0.09,
    color: '#10B981'
  },
  tob: {
    key: 'tob',
    name: 'Tobacco cessation',
    short: 'Tobacco',
    eligibilityFactor: 0.12,
    color: '#F43F5E'
  },
  mhv: {
    key: 'mhv',
    name: 'Maternal home visiting',
    short: 'Home visiting',
    eligibilityFactor: 0.02,
    color: '#F59E0B'
  }
};

const YEARS = ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];

function ProgramUtilizationContent() {
  const router = useRouter();
  const { activeCounty, markWorkflowMilestone } = useSession();

  const [activeProg, setActiveProg] = useState<string>('all');
  const [fte, setFte] = useState<number>(6);
  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedTractId, setSelectedTractId] = useState<string | null>(null);

  const selectedProgram = activeProg;
  const setSelectedProgram = setActiveProg;
  const fteSlider = fte;
  const setFteSlider = setFte;


  // Finding Modal state
  const [findingModalOpen, setFindingModalOpen] = useState(false);
  const [findingTract, setFindingTract] = useState<CensusTract | null>(null);
  const [findingNote, setFindingNote] = useState('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('');
  const targetAssessmentId = selectedAssessmentId;
  const setTargetAssessmentId = setSelectedAssessmentId;
  const [assessmentsList, setAssessmentsList] = useState<Assessment[]>([]);
  const [submittingFinding, setSubmittingFinding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const countyFips = activeCounty?._id || '53033';
  const countyName = activeCounty?.name || 'Jurisdiction';
  const stateAbbr = activeCounty?.stateAbbr || 'WA';
  const stateName = activeCounty?.stateName || 'Washington';

  // Mark workflow milestone
  useEffect(() => {
    markWorkflowMilestone('layer');
  }, [markWorkflowMilestone]);

  // Load tracts for active county
  useEffect(() => {
    setLoading(true);
    fetch(`/api/tracts?county=${countyFips}`)
      .then(res => (res.ok ? res.json() : { data: [] }))
      .then(json => {
        const data: CensusTract[] = json.data || [];
        setTracts(data);
        if (data.length > 0 && !selectedTractId) {
          setSelectedTractId(data[0]._id);
        }
      })
      .catch(err => console.error('Failed to load tracts:', err))
      .finally(() => setLoading(false));
  }, [countyFips]);

  // Load assessments for modal dropdown filtered by active county
  useEffect(() => {
    fetch(`/api/assessments?jurisdiction=${countyFips}`)
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        setAssessmentsList(data);
        if (data.length > 0) {
          setSelectedAssessmentId(data[0]._id);
        } else {
          setSelectedAssessmentId('');
        }
      })
      .catch(e => console.error(e));
  }, [countyFips]);

  // Helper to extract utilization for a tract
  const getUtil = (t: CensusTract, progKey: string): number => {
    if (progKey === 'all') {
      const p = t.prog;
      if (!p) return 48;
      const vals = Object.values(p);
      return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    }
    const val = t.prog ? (t.prog as any)[progKey] : (t.indicators as any)?.[`prog.${progKey}`];
    return typeof val === 'number' ? val : 50;
  };

  // Gap score formula: SVI * (100 - utilization)
  const calcGapScore = (t: CensusTract, progKey: string): number => {
    const u = getUtil(t, progKey);
    return t.svi * (100 - u);
  };

  // KPI Calculations
  const kpis = useMemo(() => {
    if (tracts.length === 0) {
      return {
        enrolled: 0,
        eligible: 0,
        utilRate: 0,
        gapCount: 0,
        stateMedian: 52
      };
    }

    const totalPop = tracts.reduce((acc, t) => acc + (t.population || 4000), 0);
    const eligFactor = activeProg === 'all' ? 0.24 : PROGRAMS[activeProg]?.eligibilityFactor || 0.08;
    const eligible = Math.round(totalPop * eligFactor);

    // Weighted mean utilization
    const weightedUtilSum = tracts.reduce((acc, t) => {
      const u = getUtil(t, activeProg);
      return acc + u * (t.population || 4000);
    }, 0);
    const utilRate = totalPop > 0 ? weightedUtilSum / totalPop : 0;
    const enrolled = Math.round((eligible * utilRate) / 100);

    // Quantile thresholds for coverage gap tracts: high SVI (top tertile) and low util (bottom tertile)
    const utils = tracts.map(t => getUtil(t, activeProg)).sort((a, b) => a - b);
    const svis = tracts.map(t => t.svi).sort((a, b) => a - b);

    const lowUtilThreshold = utils[Math.floor(utils.length / 3)] ?? 45;
    const highSviThreshold = svis[Math.floor((svis.length * 2) / 3)] ?? 0.65;

    const gapCount = tracts.filter(t => t.svi >= highSviThreshold && getUtil(t, activeProg) <= lowUtilThreshold).length;

    // Benchmark state median
    const stateMedian = activeProg === 'all' ? 54.2 : 51.8;

    return {
      enrolled,
      eligible,
      utilRate,
      gapCount,
      stateMedian
    };
  }, [tracts, activeProg]);

  // Largest Coverage Gaps (Ranked top 7)
  const topGaps = useMemo(() => {
    if (tracts.length === 0) return [];
    return [...tracts]
      .sort((a, b) => calcGapScore(b, activeProg) - calcGapScore(a, activeProg))
      .slice(0, 7)
      .map(t => {
        const gap = calcGapScore(t, activeProg);
        const util = getUtil(t, activeProg);
        return {
          tract: t,
          gapScore: gap,
          util,
          svi: t.svi,
          tier: t.tier ?? 2
        };
      });
  }, [tracts, activeProg]);

  const maxGap = topGaps[0]?.gapScore || 1;

  // Resource Allocation Simulation (FTE staffing model with diminishing returns)
  const allocRows = useMemo(() => {
    if (tracts.length === 0) return [];
    const top6 = [...tracts]
      .sort((a, b) => calcGapScore(b, activeProg) - calcGapScore(a, activeProg))
      .slice(0, 6);

    const totGap = top6.reduce((acc, t) => acc + calcGapScore(t, activeProg), 0) || 1;

    return top6.map(t => {
      const baseUtil = getUtil(t, activeProg);
      const gap = calcGapScore(t, activeProg);
      const share = (fte * gap) / totGap;
      const gain = (100 - baseUtil) * (1 - Math.exp(-share * 0.22));
      return {
        tract: t,
        share,
        baseUtil,
        gain,
        projectedUtil: Math.min(100, baseUtil + gain)
      };
    });
  }, [tracts, activeProg, fte]);

  // 10-Year Participation Longitudinal Trend Series (2016–2025)
  const participationTrendSeries: TrendSeries[] = useMemo(() => {
    const baseCountyRate = kpis.utilRate || 52;
    const baseStateRate = kpis.stateMedian || 50;

    // Deterministic trend trajectories
    const countyValues = YEARS.map((_, i) => {
      const progress = (i / 9) * 4.2;
      return Math.min(100, Math.max(10, baseCountyRate - 4.5 + progress + Math.sin(i * 0.8) * 0.9));
    });

    const stateValues = YEARS.map((_, i) => {
      const progress = (i / 9) * 2.8;
      return Math.min(100, Math.max(10, baseStateRate - 3.2 + progress + Math.cos(i * 0.7) * 0.7));
    });

    return [
      {
        name: `${countyName} County`,
        color: '#37C8CF',
        values: countyValues
      },
      {
        name: `${stateName} Average`,
        color: '#8B5CF6',
        values: stateValues
      }
    ];
  }, [kpis, countyName, stateName]);

  // Service Distribution Donut Chart Data
  const serviceDistributionData = useMemo(() => {
    if (tracts.length === 0) return [];
    const totalPop = tracts.reduce((acc, t) => acc + (t.population || 4000), 0);

    return Object.entries(PROGRAMS).map(([k, meta]) => {
      const weightedUtil =
        tracts.reduce((acc, t) => acc + getUtil(t, k) * (t.population || 4000), 0) / (totalPop || 1);
      const elig = totalPop * meta.eligibilityFactor;
      const enrolled = Math.round((elig * weightedUtil) / 100);

      return {
        label: meta.name,
        value: enrolled,
        color: meta.color
      };
    });
  }, [tracts]);

  const totalEnrolledAcrossPrograms = useMemo(() => {
    return serviceDistributionData.reduce((acc, d) => acc + d.value, 0);
  }, [serviceDistributionData]);

  // Program Benchmark Comparison Grouped Bar Chart (Active County vs State vs National)
  const benchmarkCategories = useMemo(() => {
    return Object.values(PROGRAMS).map(p => p.short);
  }, []);

  const benchmarkSeries = useMemo(() => {
    const countyValues = Object.keys(PROGRAMS).map(k => {
      if (tracts.length === 0) return 50;
      const totalPop = tracts.reduce((acc, t) => acc + (t.population || 4000), 0);
      return Math.round(
        tracts.reduce((acc, t) => acc + getUtil(t, k) * (t.population || 4000), 0) / (totalPop || 1)
      );
    });

    // Realistic state & national benchmarks
    const stateValues = [56, 72, 44, 38, 62];
    const nationalValues = [52, 68, 41, 35, 58];

    return [
      {
        name: countyName,
        color: '#37C8CF',
        values: countyValues
      },
      {
        name: stateAbbr,
        color: '#8B5CF6',
        values: stateValues
      },
      {
        name: 'National',
        color: 'rgba(255, 255, 255, 0.45)',
        values: nationalValues
      }
    ];
  }, [tracts, countyName, stateAbbr]);

  // Handler: Add Top Gap to Assessment
  const overallRate = kpis.utilRate;
  const unreachedEligible = Math.max(0, kpis.eligible - kpis.enrolled);
  const highNeedLowCoverageCount = kpis.gapCount;
  const priorityTracts = topGaps.map(g => ({ ...g.tract, gapScore: g.gapScore, util: g.util }));


  const handleOpenAddFinding = (tractRecord: CensusTract) => {
    const util = getUtil(tractRecord, activeProg);
    const progLabel = activeProg === 'all' ? 'composite public health programs' : PROGRAMS[activeProg]?.name;
    setFindingTract(tractRecord);
    setFindingNote(
      `Coverage gap: ${tractRecord.name} combines social vulnerability ${tractRecord.svi.toFixed(2)} with only ${util.toFixed(0)}% ${progLabel} utilization, representing the largest gap in ${countyName}. Candidate for prioritized outreach allocation.`
    );
    setFindingModalOpen(true);
  };
  const handleOpenAddTopGap = () => { if (topGaps[0]) handleOpenAddFinding(topGaps[0].tract); };
  const handleOpenFindingModal = handleOpenAddFinding;

  const handleSubmitFinding = async () => {
    if (!findingTract || !findingNote.trim()) return;
    setSubmittingFinding(true);

    try {
      let targetAssessmentId = selectedAssessmentId;

      // If no assessment exists, create one first
      if (!targetAssessmentId) {
        const createRes = await fetch('/api/assessments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Community Needs Assessment - ${countyName} ${new Date().getFullYear()}`,
            jurisdictionId: countyFips,
            template: 'access',
            due: new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10)
          })
        });
        if (createRes.ok) {
          const newAss = await createRes.json();
          targetAssessmentId = newAss._id;
        }
      }

      const res = await fetch('/api/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: targetAssessmentId,
          tractId: findingTract._id,
          note: findingNote.trim()
        })
      });

      if (res.ok) {
        await markWorkflowMilestone('finding');
        setToastMessage(`Finding added to Assessment ${targetAssessmentId}`);
        setFindingModalOpen(false);
        setTimeout(() => setToastMessage(null), 4000);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to record finding');
      }
    } catch (e) {
      console.error(e);
      alert('Error creating finding');
    } finally {
      setSubmittingFinding(false);
    }
  };

  // Handler: Export CSV of Gaps
  const handleExportCSV = () => {
    if (!tracts.length) return;
    const headers = ['GEOID', 'Tract Name', 'SVI Vulnerability', 'Utilization (%)', 'Gap Priority Score', 'Status'];
    const rows = tracts.map(t => {
      const util = getUtil(t, activeProg);
      const gap = calcGapScore(t, activeProg);
      return [
        t._id,
        `"${t.name}"`,
        t.svi.toFixed(3),
        util.toFixed(1),
        Math.round(gap),
        gap >= 40 ? '"High Priority Gap"' : '"Adequate Coverage"'
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${countyFips}-program-coverage-gaps-${activeProg}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          <h1>Program utilization</h1>
          <p>See who is reached by public health programs, where coverage falls short and how to deploy mobile clinics or community health workers.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot"></span>Demo environment
          </span>
          <button className="btn" id="pu-find" onClick={handleOpenAddTopGap}>
            <Icon name="clipboard" size={14} />
            <span>Add top gap to assessment</span>
          </button>
        </div>
      </div>

      {/* Program Selector Toolbar */}
      <div className="toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Program</span>
          <div className="seg" id="pu-p">
            {[
              { id: 'all', label: 'All programs' },
              { id: 'wic', label: 'WIC nutrition' },
              { id: 'imm', label: 'Immunizations' },
              { id: 'dpp', label: 'Diabetes prevention' },
              { id: 'tob', label: 'Tobacco cessation' },
              { id: 'mhv', label: 'Maternal health' }
            ].map((p) => (
              <button
                key={p.id}
                className={selectedProgram === p.id ? 'on' : ''}
                onClick={() => setSelectedProgram(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ruled KPI Strip */}
      <section className="strip">
        <div className="strip-i">
          <div className="strip-l">Overall enrollment rate</div>
          <div className="strip-v">
            <span className="num">{overallRate.toFixed(1)}%</span>
          </div>
          <div className="strip-f">Eligible residents reached in {countyName}</div>
        </div>

        <div className="strip-i">
          <div className="strip-l">Eligible residents unreached</div>
          <div className="strip-v">
            <span className="num">{unreachedEligible.toLocaleString()}</span>
          </div>
          <div className="strip-f">Estimated unserved population</div>
        </div>

        <div className="strip-i">
          <div className="strip-l">High-need, low-enrollment tracts</div>
          <div className="strip-v">
            <span className="num">{highNeedLowCoverageCount}</span>
            <small> of {tracts.length || 398}</small>
          </div>
          <div className="strip-f">Priority targets for outreach</div>
        </div>

        <div className="strip-i">
          <div className="strip-l">Estimated impact of full coverage</div>
          <div className="strip-v">
            <span className="num">+{Math.round(unreachedEligible * 0.45).toLocaleString()}</span>
          </div>
          <div className="strip-f">Additional residents with preventive care</div>
        </div>
      </section>

      {/* Main Grid */}
      <div className="grid g-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px' }}>
        {/* Panel 1: Bivariate Map (c-7) */}
        <section className="panel c-7" style={{ gridColumn: 'span 7', padding: 0, overflow: 'hidden', minHeight: '440px', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0 }} id="pu-map">
            <BivariateMap
              countyFips={countyFips}
              countyName={countyName}
              tracts={tracts}
              programKey={activeProg}
              programLabel={activeProg === 'all' ? 'All Programs' : (PROGRAMS[activeProg]?.name || activeProg)}
              selectedTractId={selectedTractId}
              onSelectTract={(t: any) => setSelectedTractId(t._id)}
              height={440}
            />
          </div>

          <div className="map-float" style={{ position: 'absolute', left: '14px', top: '14px', padding: '10px 14px', zIndex: 10 }}>
            <b style={{ fontSize: '12.5px', display: 'block' }}>Community coverage mismatch</b>
            <span className="note" style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Dark violet = High vulnerability, low enrollment
            </span>
          </div>

          {/* Bivariate 3x3 Legend Matrix */}
          <div
            className="map-float"
            style={{
              position: 'absolute',
              right: '14px',
              bottom: '14px',
              padding: '10px 12px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              zIndex: 10
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 16px)', gap: '2px' }}>
                {[['#5DD0D5', '#2E93C9', '#173F8A'], ['#BDEDEF', '#8FC3DE', '#4F86CF'], ['#E4F1FB', '#B9D7F0', '#8FB8E3']].map((row, rIdx) =>
                  row.map((color, cIdx) => (
                    <div key={`${rIdx}-${cIdx}`} style={{ width: '16px', height: '16px', backgroundColor: color, borderRadius: '2px' }} />
                  ))
                )}
              </div>
              <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--muted)', marginTop: '3px' }}>Vulnerability →</span>
            </div>
            <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--muted)', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              Enrollment →
            </span>
          </div>
        </section>

        {/* Panel 2: Utilization by Vulnerability Tier (c-5) */}
        <section className="panel c-5" style={{ gridColumn: 'span 5' }}>
          <div className="panel-h">
            <div>
              <h3>Utilization by vulnerability tier</h3>
              <div className="sub">Eligible population vs enrolled residents</div>
            </div>
          </div>
          <div style={{ height: '260px', marginTop: '10px' }}>
            <GroupedBarChart
              categories={['Very High', 'High', 'Moderate', 'Low', 'Very Low']}
              series={[
                { name: 'Eligible Need', color: 'var(--amber)', values: [1840, 2410, 3100, 2800, 1950] },
                { name: 'Enrolled', color: 'var(--teal)', values: [980, 1420, 2180, 2240, 1720] }
              ]}
              height={260}
            />
          </div>
        </section>

        {/* Panel 3: Resource Allocation Simulator (c-6) */}
        <section className="panel c-6" style={{ gridColumn: 'span 6' }}>
          <div className="panel-h">
            <div>
              <h3>Resource allocation simulator</h3>
              <div className="sub">Project enrollment gains by allocating community health workers</div>
            </div>
          </div>

          <div style={{ padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Community Health Workers (FTE):</span>
              <span className="num" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--cyan)' }}>
                {fteSlider} FTE
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="20"
              value={fteSlider}
              onChange={(e) => setFteSlider(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--cyan)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--faint)', marginTop: '4px' }}>
              <span>1 FTE</span>
              <span>10 FTE</span>
              <span>20 FTE</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '18px' }}>
              <div style={{ padding: '10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Monthly Contacts</small>
                <b className="num" style={{ fontSize: '16px', color: 'var(--text)' }}>{(fteSlider * 140).toLocaleString()}</b>
              </div>
              <div style={{ padding: '10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Projected Enrollments</small>
                <b className="num" style={{ fontSize: '16px', color: 'var(--teal)' }}>+{(fteSlider * 85).toLocaleString()}</b>
              </div>
              <div style={{ padding: '10px', borderRadius: '10px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <small style={{ display: 'block', fontSize: '10.5px', color: 'var(--faint)' }}>Rate Increase</small>
                <b className="num" style={{ fontSize: '16px', color: 'var(--cyan)' }}>+{(fteSlider * 0.9).toFixed(1)}%</b>
              </div>
            </div>
          </div>
        </section>

        {/* Panel 4: Priority Underserved Tracts Table (c-6) */}
        <section className="panel c-6" style={{ gridColumn: 'span 6' }}>
          <div className="panel-h">
            <div>
              <h3>Underserved priority tracts</h3>
              <div className="sub">Highest vulnerability with lowest service utilization</div>
            </div>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: '250px', overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tract</th>
                  <th className="r">Vulnerability</th>
                  <th className="r">Enrollment</th>
                  <th className="r">Unreached</th>
                  <th className="r">Action</th>
                </tr>
              </thead>
              <tbody>
                {priorityTracts.map((t: any) => (
                  <tr key={t._id}>
                    <td><b>{t.name.replace('Census Tract ', 'Tract ')}</b></td>
                    <td className="r num">{(t.svi || 0).toFixed(2)}</td>
                    <td className="r num" style={{ color: 'var(--rose)', fontWeight: 600 }}>{(t.rate || 42).toFixed(1)}%</td>
                    <td className="r num">{(t.unreached || 320).toLocaleString()}</td>
                    <td className="r">
                      <button
                        className="btn sm"
                        style={{ padding: '2px 8px', fontSize: '11px', height: '24px' }}
                        onClick={() => handleOpenFindingModal(t)}
                      >
                        Tag gap
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Add Finding Modal */}
      {findingModalOpen && findingTract && (
        <div id="modal-root" className="open">
          <div className="modal-scrim" onClick={() => setFindingModalOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" style={{ width: '480px', maxWidth: '90vw' }}>
            <div className="modal-h">
              <div>
                <h3>Add Program Utilization Finding</h3>
                <div className="sub">Document service gap for {findingTract.name}</div>
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
                  <option value="new">+ Create New Assessment for {countyName}</option>
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

export default function ProgramUtilizationPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[13px] text-[var(--muted)]">
          Loading program utilization analytics...
        </div>
      }
    >
      <ProgramUtilizationContent />
    </Suspense>
  );
}
