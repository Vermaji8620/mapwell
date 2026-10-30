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

  // Finding Modal state
  const [findingModalOpen, setFindingModalOpen] = useState(false);
  const [findingTract, setFindingTract] = useState<CensusTract | null>(null);
  const [findingNote, setFindingNote] = useState('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('');
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

  // Load assessments for modal dropdown
  useEffect(() => {
    fetch('/api/assessments')
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        setAssessmentsList(data);
        if (data.length > 0 && !selectedAssessmentId) {
          setSelectedAssessmentId(data[0]._id);
        }
      })
      .catch(e => console.error(e));
  }, []);

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
  const handleOpenAddFinding = (tractRecord: CensusTract) => {
    const util = getUtil(tractRecord, activeProg);
    const progLabel = activeProg === 'all' ? 'composite public health programs' : PROGRAMS[activeProg]?.name;
    setFindingTract(tractRecord);
    setFindingNote(
      `Coverage gap: ${tractRecord.name} combines social vulnerability ${tractRecord.svi.toFixed(2)} with only ${util.toFixed(0)}% ${progLabel} utilization, representing the largest gap in ${countyName}. Candidate for prioritized outreach allocation.`
    );
    setFindingModalOpen(true);
  };

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
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[250] flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[var(--surface-solid)] border border-[var(--cyan)] shadow-2xl text-[13px] text-[var(--text)] font-semibold animate-in slide-in-from-bottom-3">
          <Check className="w-4 h-4 text-[var(--cyan)]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Screen Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text)] tracking-tight">
            Program Utilization
          </h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            See who is reached by public health programs, where coverage falls short of need, and how outreach resources could close the gap.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          {topGaps.length > 0 && (
            <button
              onClick={() => handleOpenAddFinding(topGaps[0].tract)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--cyan)] text-white hover:opacity-90 text-[12.5px] font-bold shadow-xs transition-all"
            >
              <ClipboardList className="w-4 h-4" />
              <span>Add top gap to assessment</span>
            </button>
          )}

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[12.5px] font-bold text-[var(--text)] hover:bg-[var(--surface-2)] shadow-xs transition-all"
          >
            <Download className="w-4 h-4 text-[var(--muted)]" />
            <span>Export Gaps</span>
          </button>
        </div>
      </div>

      {/* Program Selector Toolbar */}
      <div className="p-4 rounded-2xl glass-panel">
        <span className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-2">
          Public Health Program
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveProg('all')}
            className={`px-3.5 py-1.5 rounded-xl text-[12px] font-bold transition-all ${
              activeProg === 'all'
                ? 'bg-[var(--cyan)] text-white shadow-xs'
                : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)]'
            }`}
          >
            All programs
          </button>
          {Object.entries(PROGRAMS).map(([k, meta]) => {
            const isSelected = activeProg === k;
            return (
              <button
                key={k}
                onClick={() => setActiveProg(k)}
                className={`px-3.5 py-1.5 rounded-xl text-[12px] font-bold transition-all ${
                  isSelected
                    ? 'bg-[var(--cyan)] text-white shadow-xs'
                    : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)]'
                }`}
              >
                {meta.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI Ribbon (4 Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Enrolled Residents */}
        <div className="rounded-2xl glass-panel p-4 flex flex-col justify-between">
          <span className="text-[11.5px] font-bold text-[var(--muted)]">Enrolled residents</span>
          <div className="text-3xl font-display font-bold text-[var(--text)] num my-2">
            {kpis.enrolled.toLocaleString()}
          </div>
          <span className="text-[11px] text-[var(--faint)]">Eligibility × utilization estimate</span>
        </div>

        {/* Eligible Residents */}
        <div className="rounded-2xl glass-panel p-4 flex flex-col justify-between">
          <span className="text-[11.5px] font-bold text-[var(--muted)]">Eligible residents</span>
          <div className="text-3xl font-display font-bold text-[var(--text)] num my-2">
            {kpis.eligible.toLocaleString()}
          </div>
          <span className="text-[11px] text-[var(--faint)]">Synthetic eligibility rate</span>
        </div>

        {/* Utilization Rate */}
        <div className="rounded-2xl glass-panel p-4 flex flex-col justify-between">
          <span className="text-[11.5px] font-bold text-[var(--muted)]">Utilization rate</span>
          <div className="text-3xl font-display font-bold text-[var(--text)] num my-2 flex items-baseline gap-1">
            <span>{kpis.utilRate.toFixed(1)}</span>
            <small className="text-xl text-[var(--cyan)] font-sans font-bold">%</small>
          </div>
          <span className="text-[11px] text-[var(--faint)]">
            State median {kpis.stateMedian.toFixed(1)}%
          </span>
        </div>

        {/* Coverage Gap Tracts */}
        <div className="rounded-2xl glass-panel p-4 flex flex-col justify-between">
          <span className="text-[11.5px] font-bold text-[var(--muted)]">Coverage gap tracts</span>
          <div className="text-3xl font-display font-bold text-[var(--rose)] num my-2 flex items-baseline gap-1.5">
            <span>{kpis.gapCount}</span>
            <small className="text-sm text-[var(--muted)] font-normal">of {tracts.length}</small>
          </div>
          <span className="text-[11px] text-[var(--faint)]">High need, low utilization</span>
        </div>
      </div>

      {/* Main Visualizations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 7: Bivariate 3x3 Map */}
        <section className="lg:col-span-7 rounded-2xl glass-panel relative overflow-hidden min-h-[460px] border border-[var(--line)]">
          <BivariateMap
            countyFips={countyFips}
            countyName={countyName}
            tracts={tracts}
            programKey={activeProg}
            programLabel={activeProg === 'all' ? 'All Programs' : PROGRAMS[activeProg]?.name || 'Program'}
            selectedTractId={selectedTractId}
            onSelectTract={t => router.push(`/census-tracts?county=${countyFips}&tract=${t._id}`)}
            height={460}
          />
        </section>

        {/* Col 5: Largest Coverage Gaps Priority List */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Largest coverage gaps</h3>
            <p className="text-[12px] text-[var(--muted)]">
              High need, low utilization tracts in {countyName} County
            </p>
          </div>

          <div className="my-3 space-y-1 overflow-y-auto max-h-[360px] pr-1">
            {topGaps.map(({ tract, gapScore, util, svi, tier }) => {
              const isSelected = tract._id === selectedTractId;
              const barPercent = Math.min(100, (gapScore / maxGap) * 100);

              return (
                <div
                  key={tract._id}
                  onClick={() => router.push(`/census-tracts?county=${countyFips}&tract=${tract._id}`)}
                  className={`w-full p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[var(--glow)]/80 border-[var(--cyan)] shadow-sm'
                      : 'border-transparent hover:bg-[var(--surface-2)] hover:border-[var(--line)]'
                  }`}
                  title="Click to explore in Census Tracts"
                >
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                      style={{ backgroundColor: TIER_COLORS[tier] || '#37C8CF' }}
                      title={`Tier ${tier}: ${TIER_LABELS[tier]}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-bold text-[var(--text)] truncate">
                          {tract.name.replace('Census ', '')}
                        </span>
                        <span className="text-[12px] font-bold text-[var(--rose)] num">
                          {gapScore.toFixed(0)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--muted)] flex items-center gap-2 mt-0.5">
                        <span>SVI {svi.toFixed(2)}</span>
                        <span>•</span>
                        <span>Util {util.toFixed(1)}%</span>
                      </div>
                      {/* Gap Magnitude Progress Bar */}
                      <div className="w-full h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden mt-1.5">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[var(--teal)] to-[var(--rose)] transition-all duration-500"
                          style={{ width: `${barPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <Link
                    href={`/census-tracts?county=${countyFips}&tract=${tract._id}`}
                    onClick={e => e.stopPropagation()}
                    className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--cyan)] hover:bg-[var(--surface-2)] transition-colors"
                    title="Inspect in Census Tracts Explorer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)] flex items-center justify-between">
            <span>Score = SVI × (100 - utilization)</span>
            <span className="text-[var(--cyan)] font-semibold">Priority Ranking</span>
          </div>
        </section>

        {/* Col 7: Participation Trends (Longitudinal 10-Yr Line Chart) */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Participation trends</h3>
            <p className="text-[12px] text-[var(--muted)]">
              Utilization among eligible residents, 2016 to 2025
            </p>
          </div>

          <div className="my-4">
            <TrendLineChart
              years={YEARS}
              series={participationTrendSeries}
              height={220}
              unit="%"
            />
          </div>

          <div className="flex items-center gap-5 pt-2 border-t border-[var(--line)] text-[11.5px]">
            <div className="flex items-center gap-1.5 font-bold text-[var(--text)]">
              <span className="w-3 h-3 rounded-full bg-[#37C8CF]" />
              <span>{countyName} County</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-[var(--violet)]">
              <span className="w-3 h-3 rounded-full bg-[#8B5CF6]" />
              <span>{stateName} Benchmark</span>
            </div>
          </div>
        </section>

        {/* Col 5: Service Distribution Donut Chart */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Service distribution</h3>
            <p className="text-[12px] text-[var(--muted)]">Enrolled residents by program</p>
          </div>

          <div className="my-2">
            <DonutChart
              data={serviceDistributionData}
              size={200}
              center={
                totalEnrolledAcrossPrograms >= 1000
                  ? `${(totalEnrolledAcrossPrograms / 1000).toFixed(1)}k`
                  : totalEnrolledAcrossPrograms.toLocaleString()
              }
              centerLabel="enrolled"
            />
          </div>

          {/* Program Legend Swatches */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--line)] text-[11px]">
            {serviceDistributionData.map(d => (
              <div key={d.label} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: d.color }}
                />
                <span className="truncate text-[var(--muted)]">{d.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Col 7: Resource Allocation Simulator */}
        <section className="lg:col-span-7 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Resource allocation</h3>
            <p className="text-[12px] text-[var(--muted)]">
              Illustrative model: assign outreach staff to the largest gaps
            </p>
          </div>

          {/* Interactive Staff Slider */}
          <div className="my-3 p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-between gap-5">
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1 text-[12px] font-bold text-[var(--text)]">
                <span>Outreach staff to allocate</span>
                <span className="text-[11px] text-[var(--faint)]">Range: 1 – 20 FTE</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                value={fte}
                onChange={e => setFte(+e.target.value)}
                className="w-full accent-[var(--cyan)] cursor-pointer"
                aria-label="FTE allocation slider"
              />
            </div>

            <div className="text-right min-w-[90px] flex-shrink-0">
              <span className="text-2xl font-display font-bold text-[var(--cyan)] num">
                {fte} FTE
              </span>
            </div>
          </div>

          {/* Simulated Impact Bars on Top 6 Gap Tracts */}
          <div className="space-y-3.5 my-2">
            {allocRows.map(({ tract, share, baseUtil, gain, projectedUtil }) => (
              <div key={tract._id} className="space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <strong className="text-[var(--text)]">{tract.name.replace('Census ', '')}</strong>
                  <span className="text-[11px] text-[var(--muted)]">
                    <strong className="text-[var(--text)] num">{share.toFixed(1)} FTE</strong>, {baseUtil.toFixed(0)}% to{' '}
                    <strong className="text-[var(--teal)] num">{projectedUtil.toFixed(0)}%</strong> (+{gain.toFixed(0)}%)
                  </span>
                </div>
                {/* Dual-Layer Progress Bar: Base (Violet) + Projected Gain (Teal Gradient) */}
                <div className="relative h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                  <div
                    className="absolute left-0 top-0 bottom-0 bg-[var(--violet)] opacity-60 rounded-full"
                    style={{ width: `${baseUtil}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 bg-gradient-to-r from-[var(--teal)] to-[var(--cyan)] rounded-r-full transition-all duration-700 ease-out"
                    style={{
                      left: `${baseUtil}%`,
                      width: `${gain}%`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            Assumes each FTE raises tract utilization with diminishing returns. A planning aid, not a forecast.
          </div>
        </section>

        {/* Col 5: Program Benchmark Comparison */}
        <section className="lg:col-span-5 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          <div className="pb-3 border-b border-[var(--line)]">
            <h3 className="text-base font-bold text-[var(--text)]">Program comparison</h3>
            <p className="text-[12px] text-[var(--muted)]">
              Utilization: jurisdiction, state and national median
            </p>
          </div>

          <div className="my-3">
            <GroupedBarChart
              categories={benchmarkCategories}
              series={benchmarkSeries}
              height={230}
              format={v => `${v.toFixed(0)}%`}
            />
          </div>

          <div className="flex items-center gap-4 pt-2 border-t border-[var(--line)] text-[11px] flex-wrap">
            <div className="flex items-center gap-1.5 font-bold text-[var(--text)]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#37C8CF]" />
              <span>{countyName}</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-[var(--violet)]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6]" />
              <span>{stateAbbr}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--muted)]">
              <span className="w-2.5 h-2.5 rounded-full bg-white/45" />
              <span>National</span>
            </div>
          </div>
        </section>
      </div>

      {/* Add Finding to Assessment Modal */}
      {findingModalOpen && findingTract && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-[var(--line)]">
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">Add Finding to Assessment</h3>
                <p className="text-[12px] text-[var(--muted)]">
                  {findingTract.name} • GEOID {findingTract._id}
                </p>
              </div>
              <button
                onClick={() => setFindingModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Assessment Project Selector */}
            <div className="space-y-1.5">
              <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                Target Assessment Project
              </label>
              <select
                value={selectedAssessmentId}
                onChange={e => setSelectedAssessmentId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12.5px] text-[var(--text)] font-semibold outline-none focus:border-[var(--cyan)]"
              >
                {assessmentsList.map(a => (
                  <option key={a._id} value={a._id}>
                    {a.title} ({a.status})
                  </option>
                ))}
              </select>
            </div>

            {/* Analytical Finding Note */}
            <div className="space-y-1.5">
              <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                Analytical Observation & Justification
              </label>
              <textarea
                value={findingNote}
                onChange={e => setFindingNote(e.target.value)}
                rows={4}
                className="w-full p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--cyan)] leading-relaxed resize-none"
              />
            </div>

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
                <span>{submittingFinding ? 'Saving...' : 'Add Finding'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
