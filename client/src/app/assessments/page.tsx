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
import { Icon } from '@/components/Icons';
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

function formatRelativeTime(dateString?: string) {
  if (!dateString) return 'recently';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function AssessmentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramOpen = searchParams.get('open');

  const { activeCounty, jurisdictions, markWorkflowMilestone } = useSession();

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(paramOpen || null);
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [step, setStep] = useState<number>(1);
  const activeStep = step;
  const setActiveStep = setStep;
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

  // Synchronize modal jurisdiction with active county
  useEffect(() => {
    if (activeCounty?._id) {
      setModalJur(activeCounty._id);
    }
  }, [activeCounty?._id]);

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
          <h1>Community needs assessments</h1>
          <p>Scope a geography, choose indicators, analyze vulnerability, review findings and produce an actionable assessment report.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot"></span>Demo environment
          </span>
          <button className="btn primary" id="as-new" onClick={() => setNewModalOpen(true)}>
            <Icon name="plus" size={14} />
            <span>New assessment</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Projects List (c-4) & Active Workspace (c-8) */}
      <div className="grid g-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px' }}>
        {/* Left Column: Assessment Projects List */}
        <section className="panel c-4" style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column' }}>
          <div className="panel-h" style={{ marginBottom: '12px' }}>
            <h3>Assessment projects</h3>
            <div className="seg">
              {(['All', 'Draft', 'In review', 'Completed'] as const).map(tab => (
                <button
                  key={tab}
                  className={statusFilter === tab ? 'on' : ''}
                  onClick={() => setStatusFilter(tab)}
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div id="as-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
            {filteredAssessments.length === 0 ? (
              <div className="empty" style={{ padding: '24px', textAlign: 'center' }}>
                <b>No assessment projects found</b>
                <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Click "+ New assessment" to begin a project.</span>
              </div>
            ) : (
              filteredAssessments.map((a) => {
                const isSelected = activeAssessment?._id === a._id;
                const progressPct = a.status === 'Completed' ? 100 : Math.max(15, (a.step - 1) * 20 + 15);

                return (
                  <button
                    key={a._id}
                    className="tool-tile"
                    onClick={() => setSelectedId(a._id)}
                    style={{
                      width: '100%',
                      padding: '14px',
                      borderRadius: '14px',
                      background: isSelected ? 'var(--surface-2)' : 'var(--surface-solid)',
                      border: isSelected ? '1.5px solid var(--cyan)' : '1px solid var(--line)',
                      boxShadow: isSelected ? '0 0 0 3px var(--glow)' : 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                      <b style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)' }}>{a.title}</b>
                      <span className={`pill ${a.status === 'Completed' ? 'ok' : a.status === 'In review' ? 'info' : 'warn'}`} style={{ fontSize: '10.5px' }}>
                        {a.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--muted)', width: '100%' }}>
                      <span className="note">{jurisdictions.find(j => j._id === a.jurisdictionId)?.name || 'County jurisdiction'}</span>
                      <span className="num">Due {formatRelativeTime(a.due)}</span>
                    </div>

                    <div className="prog" style={{ width: '100%', height: '5px', background: 'var(--line)', borderRadius: '3px', overflow: 'hidden' }}>
                      <i style={{ display: 'block', height: '100%', width: `${progressPct}%`, background: a.status === 'Completed' ? 'var(--teal)' : 'var(--cyan)' }} />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Assessment Workspace (c-8) */}
        <section className="panel c-8" id="as-ws" style={{ gridColumn: 'span 8', padding: '20px' }}>
          {activeAssessment ? (
            <>
              {/* Workspace Header */}
              <div className="panel-h" style={{ marginBottom: '14px' }}>
                <div>
                  <h3 style={{ fontSize: '19px', fontWeight: 700 }}>{activeAssessment.title}</h3>
                  <div className="sub">
                    {activeJur.name} • Template: {activeAssessment.template} • {tracts.length} tracts
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <select
                    className="input"
                    value={activeAssessment.status}
                    onChange={(e) => updateAssessment({ status: e.target.value as any })}
                    style={{ height: '34px', fontSize: '12px', borderRadius: '8px', padding: '0 8px' }}
                  >
                    <option value="Draft">Draft</option>
                    <option value="In review">In review</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              {/* Stepper Bar */}
              <div className="stepper" style={{ margin: '6px 0 20px', display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                {STEPS.map((sName, idx) => {
                  const stepNum = idx + 1;
                  const isDone = activeStep > stepNum || activeAssessment.status === 'Completed';
                  const isCur = activeStep === stepNum;

                  return (
                    <React.Fragment key={stepNum}>
                      {idx > 0 && <span className="step-sep" style={{ flex: 1, height: '2px', background: isDone ? 'var(--teal)' : 'var(--line)', minWidth: '12px' }} />}
                      <button
                        className={`step ${isDone ? 'done' : isCur ? 'cur' : ''}`}
                        onClick={() => setActiveStep(stepNum)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          border: 0,
                          background: 'none',
                          cursor: 'pointer',
                          padding: '4px 6px'
                        }}
                      >
                        <span
                          className="n"
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: isDone ? 'var(--teal)' : isCur ? 'var(--cyan)' : 'var(--surface-2)',
                            color: isDone || isCur ? '#fff' : 'var(--muted)',
                            border: isDone || isCur ? 'none' : '1px solid var(--line-strong)'
                          }}
                        >
                          {isDone ? '✓' : stepNum}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: isCur ? 700 : 500, color: isCur ? 'var(--text)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {sName}
                        </span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Step Content */}
              <div id="as-step" style={{ minHeight: '340px' }}>
                {activeStep === 1 && (
                  <div className="grid g-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px' }}>
                    <div className="c-7" style={{ gridColumn: 'span 7', position: 'relative', height: '320px', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--line)' }}>
                      <AssessmentTractMap
                        countyFips={activeAssessment.jurisdictionId}
                        tracts={tracts}
                        selectedTractIds={activeAssessment.focusTracts || []}
                        onToggleTract={handleToggleTract}
                        height={320}
                      />
                    </div>
                    <div className="c-5 stack" style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="kv">
                        <dt style={{ fontSize: '12px', color: 'var(--muted)' }}>Jurisdiction</dt>
                        <dd style={{ fontSize: '13.5px', fontWeight: 700, margin: '2px 0 8px' }}>{activeJur.name}</dd>
                        <dt style={{ fontSize: '12px', color: 'var(--muted)' }}>Census tracts</dt>
                        <dd style={{ fontSize: '13.5px', fontWeight: 700, margin: '2px 0 8px' }}>{tracts.length} tracts analyzed</dd>
                        <dt style={{ fontSize: '12px', color: 'var(--muted)' }}>Total Population</dt>
                        <dd style={{ fontSize: '13.5px', fontWeight: 700, margin: '2px 0 8px' }}>{(tracts.reduce((acc, t) => acc + (t.population || 4000), 0) || 2250000).toLocaleString()} residents</dd>
                        <dt style={{ fontSize: '12px', color: 'var(--muted)' }}>High-need tracts</dt>
                        <dd style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--rose)', margin: '2px 0 8px' }}>{tracts.filter(t => (t.tier ?? 0) >= 3).length} tracts</dd>
                      </div>
                    </div>
                  </div>
                )}

                {activeStep === 2 && (
                  <div>
                    <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '14px' }}>
                      Select domain indicators to prioritize for this assessment:
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                      {Object.keys(METRICS_CONFIG).slice(0, 12).map((key) => {
                        const m = METRICS_CONFIG[key];
                        const isChecked = activeAssessment.indicators.includes(key);

                        return (
                          <label
                            key={key}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 12px',
                              borderRadius: '10px',
                              background: isChecked ? 'rgba(0,144,194,0.06)' : 'var(--surface-2)',
                              border: isChecked ? '1px solid var(--cyan)' : '1px solid var(--line)',
                              cursor: 'pointer'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleIndicator(key)}
                              style={{ accentColor: 'var(--cyan)' }}
                            />
                            <div>
                              <b style={{ fontSize: '13px', display: 'block' }}>{m.label || key}</b>
                              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Domain: {m.short || key}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeStep === 3 && (
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Vulnerability Disparity Summary</h4>
                    <p style={{ fontSize: '12.5px', color: 'var(--muted)', marginBottom: '14px' }}>
                      Observed disparity ratios across prioritization indicators for {activeJur.name}:
                    </p>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Indicator</th>
                          <th className="r">Highest Quintile</th>
                          <th className="r">Lowest Quintile</th>
                          <th className="r">Disparity Gap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeAssessment.indicators.slice(0, 5).map((indKey) => (
                          <tr key={indKey}>
                            <td><b>{METRICS_CONFIG[indKey]?.label || indKey}</b></td>
                            <td className="r num" style={{ color: 'var(--rose)', fontWeight: 600 }}>18.4%</td>
                            <td className="r num">7.2%</td>
                            <td className="r num" style={{ fontWeight: 700, color: 'var(--cyan)' }}>2.56×</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeStep === 4 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ fontSize: '14px', margin: 0 }}>Tagged Assessment Findings ({activeAssessment.findings?.length || 0})</h4>
                      <Link href={`/census-tracts?county=${activeAssessment.jurisdictionId}`} className="btn sm">
                        <Icon name="search" size={13} />
                        <span>Find more in Explorer</span>
                      </Link>
                    </div>

                    {!activeAssessment.findings || activeAssessment.findings.length === 0 ? (
                      <div className="empty" style={{ padding: '32px 0', textAlign: 'center' }}>
                        <b>No findings recorded yet</b>
                        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '4px 0 12px' }}>
                          Tag findings from the Census Tract Explorer, Health Map, or Disparity screens.
                        </p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {activeAssessment.findings.map((f: any) => (
                          <div
                            key={f._id}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              padding: '12px 14px',
                              borderRadius: '12px',
                              background: 'var(--surface-2)',
                              border: '1px solid var(--line)'
                            }}
                          >
                            <div>
                              <b style={{ fontSize: '13px' }}>{f.tractName || `Tract ${f.tractId}`}</b>
                              <p style={{ fontSize: '12px', color: 'var(--text)', margin: '3px 0 0' }}>{f.note}</p>
                              <small style={{ fontSize: '10.5px', color: 'var(--faint)' }}>Added {formatRelativeTime(f.createdAt)}</small>
                            </div>
                            <button
                              onClick={() => handleRemoveFinding(f._id)}
                              className="icon-btn"
                              aria-label="Delete finding"
                              style={{ width: '26px', height: '26px' }}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeStep === 5 && (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <div
                      style={{
                        width: '54px',
                        height: '54px',
                        borderRadius: '50%',
                        background: '#EAF4FF',
                        color: 'var(--cyan)',
                        display: 'grid',
                        placeItems: 'center',
                        margin: '0 auto 14px'
                      }}
                    >
                      <Icon name="file" size={26} />
                    </div>
                    <h3 style={{ fontSize: '18px', fontWeight: 700 }}>Ready to Generate Assessment Report</h3>
                    <p style={{ fontSize: '13px', color: 'var(--muted)', maxWidth: '440px', margin: '6px auto 18px' }}>
                      Compile all scoping parameters, domain indicators, disparity findings, and priority tracts into an executive report.
                    </p>
                    <button
                      className="btn primary"
                      onClick={handleCompileReport}
                      disabled={isGenerating}
                      style={{ padding: '8px 24px', fontSize: '14px', margin: '0 auto' }}
                    >
                      {isGenerating ? 'Compiling Report...' : 'Compile & Export Report'}
                    </button>
                  </div>
                )}
              </div>

              {/* Step Navigation Footer */}
              <div
                className="modal-f"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '16px',
                  borderTop: '1px solid var(--line)',
                  marginTop: '16px'
                }}
              >
                <button
                  className="btn ghost"
                  disabled={activeStep === 1}
                  onClick={() => setActiveStep((prev) => Math.max(1, prev - 1))}
                >
                  Back
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    if (activeStep < 5) setActiveStep((prev) => prev + 1);
                    else handleCompileReport();
                  }}
                >
                  {activeStep === 5 ? 'Finish & View Reports' : `Continue to ${STEPS[activeStep]}`}
                </button>
              </div>
            </>
          ) : (
            <div className="empty" style={{ textAlign: 'center', padding: '48px 0' }}>
              <b>Select or create an assessment</b>
              <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                Assessments collect geography, indicators, observations and findings into an executive report.
              </p>
              <button className="btn primary mt" onClick={() => setNewModalOpen(true)}>
                <Icon name="plus" size={14} />
                <span>Create assessment</span>
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Create Assessment Modal */}
      {newModalOpen && (
        <div id="modal-root" className="open">
          <div className="modal-scrim" onClick={() => setNewModalOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" style={{ width: '500px', maxWidth: '90vw' }}>
            <div className="modal-h">
              <div>
                <h2>Create assessment</h2>
                <p>Set the scope and starting indicators. You can customize them anytime.</p>
              </div>
              <button className="icon-btn" onClick={() => setNewModalOpen(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateAssessment}>
              <div className="modal-b" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                    Assessment Title
                  </label>
                  <input
                    className="input"
                    type="text"
                    value={modalTitle}
                    onChange={(e) => setModalTitle(e.target.value)}
                    placeholder="e.g. 2026 Community Health Needs Assessment"
                    style={{ width: '100%', height: '38px', borderRadius: '10px', padding: '0 12px', fontSize: '13px' }}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                      Jurisdiction
                    </label>
                    <select
                      className="input"
                      value={modalJur}
                      onChange={(e) => setModalJur(e.target.value)}
                      style={{ width: '100%', height: '38px', borderRadius: '10px', padding: '0 8px', fontSize: '12.5px' }}
                    >
                      {jurisdictions.map((j) => (
                        <option key={j._id} value={j._id}>
                          {j.name}, {j.stateAbbr}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                      Due Date
                    </label>
                    <input
                      className="input"
                      type="date"
                      value={modalDue}
                      onChange={(e) => setModalDue(e.target.value)}
                      style={{ width: '100%', height: '38px', borderRadius: '10px', padding: '0 10px', fontSize: '12.5px' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>
                    Starting Template
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { id: 'chronic', label: 'Chronic Disease' },
                      { id: 'maternal', label: 'Maternal & Child' },
                      { id: 'custom', label: 'Comprehensive' }
                    ].map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => setModalTemplate(tpl.id as any)}
                        style={{
                          padding: '10px',
                          borderRadius: '10px',
                          background: modalTemplate === tpl.id ? '#EAF4FF' : 'var(--surface-2)',
                          border: modalTemplate === tpl.id ? '1.5px solid var(--cyan)' : '1px solid var(--line)',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: modalTemplate === tpl.id ? 'var(--cyan)' : 'var(--text)',
                          cursor: 'pointer'
                        }}
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-f" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn ghost" onClick={() => setNewModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={submittingModal}>
                  {submittingModal ? 'Creating...' : 'Create Assessment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
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
