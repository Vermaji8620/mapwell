'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { Assessment, CensusTract, Finding, Jurisdiction } from '@/types';
import { METRICS_CONFIG, TIER_COLORS, TIER_LABELS } from '@/config/metrics';
import {
  ClipboardList,
  Plus,
  Check,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Trash2,
  FileText,
  MapPin,
  Flag,
  Sparkles,
  Search,
  ExternalLink,
  Layers,
  Activity,
  AlertCircle,
  Eye,
  RefreshCw,
  X
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AssessmentTractMap } from '@/components/AssessmentTractMap';
import { GroupedBarChart } from '@/components/GroupedBarChart';

const STEPS = [
  'Geography',
  'Indicators',
  'Vulnerability analysis',
  'Review findings',
  'Generate report'
];

const INDICATOR_GROUPS = [
  {
    name: 'Social determinants',
    keys: ['poverty', 'childPoverty', 'income', 'rentBurden', 'noVehicle', 'noDiploma', 'unemployment', 'broadband']
  },
  {
    name: 'Health outcomes',
    keys: ['diabetes', 'hypertension', 'asthma', 'obesity', 'copd', 'lifeExp']
  },
  {
    name: 'Access and programs',
    keys: ['uninsured', 'pcp', 'driveTime', 'access', 'prog.wic', 'prog.imm', 'prog.dpp', 'prog.mhv']
  }
];

const TEMPLATES = {
  chronic: {
    name: 'Chronic disease burden',
    indicators: ['diabetes', 'hypertension', 'obesity', 'uninsured', 'poverty']
  },
  mch: {
    name: 'Maternal and child health',
    indicators: ['childPoverty', 'prog.wic', 'prog.mhv', 'prog.imm', 'uninsured']
  },
  access: {
    name: 'Access to care',
    indicators: ['uninsured', 'pcp', 'driveTime', 'noVehicle']
  },
  custom: {
    name: 'Custom',
    indicators: ['svi', 'poverty', 'uninsured', 'diabetes']
  }
};

function AssessmentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramOpen = searchParams.get('open');

  const { activeCounty, jurisdictions, markWorkflowMilestone } = useSession();

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(paramOpen || null);
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [step, setStep] = useState<number>(1);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Draft' | 'In review' | 'Completed'>('All');
  const [loading, setLoading] = useState<boolean>(true);
  const [workspaceLoading, setWorkspaceLoading] = useState<boolean>(false);

  // Jurisdiction Census Tracts
  const [tracts, setTracts] = useState<CensusTract[]>([]);

  // Modal State
  const [newModalOpen, setNewModalOpen] = useState<boolean>(false);
  const [modalTitle, setModalTitle] = useState<string>('');
  const [modalJur, setModalJur] = useState<string>(activeCounty?._id || '53033');
  const [modalDue, setModalDue] = useState<string>(
    new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10)
  );
  const [modalTemplate, setModalTemplate] = useState<keyof typeof TEMPLATES>('chronic');
  const [submittingModal, setSubmittingModal] = useState<boolean>(false);

  // Generating Report State
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedReportId, setGeneratedReportId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mark workflow milestone on load
  useEffect(() => {
    markWorkflowMilestone('assessment');
  }, [markWorkflowMilestone]);

  // Load Assessments list
  const loadAssessments = async () => {
    try {
      const res = await fetch('/api/assessments');
      if (res.ok) {
        const data = await res.json();
        setAssessments(data);
        if (data.length > 0 && !selectedId) {
          setSelectedId(data[0]._id);
        }
      }
    } catch (e) {
      console.error('Failed to load assessments:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssessments();
  }, []);

  // Synchronize when selectedId changes
  useEffect(() => {
    if (!selectedId) return;
    setWorkspaceLoading(true);

    fetch(`/api/assessments/${selectedId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data) {
          setActiveAssessment(data);
          setStep(data.status === 'Completed' ? 5 : data.step || 1);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setWorkspaceLoading(false));
  }, [selectedId]);

  // Load tracts for the active assessment's jurisdiction
  useEffect(() => {
    const jurId = activeAssessment?.jurisdictionId || activeCounty?._id || '53033';
    fetch(`/api/tracts?county=${jurId}`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(json => {
        setTracts(json.data || []);
      })
      .catch(e => console.error(e));
  }, [activeAssessment?.jurisdictionId, activeCounty]);

  // Patch active assessment helper
  const updateAssessment = async (updates: Partial<Assessment>) => {
    if (!activeAssessment) return;
    try {
      const res = await fetch(`/api/assessments/${activeAssessment._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveAssessment(prev => (prev ? { ...prev, ...updated } : updated));
        setAssessments(prev =>
          prev.map(a => (a._id === updated._id ? { ...a, ...updated } : a))
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Step 1: Geography Tract Toggle
  const handleToggleTract = (t: CensusTract) => {
    if (!activeAssessment) return;
    const current = activeAssessment.focusTracts || [];
    const exists = current.includes(t._id);
    const nextTracts = exists
      ? current.filter(id => id !== t._id)
      : [...current, t._id];

    updateAssessment({ focusTracts: nextTracts });
  };

  const handleAddHighVuln = () => {
    if (!activeAssessment || tracts.length === 0) return;
    const highTier = tracts.filter(t => (t.tier ?? 0) >= 3).map(t => t._id);
    const combined = Array.from(new Set([...(activeAssessment.focusTracts || []), ...highTier]));
    updateAssessment({ focusTracts: combined });
  };

  const handleClearFocus = () => {
    if (!activeAssessment) return;
    updateAssessment({ focusTracts: [] });
  };

  // Step 2: Indicator Toggle
  const handleToggleIndicator = (key: string) => {
    if (!activeAssessment) return;
    const current = activeAssessment.indicators || [];
    const exists = current.includes(key);
    const nextIndicators = exists
      ? current.filter(k => k !== key)
      : [...current, key];

    updateAssessment({ indicators: nextIndicators });
  };

  // Step 3: Comparative Calculations
  const focusTractList = useMemo(() => {
    if (!activeAssessment) return [];
    const focusIds = new Set(activeAssessment.focusTracts || []);
    if (focusIds.size === 0) {
      // Default to high vulnerability tracts if none selected
      return tracts.filter(t => (t.tier ?? 0) >= 3);
    }
    return tracts.filter(t => focusIds.has(t._id));
  }, [activeAssessment, tracts]);

  const restTractList = useMemo(() => {
    const focusIds = new Set(focusTractList.map(t => t._id));
    const rest = tracts.filter(t => !focusIds.has(t._id));
    return rest.length > 0 ? rest : tracts;
  }, [tracts, focusTractList]);

  const getMetricVal = (t: CensusTract, key: string): number => {
    if (key.startsWith('prog.')) {
      const pKey = key.replace('prog.', '');
      return (t.prog as any)?.[pKey] ?? 50;
    }
    const val = (t.indicators as any)?.[key] ?? (t as any)[key] ?? t.svi;
    return typeof val === 'number' ? val : 0;
  };

  const compChartData = useMemo(() => {
    const inds = activeAssessment?.indicators?.slice(0, 6) || ['svi', 'poverty', 'uninsured', 'diabetes'];
    const categories = inds.map(k => METRICS_CONFIG[k]?.short || k);

    const focusVals = inds.map(k => {
      if (focusTractList.length === 0) return 0;
      const sum = focusTractList.reduce((acc, t) => acc + getMetricVal(t, k), 0);
      return Math.round((sum / focusTractList.length) * 10) / 10;
    });

    const restVals = inds.map(k => {
      if (restTractList.length === 0) return 0;
      const sum = restTractList.reduce((acc, t) => acc + getMetricVal(t, k), 0);
      return Math.round((sum / restTractList.length) * 10) / 10;
    });

    return {
      categories,
      series: [
        {
          name: 'Focus tracts',
          color: '#F43F5E',
          values: focusVals
        },
        {
          name: 'Rest of county',
          color: '#10B981',
          values: restVals
        }
      ]
    };
  }, [activeAssessment, focusTractList, restTractList]);

  // Step 4: Remove Finding
  const handleRemoveFinding = async (findingId: string) => {
    try {
      const res = await fetch(`/api/findings/${findingId}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeAssessment) {
          const nextFindings = (activeAssessment.findings || []).filter(f => f._id !== findingId);
          setActiveAssessment({
            ...activeAssessment,
            findings: nextFindings,
            findingsCount: nextFindings.length
          });
        }
        setAssessments(prev =>
          prev.map(a =>
            a._id === activeAssessment?._id
              ? { ...a, findingsCount: Math.max(0, (a.findingsCount || 1) - 1) }
              : a
          )
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Step 5: Compile Report
  const handleCompileReport = async () => {
    if (!activeAssessment) return;
    setIsGenerating(true);

    try {
      const res = await fetch(`/api/assessments/${activeAssessment._id}/compile`, {
        method: 'POST'
      });
      if (res.ok) {
        const result = await res.json();
        setGeneratedReportId(result.reportId);
        setActiveAssessment(prev =>
          prev ? { ...prev, status: 'Completed', step: 5 } : prev
        );
        setAssessments(prev =>
          prev.map(a =>
            a._id === activeAssessment._id ? { ...a, status: 'Completed', step: 5 } : a
          )
        );
        setToastMessage(`Report compiled successfully: ${result.reportId}`);
        setTimeout(() => setToastMessage(null), 5000);
      } else {
        alert('Failed to compile report');
      }
    } catch (e) {
      console.error(e);
      alert('Error compiling report');
    } finally {
      setIsGenerating(false);
    }
  };

  // Stepper advancement
  const handleNextStep = () => {
    if (!activeAssessment) return;
    const nextS = Math.min(5, step + 1);
    setStep(nextS);

    const updates: Partial<Assessment> = {
      step: Math.max(activeAssessment.step || 1, nextS)
    };
    if (nextS >= 4 && activeAssessment.status === 'Draft') {
      updates.status = 'In review';
    }
    updateAssessment(updates);
  };

  const handlePrevStep = () => {
    setStep(prev => Math.max(1, prev - 1));
  };

  // Create New Assessment Modal Handler
  const handleCreateAssessment = async () => {
    if (!modalTitle.trim()) return;
    setSubmittingModal(true);

    try {
      const selectedTpl = TEMPLATES[modalTemplate];
      const res = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: modalTitle.trim(),
          jurisdictionId: modalJur,
          due: modalDue,
          template: modalTemplate,
          indicators: selectedTpl.indicators
        })
      });

      if (res.ok) {
        const created = await res.json();
        setAssessments(prev => [created, ...prev]);
        setSelectedId(created._id);
        setNewModalOpen(false);
        setToastMessage(`Draft Assessment created: ${created._id}`);
        setTimeout(() => setToastMessage(null), 4000);
      } else {
        alert('Failed to create assessment project');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmittingModal(false);
    }
  };

  // Filtered assessments list
  const filteredAssessments = useMemo(() => {
    return assessments.filter(a => {
      if (statusFilter === 'All') return true;
      return a.status === statusFilter;
    });
  }, [assessments, statusFilter]);

  const activeJur = useMemo(() => {
    const jurId = activeAssessment?.jurisdictionId || activeCounty?._id || '53033';
    return (
      jurisdictions.find(j => j._id === jurId) ||
      activeCounty || { _id: jurId, name: 'County', stateAbbr: 'WA' }
    );
  }, [activeAssessment, jurisdictions, activeCounty]);

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[250] flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[var(--surface-solid)] border border-[var(--cyan)] shadow-2xl text-[13px] text-[var(--text)] font-semibold animate-in slide-in-from-bottom-3">
          <Check className="w-4 h-4 text-[var(--cyan)]" />
          <span>{toastMessage}</span>
          {generatedReportId && (
            <Link
              href={`/reports?open=${generatedReportId}`}
              className="ml-2 px-2.5 py-1 rounded-lg bg-[var(--cyan)] text-white text-[11px] font-bold hover:opacity-90 transition-opacity"
            >
              Open Report
            </Link>
          )}
        </div>
      )}

      {/* Screen Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text)] tracking-tight">
            Community needs assessments
          </h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Scope a geography, choose indicators, analyze vulnerability, review findings, then generate the assessment report.
          </p>
        </div>

        <button
          onClick={() => {
            setModalTitle(`Community needs assessment, ${activeCounty?.name || 'County'} ${new Date().getFullYear() + 1}`);
            setNewModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--cyan)] text-white hover:opacity-90 text-[12.5px] font-bold shadow-xs transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New assessment</span>
        </button>
      </div>

      {/* Main Grid: Col 4 (Projects List) & Col 8 (Guided Workspace) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col (Col 4): Assessment Projects Tracker */}
        <section className="lg:col-span-4 rounded-2xl glass-panel p-5 flex flex-col justify-between min-h-[580px]">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
              <h3 className="text-base font-bold text-[var(--text)]">Assessment projects</h3>
              <span className="text-[11px] font-bold text-[var(--muted)] num">
                {filteredAssessments.length} total
              </span>
            </div>

            {/* Status Filter Segmented Controls */}
            <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] my-3 text-[11px] font-bold">
              {(['All', 'Draft', 'In review', 'Completed'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setStatusFilter(tab)}
                  className={`py-1 rounded-lg transition-all text-center ${
                    statusFilter === tab
                      ? 'bg-[var(--surface-solid)] text-[var(--text)] shadow-xs'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Assessment Projects Cards */}
            <div className="space-y-2 mt-3 max-h-[460px] overflow-y-auto pr-1">
              {filteredAssessments.length === 0 ? (
                <div className="py-12 text-center text-[12px] text-[var(--muted)]">
                  No {statusFilter.toLowerCase()} assessments found.
                </div>
              ) : (
                filteredAssessments.map(item => {
                  const isSelected = item._id === selectedId;
                  const pct =
                    item.status === 'Completed'
                      ? 100
                      : Math.min(100, Math.max(10, ((item.step || 1) - 1) * 20 + 10));

                  const jur =
                    jurisdictions.find(j => j._id === item.jurisdictionId) || {
                      name: item.jurisdictionId
                    };

                  return (
                    <div
                      key={item._id}
                      onClick={() => setSelectedId(item._id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                        isSelected
                          ? 'bg-[var(--glow)]/70 border-[var(--cyan)] shadow-sm'
                          : 'bg-[var(--surface-solid)]/60 border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[13px] text-[var(--text)] leading-snug line-clamp-1">
                          {item.title}
                        </strong>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${
                            item.status === 'Completed'
                              ? 'bg-[var(--teal)]/20 text-[var(--teal)]'
                              : item.status === 'In review'
                              ? 'bg-[var(--cyan)]/20 text-[var(--cyan)]'
                              : 'bg-[var(--amber)]/20 text-[var(--amber)]'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                        <span>
                          {item._id} • {jur.name}
                        </span>
                        <span>{item.findingsCount || (item.findings?.length ?? 0)} findings</span>
                      </div>

                      {/* Smooth Progress Bar */}
                      <div className="w-full h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--cyan)] transition-all duration-700 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            Click any assessment to inspect and manage its workflow
          </div>
        </section>

        {/* Right Col (Col 8): Assessment Workspace Panel */}
        <section className="lg:col-span-8 rounded-2xl glass-panel p-6 flex flex-col justify-between min-h-[580px]">
          {workspaceLoading || !activeAssessment ? (
            <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--muted)]">
              Loading assessment workspace...
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-between space-y-5">
              {/* Workspace Header */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--line)]">
                  <div>
                    <h2 className="text-xl font-bold font-display text-[var(--text)] leading-tight">
                      {activeAssessment.title}
                    </h2>
                    <p className="text-[12px] text-[var(--muted)] mt-0.5">
                      {activeAssessment._id} • {activeJur.name} County, {activeJur.stateAbbr} • Owner: {activeAssessment.owner || 'Public Health Analyst'}
                      {activeAssessment.due && ` • Due ${activeAssessment.due}`}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold self-start sm:self-auto ${
                      activeAssessment.status === 'Completed'
                        ? 'bg-[var(--teal)]/20 text-[var(--teal)]'
                        : activeAssessment.status === 'In review'
                        ? 'bg-[var(--cyan)]/20 text-[var(--cyan)]'
                        : 'bg-[var(--amber)]/20 text-[var(--amber)]'
                    }`}
                  >
                    {activeAssessment.status}
                  </span>
                </div>

                {/* 5-Step Animated Navigation Stepper */}
                <div className="flex items-center justify-between mt-4 overflow-x-auto pb-2">
                  {STEPS.map((stepName, idx) => {
                    const stepNum = idx + 1;
                    const isDone = stepNum < step || activeAssessment.status === 'Completed';
                    const isCurrent = stepNum === step;

                    return (
                      <React.Fragment key={stepName}>
                        {idx > 0 && (
                          <div
                            className={`flex-1 h-0.5 mx-2 rounded-full transition-all duration-500 ${
                              isDone ? 'bg-[var(--cyan)]' : 'bg-[var(--line)]'
                            }`}
                          />
                        )}
                        <button
                          onClick={() => setStep(stepNum)}
                          className="flex items-center gap-2 group flex-shrink-0 cursor-pointer"
                        >
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-all duration-300 ${
                              isCurrent
                                ? 'bg-[var(--cyan)] text-white shadow-md ring-4 ring-[var(--glow)]'
                                : isDone
                                ? 'bg-[var(--cyan)]/20 text-[var(--cyan)] border border-[var(--cyan)]/40'
                                : 'bg-[var(--surface-2)] text-[var(--faint)] border border-[var(--line)]'
                            }`}
                          >
                            {isDone ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : stepNum}
                          </div>
                          <span
                            className={`text-[12px] font-medium hidden md:inline transition-colors ${
                              isCurrent
                                ? 'font-bold text-[var(--text)]'
                                : isDone
                                ? 'text-[var(--muted)]'
                                : 'text-[var(--faint)]'
                            }`}
                          >
                            {stepName}
                          </span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Step Content Container (Animated in with smooth fade & slide) */}
              <div key={step} className="flex-1 transition-all duration-400 ease-out animate-in fade-in slide-in-from-right-2">
                {/* STEP 1: GEOGRAPHY */}
                {step === 1 && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                    <div className="md:col-span-7 rounded-xl overflow-hidden border border-[var(--line)] bg-[var(--surface-solid)] relative min-h-[340px]">
                      <AssessmentTractMap
                        countyFips={activeAssessment.jurisdictionId}
                        tracts={tracts}
                        selectedTractIds={activeAssessment.focusTracts || []}
                        onToggleTract={handleToggleTract}
                        height={340}
                      />
                    </div>

                    <div className="md:col-span-5 flex flex-col justify-between space-y-4">
                      <div className="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] space-y-2.5 text-[12px]">
                        <div className="flex justify-between">
                          <span className="text-[var(--muted)]">Jurisdiction:</span>
                          <strong className="text-[var(--text)]">{activeJur.name} County</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--muted)]">Tracts in county:</span>
                          <strong className="text-[var(--text)] num">{tracts.length}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--muted)]">Focus tracts selected:</span>
                          <strong className="text-[var(--cyan)] num">
                            {activeAssessment.focusTracts?.length || 0}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--muted)]">Residents in focus tracts:</span>
                          <strong className="text-[var(--text)] num">
                            {focusTractList
                              .reduce((acc, t) => acc + (t.population || 4000), 0)
                              .toLocaleString()}
                          </strong>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <button
                          onClick={handleAddHighVuln}
                          className="w-full py-2 px-3 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] hover:bg-[var(--surface-2)] text-[12px] font-bold text-[var(--text)] transition-colors flex items-center justify-center gap-2"
                        >
                          <Flag className="w-3.5 h-3.5 text-[var(--cyan)]" />
                          <span>Add all high-vulnerability tracts</span>
                        </button>
                        <button
                          onClick={handleClearFocus}
                          className="w-full py-2 px-3 rounded-xl border border-transparent hover:bg-[var(--surface-2)] text-[12px] font-bold text-[var(--muted)] hover:text-[var(--text)] transition-colors text-center"
                        >
                          Clear focus tracts
                        </button>
                      </div>

                      <div className="p-3 rounded-xl bg-[var(--surface-2)]/60 text-[11px] text-[var(--faint)] leading-relaxed">
                        Tracts selected here will be profiled against the jurisdiction baseline in Step 3 and summarized in the final report.
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 2: INDICATORS */}
                {step === 2 && (
                  <div className="space-y-4">
                    <p className="text-[12px] text-[var(--muted)]">
                      Select priority indicators to measure across the selected focus tracts. Indicators chosen here define the surveillance baseline.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {INDICATOR_GROUPS.map(grp => (
                        <div key={grp.name} className="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] space-y-3">
                          <h4 className="text-[12.5px] font-bold text-[var(--text)] pb-1.5 border-b border-[var(--line)]">
                            {grp.name}
                          </h4>
                          <div className="space-y-2">
                            {grp.keys.map(k => {
                              const isChecked = (activeAssessment.indicators || []).includes(k);
                              const meta = METRICS_CONFIG[k] || { short: k, label: k };

                              return (
                                <label
                                  key={k}
                                  className="flex items-start gap-2.5 cursor-pointer group text-[12px] select-none"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleToggleIndicator(k)}
                                    className="mt-0.5 accent-[var(--cyan)] rounded cursor-pointer"
                                  />
                                  <div className="flex-1">
                                    <span className={`block font-semibold transition-colors ${isChecked ? 'text-[var(--cyan)]' : 'text-[var(--text)]'}`}>
                                      {meta.short}
                                    </span>
                                    <span className="text-[10.5px] text-[var(--faint)] leading-tight block">
                                      {meta.label}
                                    </span>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* STEP 3: VULNERABILITY ANALYSIS */}
                {step === 3 && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                    {/* Left: Grouped Bar Chart */}
                    <div className="md:col-span-7 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] flex flex-col justify-between">
                      <div>
                        <h4 className="text-[13px] font-bold text-[var(--text)]">
                          Focus Tracts against the Jurisdiction
                        </h4>
                        <p className="text-[11.5px] text-[var(--muted)]">
                          {focusTractList.length} focus tracts compared to county baseline
                        </p>
                      </div>

                      <div className="my-3">
                        <GroupedBarChart
                          categories={compChartData.categories}
                          series={compChartData.series}
                          height={220}
                        />
                      </div>

                      <div className="flex items-center gap-5 pt-2 border-t border-[var(--line)] text-[11px]">
                        <div className="flex items-center gap-1.5 font-bold text-[var(--rose)]">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#F43F5E]" />
                          <span>Focus tracts</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-bold text-[var(--teal)]">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
                          <span>Rest of {activeJur.name}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Ranking Table & Pop Insight */}
                    <div className="md:col-span-5 flex flex-col justify-between space-y-3">
                      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] overflow-hidden max-h-[260px] overflow-y-auto">
                        <table className="w-full text-left text-[11.5px]">
                          <thead className="bg-[var(--surface-2)] text-[10px] font-bold text-[var(--faint)] uppercase border-b border-[var(--line)] sticky top-0 backdrop-blur-md">
                            <tr>
                              <th className="p-2.5">Tract</th>
                              <th className="p-2.5 text-right">Vulnerability</th>
                              <th className="p-2.5 text-right">Need Score</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--line)]">
                            {focusTractList
                              .slice()
                              .sort((a, b) => b.svi - a.svi)
                              .slice(0, 10)
                              .map(t => (
                                <tr key={t._id} className="hover:bg-[var(--surface-2)]">
                                  <td className="p-2.5 font-semibold text-[var(--text)]">
                                    {t.name.replace('Census Tract ', '')}
                                  </td>
                                  <td className="p-2.5 text-right num font-bold text-[var(--cyan)]">
                                    {t.svi.toFixed(2)}
                                  </td>
                                  <td className="p-2.5 text-right num font-bold text-[var(--rose)]">
                                    {Math.round(t.svi * 60 + (100 - (t.indicators?.access || 50)) * 0.4)}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Population Disparity Insight */}
                      <div className="p-3.5 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] flex items-start gap-2.5 text-[11.5px] leading-relaxed">
                        <Sparkles className="w-4 h-4 text-[var(--cyan)] mt-0.5 flex-shrink-0" />
                        <div>
                          Focus tracts hold{' '}
                          <strong className="text-[var(--text)] num">
                            {focusTractList
                              .reduce((acc, t) => acc + (t.population || 4000), 0)
                              .toLocaleString()}
                          </strong>{' '}
                          residents, representing{' '}
                          <strong className="text-[var(--cyan)] num">
                            {Math.round(
                              (focusTractList.reduce((acc, t) => acc + (t.population || 4000), 0) /
                                (tracts.reduce((acc, t) => acc + (t.population || 4000), 0) || 1)) *
                                100
                            )}
                            %
                          </strong>{' '}
                          of the total jurisdiction.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 4: REVIEW FINDINGS */}
                {step === 4 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-[13px] font-bold text-[var(--text)]">Field Observations & Findings</h4>
                        <p className="text-[11.5px] text-[var(--muted)]">
                          Empirical findings attached from Health Map, Census Tracts, and Program Utilization
                        </p>
                      </div>
                      <span className="text-[11px] font-bold text-[var(--cyan)] num">
                        {activeAssessment.findings?.length || 0} findings recorded
                      </span>
                    </div>

                    {(!activeAssessment.findings || activeAssessment.findings.length === 0) ? (
                      <div className="p-8 rounded-xl bg-[var(--surface-2)]/60 border border-[var(--line)] text-center space-y-3">
                        <Flag className="w-6 h-6 text-[var(--faint)] mx-auto" />
                        <div className="text-[13px] font-bold text-[var(--text)]">No findings recorded yet</div>
                        <p className="text-[11.5px] text-[var(--muted)] max-w-md mx-auto">
                          Flag an underserved tract in the Health Map, Census Tracts Explorer, or Program Utilization, then click Add finding to assessment.
                        </p>
                        <div className="flex items-center justify-center gap-3 pt-2">
                          <Link
                            href="/health-map"
                            className="px-3.5 py-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[12px] font-bold text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                          >
                            Open Health Map
                          </Link>
                          <Link
                            href="/census-tracts"
                            className="px-3.5 py-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[12px] font-bold text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                          >
                            Open Census Tracts
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                        {activeAssessment.findings.map(f => (
                          <div
                            key={f._id}
                            className="p-3.5 rounded-xl bg-[var(--surface-solid)] border border-[var(--line)] flex items-start justify-between gap-3 shadow-2xs hover:border-[var(--line-strong)] transition-all"
                          >
                            <div className="flex items-start gap-2.5 flex-1">
                              <span className="w-2 h-2 rounded-full bg-[var(--rose)] mt-1.5 flex-shrink-0" />
                              <div className="space-y-1">
                                <div className="text-[12.5px] font-bold text-[var(--text)]">
                                  {f.tractName || `Tract ${f.tractId}`}
                                </div>
                                <p className="text-[12px] text-[var(--muted)] leading-relaxed">
                                  {f.note}
                                </p>
                                <div className="text-[10.5px] text-[var(--faint)] flex items-center gap-2 pt-0.5">
                                  <span>GEOID {f.tractId}</span>
                                  {f.snapshot && (
                                    <>
                                      <span>•</span>
                                      <span>SVI {f.snapshot.svi.toFixed(2)}</span>
                                      <span>•</span>
                                      <span>Uninsured {f.snapshot.uninsured}%</span>
                                      <span>•</span>
                                      <span>Diabetes {f.snapshot.diabetes}%</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={() => handleRemoveFinding(f._id)}
                              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--rose)] hover:bg-[var(--surface-2)] transition-colors"
                              title="Remove finding"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 5: GENERATE REPORT */}
                {step === 5 && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                    {/* Left: Report Paper Preview */}
                    <div className="md:col-span-7 p-5 rounded-xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-md space-y-4">
                      <div>
                        <span className="text-[10px] font-bold text-[var(--cyan)] uppercase tracking-wider block">
                          Report Publication Preview
                        </span>
                        <h3 className="text-base font-bold font-display text-[var(--text)] mt-1">
                          {activeAssessment.title}
                        </h3>
                        <p className="text-[11.5px] text-[var(--muted)]">
                          {activeJur.name} County • {activeAssessment.focusTracts?.length || 'All high-vulnerability'} focus tracts • {activeAssessment.indicators?.length || 4} indicators
                        </p>
                      </div>

                      {/* Selected Indicators Chips */}
                      <div>
                        <h5 className="text-[11px] font-bold text-[var(--faint)] uppercase mb-1.5">
                          Surveillance Indicators
                        </h5>
                        <div className="flex flex-wrap gap-1.5">
                          {(activeAssessment.indicators || []).map(k => (
                            <span
                              key={k}
                              className="px-2 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[10.5px] font-bold text-[var(--text)]"
                            >
                              {METRICS_CONFIG[k]?.short || k}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Key Findings List */}
                      <div>
                        <h5 className="text-[11px] font-bold text-[var(--faint)] uppercase mb-1.5">
                          Synthesized Field Observations
                        </h5>
                        {activeAssessment.findings && activeAssessment.findings.length > 0 ? (
                          <div className="space-y-1.5 text-[11.5px] text-[var(--muted)]">
                            {activeAssessment.findings.slice(0, 3).map(f => (
                              <p key={f._id} className="line-clamp-2">
                                • {f.note}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11.5px] text-[var(--muted)] italic">
                            No qualitative findings recorded. The published report will incorporate empirical vulnerability indicators and regional benchmarks.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="md:col-span-5 flex flex-col justify-between space-y-4">
                      <div className="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] space-y-2.5 text-[12px]">
                        <div className="flex justify-between">
                          <span className="text-[var(--muted)]">Workflow Status:</span>
                          <strong className="text-[var(--text)]">{activeAssessment.status}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--muted)]">Report Status:</span>
                          <strong className="text-[var(--cyan)]">
                            {activeAssessment.status === 'Completed' ? 'Generated' : 'Pending Generation'}
                          </strong>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <button
                          onClick={handleCompileReport}
                          disabled={isGenerating}
                          className="w-full py-2.5 px-4 rounded-xl bg-[var(--cyan)] hover:opacity-90 disabled:opacity-50 text-[12.5px] font-bold text-white shadow-md transition-all flex items-center justify-center gap-2"
                        >
                          {isGenerating ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>Compiling Report...</span>
                            </>
                          ) : (
                            <>
                              <FileText className="w-4 h-4" />
                              <span>{activeAssessment.status === 'Completed' ? 'Regenerate report' : 'Generate assessment report'}</span>
                            </>
                          )}
                        </button>

                        {(generatedReportId || activeAssessment.status === 'Completed') && (
                          <Link
                            href={`/reports?open=${generatedReportId || ''}`}
                            className="w-full py-2 px-3 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] hover:bg-[var(--surface-2)] text-[12px] font-bold text-[var(--text)] transition-colors flex items-center justify-center gap-2"
                          >
                            <Eye className="w-3.5 h-3.5 text-[var(--cyan)]" />
                            <span>View in Reports & Exports</span>
                          </Link>
                        )}
                      </div>

                      <div className="p-3 rounded-xl bg-[var(--surface-2)]/60 text-[11px] text-[var(--faint)] leading-relaxed">
                        Generating a report compiles the analysis, marks this assessment Completed, and archives the document in Reports & Exports.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Stepper Action Bar */}
              <div className="flex items-center justify-between pt-4 border-t border-[var(--line)]">
                <button
                  onClick={handlePrevStep}
                  disabled={step === 1}
                  className="px-4 py-2 rounded-xl text-[12.5px] font-bold text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>

                {step < 5 ? (
                  <button
                    onClick={handleNextStep}
                    className="px-5 py-2 rounded-xl bg-[var(--cyan)] hover:opacity-90 text-[12.5px] font-bold text-white shadow-xs transition-all flex items-center gap-1.5"
                  >
                    <span>Continue to {STEPS[step].toLowerCase()}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="text-[12px] font-bold text-[var(--teal)] flex items-center gap-1.5">
                    <Check className="w-4 h-4" />
                    <span>Workflow Completed</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* New Assessment Project Modal */}
      {newModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-[var(--line)]">
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">Create assessment</h3>
                <p className="text-[12px] text-[var(--muted)]">
                  Set the scope and starting indicators. You can modify them later.
                </p>
              </div>
              <button
                onClick={() => setNewModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Assessment Name */}
              <div className="space-y-1.5">
                <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                  Assessment Name
                </label>
                <input
                  type="text"
                  value={modalTitle}
                  onChange={e => setModalTitle(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12.5px] text-[var(--text)] font-semibold outline-none focus:border-[var(--cyan)]"
                />
              </div>

              {/* Jurisdiction & Due Date Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                    Jurisdiction
                  </label>
                  <select
                    value={modalJur}
                    onChange={e => setModalJur(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12.5px] text-[var(--text)] font-semibold outline-none focus:border-[var(--cyan)]"
                  >
                    {jurisdictions.map(j => (
                      <option key={j._id} value={j._id}>
                        {j.name} County, {j.stateAbbr}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={modalDue}
                    onChange={e => setModalDue(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12.5px] text-[var(--text)] font-semibold outline-none focus:border-[var(--cyan)]"
                  />
                </div>
              </div>

              {/* Starting Template Radios */}
              <div className="space-y-1.5">
                <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                  Starting Template
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(TEMPLATES).map(([k, tpl]) => {
                    const isSelected = modalTemplate === k;
                    return (
                      <label
                        key={k}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-[var(--glow)]/80 border-[var(--cyan)] shadow-xs'
                            : 'bg-[var(--surface-2)] border-[var(--line)] hover:border-[var(--line-strong)]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="assessment-tpl"
                            checked={isSelected}
                            onChange={() => setModalTemplate(k as keyof typeof TEMPLATES)}
                            className="accent-[var(--cyan)]"
                          />
                          <strong className="text-[12px] text-[var(--text)]">{tpl.name}</strong>
                        </div>
                        <span className="text-[10.5px] text-[var(--faint)] mt-1 ml-5">
                          {tpl.indicators.length} indicators
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
              <button
                onClick={() => setNewModalOpen(false)}
                className="px-4 py-2 rounded-xl text-[12.5px] font-bold text-[var(--muted)] hover:text-[var(--text)]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAssessment}
                disabled={submittingModal || !modalTitle.trim()}
                className="px-5 py-2 rounded-xl bg-[var(--cyan)] hover:opacity-90 disabled:opacity-50 text-[12.5px] font-bold text-white shadow-md transition-all flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>{submittingModal ? 'Creating...' : 'Create draft'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AssessmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[13px] text-[var(--muted)]">
          Loading community assessments...
        </div>
      }
    >
      <AssessmentsContent />
    </Suspense>
  );
}
