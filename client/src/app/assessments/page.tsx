'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '@/context/SessionContext';
import { Assessment, CensusTract, Finding, Jurisdiction } from '@/types';
import { Icon } from '@/components/Icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { AssessmentTractMap } from '@/components/AssessmentTractMap';
import * as d3 from 'd3';

const A_STEPS = ['Geography', 'Indicators', 'Vulnerability analysis', 'Review findings', 'Generate report'];

const IND_GROUPS: [string, string[]][] = [
  ['Social determinants', ['poverty', 'childPoverty', 'income', 'rentBurden', 'noVehicle', 'noDiploma', 'unemployment', 'broadband']],
  ['Health outcomes', ['diabetes', 'hypertension', 'asthma', 'obesity', 'copd', 'lifeExp']],
  ['Access and programs', ['uninsured', 'pcp', 'driveTime', 'access', 'prog.wic', 'prog.imm', 'prog.dpp', 'prog.mhv']]
];

const METRICS: Record<string, { label: string; short: string; unit?: string }> = {
  svi: { label: 'Social vulnerability index', short: 'Vulnerability', unit: '' },
  sdoh: { label: 'SDOH composite burden', short: 'SDOH burden', unit: '/100' },
  poverty: { label: 'Population below poverty line', short: 'Poverty' },
  childPoverty: { label: 'Children below poverty line', short: 'Child poverty' },
  income: { label: 'Median household income', short: 'Median income' },
  rentBurden: { label: 'Rent-burdened households', short: 'Rent burden' },
  oldHousing: { label: 'Housing built before 1960', short: 'Pre-1960 housing' },
  crowding: { label: 'Overcrowded housing units', short: 'Crowding' },
  noVehicle: { label: 'Households without a vehicle', short: 'No vehicle' },
  transit: { label: 'Residents within ½ mile of transit', short: 'Transit access' },
  commute: { label: 'Mean commute time', short: 'Commute' },
  noDiploma: { label: 'Adults without a high school diploma', short: 'No diploma' },
  bachelors: { label: "Adults with a bachelor's degree", short: "Bachelor's+" },
  broadband: { label: 'Households with broadband', short: 'Broadband' },
  unemployment: { label: 'Unemployment rate', short: 'Unemployment' },
  lfp: { label: 'Labor force participation', short: 'Labor force' },
  uninsured: { label: 'Adults without health insurance', short: 'Uninsured' },
  pcp: { label: 'Primary care physicians per 100k', short: 'PCP per 100k' },
  driveTime: { label: 'Drive time to nearest clinic', short: 'Clinic drive time' },
  access: { label: 'Healthcare access score', short: 'Access score', unit: '/100' },
  diabetes: { label: 'Diagnosed diabetes prevalence', short: 'Diabetes' },
  asthma: { label: 'Current asthma prevalence', short: 'Asthma' },
  hypertension: { label: 'High blood pressure prevalence', short: 'Hypertension' },
  obesity: { label: 'Adult obesity prevalence', short: 'Obesity' },
  copd: { label: 'COPD prevalence', short: 'COPD' },
  lifeExp: { label: 'Life expectancy at birth', short: 'Life expectancy' },
  'prog.wic': { label: 'WIC nutrition utilization', short: 'WIC nutrition' },
  'prog.imm': { label: 'Childhood immunization utilization', short: 'Immunization' },
  'prog.dpp': { label: 'Diabetes prevention utilization', short: 'Diabetes prevention' },
  'prog.tob': { label: 'Tobacco cessation utilization', short: 'Tobacco cessation' },
  'prog.mhv': { label: 'Maternal home visiting utilization', short: 'Home visiting' }
};

const TEMPLATES: Record<string, { name: string; indicators: string[] }> = {
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
    indicators: ['svi', 'poverty']
  }
};

const TIER_COLOR = ['#9FE3E7', '#5CCAD2', '#66B6F5', '#2584EB', '#163E8C'];

const fmtK = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(1));

// Tooltip helpers matching standard MapWell #tooltip
function showTip(html: string, e: MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  moveTip(e);
}

function moveTip(e: MouseEvent) {
  const t = document.getElementById('tooltip');
  if (!t || !e) return;
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  let x = e.clientX + 16;
  let y = e.clientY + 14;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}

function hideTip() {
  const t = document.getElementById('tooltip');
  if (t) t.classList.remove('on');
}

const tipRows = (rows: [string, string][]) =>
  rows.map(([a, b]) => `<div class="tv"><span>${a}</span><span>${b}</span></div>`).join('');

// D3 Grouped Bar Chart for Step 3 (Prototype groupedBars lines 1481-1498)
function AssessmentGroupedBarChart({
  cats,
  series
}: {
  cats: string[];
  series: { name: string; color: string; values: number[] }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || series.length === 0 || cats.length === 0) return;
    el.innerHTML = '';
    el.classList.add('chart');

    const W = Math.max(200, el.clientWidth || 450);
    const H = 250;
    const m = { t: 14, r: 8, b: 30, l: 42 };
    const f = (x: number) => (x >= 100 ? fmtK(x) : x.toFixed(1));

    const svg = d3
      .select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .style('display', 'block')
      .style('overflow', 'visible');

    const x0 = d3.scaleBand().domain(cats).range([m.l, W - m.r]).padding(0.22);
    const x1 = d3.scaleBand().domain(series.map(s => s.name)).range([0, x0.bandwidth()]).padding(0.12);

    const maxVal = d3.max(series, s => d3.max(s.values)) || 25;
    const y = d3.scaleLinear().domain([0, maxVal * 1.12]).nice().range([H - m.b, m.t]);

    // Gridlines
    svg
      .append('g')
      .attr('class', 'gridl')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(() => ''));

    // Left Axis
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat((d: any) => f(Number(d))).tickSize(0))
      .call(g => g.select('.domain').remove());

    // Bottom Axis
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x0).tickSize(0).tickPadding(8))
      .call(g => g.select('.domain').remove());

    series.forEach((s, si) => {
      const r = svg
        .append('g')
        .selectAll('rect')
        .data(s.values)
        .join('rect')
        .attr('x', (_, i) => (x0(cats[i]) ?? 0) + (x1(s.name) ?? 0))
        .attr('width', x1.bandwidth())
        .attr('rx', Math.min(2, x1.bandwidth() / 3))
        .attr('fill', s.color)
        .attr('y', y(0))
        .attr('height', 0)
        .style('cursor', 'pointer');

      r.transition()
        .duration(850)
        .delay((_, i) => i * 80 + si * 120)
        .ease(d3.easeCubicOut)
        .attr('y', d => y(d))
        .attr('height', d => Math.max(1, y(0) - y(d)));

      r.on('pointerenter', function (e: MouseEvent, d) {
        const i = s.values.indexOf(d);
        showTip(`<b>${cats[i]}</b>${tipRows([[s.name, f(d)]])}`, e);
      })
        .on('pointermove', function (e: MouseEvent) {
          moveTip(e);
        })
        .on('pointerleave', function () {
          hideTip();
        });
    });

    return () => {
      hideTip();
    };
  }, [cats, series]);

  return <div ref={containerRef} style={{ width: '100%', minHeight: '250px' }} />;
}

function AssessmentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramOpen = searchParams.get('open');
  const paramCreate = searchParams.get('create') || searchParams.get('new');

  const { activeCounty, jurisdictions, session, markWorkflowMilestone, theme } = useSession();

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(paramOpen || null);
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [step, setStep] = useState<number>(1);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Draft' | 'In review' | 'Completed'>('All');
  const [, setLoading] = useState<boolean>(true);

  // Census Tracts for current jurisdiction
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

  // Set default modal title when active county changes
  useEffect(() => {
    if (activeCounty?.name) {
      setModalTitle(`Community needs assessment, ${activeCounty.name} ${new Date().getFullYear() + 1}`);
    }
  }, [activeCounty?.name]);

  // Handle URL ?create=true
  useEffect(() => {
    if (paramCreate) {
      setNewModalOpen(true);
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/assessments');
      }
    }
  }, [paramCreate]);

  // Sync modal open state to document body (for page blur & non-scrollable) and #modal-root
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const modalRoot = document.getElementById('modal-root');
    if (newModalOpen) {
      document.body.classList.add('modal-open');
      modalRoot?.classList.add('open');
    } else {
      document.body.classList.remove('modal-open');
      modalRoot?.classList.remove('open');
    }
    return () => {
      document.body.classList.remove('modal-open');
      modalRoot?.classList.remove('open');
    };
  }, [newModalOpen]);

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

    fetch(`/api/assessments/${selectedId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data) {
          setActiveAssessment(data);
          setStep(data.status === 'Completed' ? 5 : data.step || 1);
        }
      })
      .catch(err => console.error(err));
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
    const nextTracts = exists ? current.filter(id => id !== t._id) : [...current, t._id];

    updateAssessment({ focusTracts: nextTracts });
  };

  const handleAddHighVuln = () => {
    if (!activeAssessment || tracts.length === 0) return;
    const highTier = tracts.filter(t => (t.tier ?? Math.min(4, Math.floor(t.svi * 5))) >= 3).map(t => t._id);
    const combined = Array.from(new Set([...(activeAssessment.focusTracts || []), ...highTier]));
    updateAssessment({ focusTracts: combined });
  };

  const handleAddFlagged = () => {
    if (!activeAssessment) return;
    const jurId = activeAssessment.jurisdictionId || activeCounty?._id || '53033';
    const flagged = (session?.flaggedTracts || []).filter(f => f.startsWith(jurId));
    const combined = Array.from(new Set([...(activeAssessment.focusTracts || []), ...flagged]));
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
    const nextIndicators = exists ? current.filter(k => k !== key) : [...current, key];

    updateAssessment({ indicators: nextIndicators });
  };

  // Step 3: Comparative Calculations
  const focusTractList = useMemo(() => {
    if (!activeAssessment) return [];
    const focusIds = new Set(activeAssessment.focusTracts || []);
    if (focusIds.size === 0) {
      return tracts.filter(t => (t.tier ?? Math.min(4, Math.floor(t.svi * 5))) >= 3);
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
    const categories = inds.map(k => METRICS[k]?.short || k);

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
          color: 'var(--rose)',
          values: focusVals
        },
        {
          name: 'Rest of county',
          color: 'var(--teal)',
          values: restVals
        }
      ]
    };
  }, [activeAssessment, focusTractList, restTractList]);

  // Top focus tracts sorted by SVI descending for Step 3 table
  const topRankedFocusTracts = useMemo(() => {
    return [...focusTractList].sort((a, b) => b.svi - a.svi).slice(0, 12);
  }, [focusTractList]);

  const focusResidents = useMemo(() => {
    return focusTractList.reduce((acc, t) => acc + (t.population || 4000), 0);
  }, [focusTractList]);

  const totalResidents = useMemo(() => {
    return tracts.reduce((acc, t) => acc + (t.population || 4000), 0) || 1;
  }, [tracts]);

  const focusPct = Math.round((focusResidents / totalResidents) * 100);

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
        setToastMessage(`Report generated: ${result.reportId}`);
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
        setToastMessage(`Draft assessment created`);
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
      activeCounty || { _id: jurId, name: 'King', stateAbbr: 'WA' }
    );
  }, [activeAssessment, jurisdictions, activeCounty]);

  const flaggedInJurCount = useMemo(() => {
    const jurId = activeAssessment?.jurisdictionId || activeCounty?._id || '53033';
    return (session?.flaggedTracts || []).filter(f => f.startsWith(jurId)).length;
  }, [activeAssessment, activeCounty, session]);

  const findings = activeAssessment?.findings || [];

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast" role="status" style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 200 }}>
          <span className="ic"><Icon name="check" size={15} /></span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header matching prototype lines 2476-2477 */}
      <div className="page-head">
        <div>
          <h1>Community needs assessments</h1>
          <p>
            Scope a geography, choose indicators, analyze vulnerability, review findings, then generate the assessment
            report.
          </p>
        </div>
        <div className="head-actions">
          <span
            className="pill demo"
            title="Synthetic values generated for this demo. Not real surveillance or Census data."
          >
            <span className="dot"></span>Synthetic demo data
          </span>
          <button className="btn primary" id="as-new" onClick={() => setNewModalOpen(true)}>
            <Icon name="plus" size={14} />
            <span>New assessment</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Projects List (c-4) & Active Workspace (c-8) matching prototype lines 2478-2479 */}
      <div className="grid g-12">
        {/* Left Column: Assessment Projects List */}
        <section className="panel c-4">
          <div className="panel-h">
            <h3>Assessment projects</h3>
            <div className="seg" id="as-f">
              {(['All', 'Draft', 'In review', 'Completed'] as const).map(f => (
                <button
                  key={f}
                  className={statusFilter === f ? 'on' : ''}
                  onClick={() => setStatusFilter(f)}
                  data-f={f}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="stack" id="as-list">
            {filteredAssessments.length === 0 ? (
              <div className="empty">
                <b>No {statusFilter.toLowerCase()} assessments</b>Create one to start scoping a community.
              </div>
            ) : (
              filteredAssessments.map(a => {
                const isSelected = selectedId === a._id;
                const jur = jurisdictions.find(j => j._id === a.jurisdictionId) || activeCounty;
                const jurName = jur?.name || 'County';
                const jurAbbr = jur?.stateAbbr || 'WA';
                const fCount = a.findingsCount ?? (a.findings ? a.findings.length : 0);
                const progressPct = a.status === 'Completed' ? 100 : (a.step - 1) * 20 + 10;

                return (
                  <button
                    key={a._id}
                    className="tool-tile"
                    data-a={a._id}
                    onClick={() => setSelectedId(a._id)}
                    style={{
                      padding: '14px',
                      gap: '8px',
                      borderColor: isSelected ? 'var(--cyan)' : undefined,
                      boxShadow: isSelected ? '0 0 0 3px var(--glow)' : undefined
                    }}
                  >
                    <div className="row between" style={{ width: '100%', flexWrap: 'nowrap' }}>
                      <b style={{ fontSize: '13.5px' }}>{a.title}</b>
                      <span
                        className={`pill ${
                          a.status === 'Completed'
                            ? 'ok'
                            : a.status === 'In review'
                            ? 'info'
                            : a.status === 'Published'
                            ? 'ok'
                            : 'warn'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>

                    <div className="row between" style={{ width: '100%' }}>
                      <span className="note">
                        {a._id}. {jurName} County, {jurAbbr}
                      </span>
                      <span className="note">{fCount} findings</span>
                    </div>

                    <div className="prog" style={{ width: '100%' }}>
                      <i style={{ width: `${progressPct}%` }} />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Assessment Workspace (c-8) matching prototype lines 2488-2548 */}
        <section className="panel c-8" id="as-ws">
          {activeAssessment ? (
            <>
              {/* Workspace Header matching prototype line 2495 */}
              <div className="panel-h">
                <div>
                  <h3 style={{ fontSize: '19px' }}>{activeAssessment.title}</h3>
                  <div className="sub">
                    {activeAssessment._id}. {activeJur.name} County, {activeJur.stateAbbr}. Owner:{' '}
                    {activeAssessment.owner || 'Public Health Analyst'}
                    {activeAssessment.due ? `. Due ${activeAssessment.due}` : ''}
                  </div>
                </div>
                <span
                  className={`pill ${
                    activeAssessment.status === 'Completed'
                      ? 'ok'
                      : activeAssessment.status === 'In review'
                      ? 'info'
                      : activeAssessment.status === 'Published'
                      ? 'ok'
                      : 'warn'
                  }`}
                >
                  {activeAssessment.status}
                </span>
              </div>

              {/* Stepper Bar matching prototype line 2496 */}
              <div className="stepper" style={{ margin: '6px 0 20px' }}>
                {A_STEPS.map((n, i) => {
                  const stepNum = i + 1;
                  const isDone = stepNum < step || activeAssessment.status === 'Completed';
                  const isCur = stepNum === step;

                  return (
                    <React.Fragment key={n}>
                      {i > 0 && <span className="step-sep" />}
                      <button
                        className={`step ${isDone ? 'done' : isCur ? 'cur' : ''}`}
                        data-s={stepNum}
                        onClick={() => setStep(stepNum)}
                        style={{ border: 0, background: 'none' }}
                      >
                        <span className="n">
                          {isDone ? <Icon name="check" size={13} /> : stepNum}
                        </span>
                        <span className="lbl">{n}</span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Step Content matching prototype lines 2500-2543 */}
              <div id="as-step">
                {/* Step 1: Geography matching prototype lines 2500-2509 */}
                {step === 1 && (
                  <div className="grid g-12">
                    <div
                      className="c-7"
                      style={{
                        position: 'relative',
                        height: '320px',
                        borderRadius: '16px',
                        border: '1px solid var(--line)',
                        overflow: 'hidden'
                      }}
                    >
                      <div id="as-map" style={{ position: 'absolute', inset: 0 }}>
                        <AssessmentTractMap
                          countyFips={activeAssessment.jurisdictionId}
                          tracts={tracts}
                          selectedTractIds={activeAssessment.focusTracts || []}
                          onToggleTract={handleToggleTract}
                          height={320}
                          theme={theme}
                        />
                      </div>
                      <div className="map-float" style={{ left: '10px', top: '10px', padding: '8px 12px', fontSize: '12px' }}>
                        <b>Click tracts to include or exclude them</b>
                      </div>
                    </div>

                    <div className="c-5 stack">
                      <div className="kv">
                        <dt>Jurisdiction</dt>
                        <dd>{activeJur.name} County, {activeJur.stateAbbr}</dd>
                        <dt>Tracts in jurisdiction</dt>
                        <dd>{tracts.length}</dd>
                        <dt>Focus tracts selected</dt>
                        <dd id="as-nt">{(activeAssessment.focusTracts || []).length}</dd>
                        <dt>Residents in focus tracts</dt>
                        <dd id="as-np">{focusResidents.toLocaleString()}</dd>
                      </div>
                      <button className="btn" id="as-hi" onClick={handleAddHighVuln}>
                        <Icon name="flag" size={14} />
                        Add all high-vulnerability tracts
                      </button>
                      <button className="btn" id="as-fl" onClick={handleAddFlagged}>
                        <Icon name="flag" size={14} />
                        Add flagged tracts ({flaggedInJurCount})
                      </button>
                      <button className="btn ghost" id="as-clr" onClick={handleClearFocus}>
                        Clear focus tracts
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2: Indicators matching prototype lines 2510-2512 */}
                {step === 2 && (
                  <div className="grid g-12">
                    {IND_GROUPS.map(([groupName, keys]) => (
                      <div key={groupName} className="c-4">
                        <h4 style={{ fontSize: '13px', marginBottom: '8px' }}>{groupName}</h4>
                        <div className="stack" style={{ gap: '8px' }}>
                          {keys.map(k => {
                            const meta = METRICS[k] || { short: k, label: k };
                            const checked = (activeAssessment.indicators || []).includes(k);
                            return (
                              <label key={k} className="check">
                                <input
                                  type="checkbox"
                                  value={k}
                                  checked={checked}
                                  onChange={() => handleToggleIndicator(k)}
                                />
                                <span>
                                  {meta.short}
                                  <small>{meta.label}</small>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Step 3: Vulnerability Analysis matching prototype lines 2513-2520 */}
                {step === 3 && (
                  <div className="grid g-12">
                    <div className="c-7">
                      <div className="panel-h">
                        <div>
                          <h3>Focus tracts against the jurisdiction</h3>
                          <div className="sub">
                            {focusTractList.length} focus tracts
                            {(activeAssessment.focusTracts || []).length
                              ? ''
                              : ' (high-vulnerability tracts, since none were selected)'}
                          </div>
                        </div>
                      </div>
                      <div id="as-ch">
                        <AssessmentGroupedBarChart
                          cats={compChartData.categories}
                          series={compChartData.series}
                        />
                      </div>
                      <div className="legend-row">
                        <span>
                          <i style={{ background: 'var(--rose)' }}></i>Focus tracts
                        </span>
                        <span>
                          <i style={{ background: 'var(--teal)' }}></i>Rest of {activeJur.name}
                        </span>
                      </div>
                    </div>

                    <div className="c-5">
                      <div className="tbl-wrap" style={{ maxHeight: '300px', overflow: 'auto' }}>
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th>Tract</th>
                              <th className="r">Vulnerability</th>
                              <th className="r">Need score</th>
                            </tr>
                          </thead>
                          <tbody>
                            {topRankedFocusTracts.map(t => (
                              <tr key={t._id}>
                                <td>{t.name.replace('Census Tract ', '')}</td>
                                <td className="r num">
                                  <i
                                    className="tier"
                                    style={{
                                      background:
                                        TIER_COLOR[t.tier ?? Math.min(4, Math.floor(t.svi * 5))]
                                    }}
                                  />
                                  {t.svi.toFixed(2)}
                                </td>
                                <td className="r num">
                                  {Math.round(
                                    t.svi * 60 +
                                      (100 - (t.indicators?.access ?? (t as any).access ?? 65)) * 0.4
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="insight mt">
                        <span className="ic">
                          <Icon name="spark" size={16} />
                        </span>
                        <p>
                          Focus tracts hold <b>{focusResidents.toLocaleString()}</b> residents, {focusPct}% of
                          the jurisdiction.<small>Synthetic demo values</small>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Review Findings matching prototype lines 2521-2526 */}
                {step === 4 && (
                  <div>
                    {findings.length ? (
                      <div className="stack">
                        {findings.map(f => {
                          const findingAny = f as any;
                          const tName = f.tractName || findingAny.name || `Tract ${f.tractId}`;
                          const cName = f.countyLabel || findingAny.county || activeJur.name;
                          const geoid = f.tractId || findingAny.tract || '';
                          const sviVal = Number(f.snapshot?.svi ?? findingAny.svi ?? 0.65).toFixed(2);
                          const uninsVal = Number(f.snapshot?.uninsured ?? findingAny.uninsured ?? 8.5).toFixed(1);
                          const diabVal = Number(f.snapshot?.diabetes ?? findingAny.diabetes ?? 10.4).toFixed(1);
                          const addedVal = f.addedDate || findingAny.added || (f.createdAt ? new Date(f.createdAt).toISOString().slice(0, 10) : 'recently');

                          return (
                            <div
                              key={f._id}
                              className="li"
                              style={{ alignItems: 'flex-start', gap: '14px' }}
                            >
                              <span className="ic">
                                <Icon name="flag" size={16} />
                              </span>
                              <div className="b">
                                <b>
                                  {tName}, {cName}
                                </b>
                                <div style={{ fontSize: '13px', margin: '4px 0', whiteSpace: 'normal' }}>
                                  {f.note}
                                </div>
                                <small>
                                  GEOID {geoid}. Vulnerability {sviVal}. Uninsured {uninsVal}%. Diabetes {diabVal}%. Added {addedVal}
                                </small>
                              </div>
                              <button
                                className="btn sm ghost danger"
                                onClick={() => handleRemoveFinding(f._id)}
                              >
                                <Icon name="trash" size={13} />
                                Remove
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="empty">
                        <b>No findings yet</b>Flag an underserved tract on the health map or in the tract
                        explorer, then choose Add finding to assessment.
                        <div className="row mt" style={{ justifyContent: 'center', gap: '10px' }}>
                          <button className="btn" onClick={() => router.push('/health-map')}>
                            <Icon name="map" size={14} />
                            Open health map
                          </button>
                          <button className="btn" onClick={() => router.push('/census-tracts')}>
                            <Icon name="grid" size={14} />
                            Open tract explorer
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 5: Generate Report matching prototype lines 2527-2543 */}
                {step === 5 && (
                  <div className="grid g-12">
                    <div className="c-7">
                      <div className="report-paper">
                        <h2 style={{ fontSize: '18px' }}>{activeAssessment.title}</h2>
                        <p>
                          {activeJur.name} County, {activeJur.stateAbbr}.{' '}
                          {(activeAssessment.focusTracts || []).length || 'All high-vulnerability'} focus tracts,{' '}
                          {(activeAssessment.indicators || []).length} indicators, {findings.length} findings.
                        </p>
                        <h4>Indicators</h4>
                        <div className="chips">
                          {(activeAssessment.indicators || []).map(k => (
                            <span key={k} className="chip">
                              {METRICS[k]?.short || k}
                            </span>
                          ))}
                        </div>
                        <h4>Key findings</h4>
                        {findings.length ? (
                          findings.slice(0, 3).map((f, i) => <p key={i}>• {f.note}</p>)
                        ) : (
                          <p>No findings recorded. The report will include the vulnerability analysis only.</p>
                        )}
                      </div>
                    </div>

                    <div className="c-5 stack">
                      <div className="kv">
                        <dt>Status</dt>
                        <dd>{activeAssessment.status}</dd>
                        <dt>Report</dt>
                        <dd>{generatedReportId || 'Not generated'}</dd>
                      </div>
                      <button
                        className="btn primary"
                        id="as-gen"
                        onClick={handleCompileReport}
                        disabled={isGenerating}
                      >
                        <Icon name={isGenerating ? 'refresh' : 'file'} size={14} />
                        {isGenerating
                          ? 'Generating…'
                          : generatedReportId
                          ? 'Regenerate report'
                          : 'Generate assessment report'}
                      </button>
                      {generatedReportId && (
                        <button
                          className="btn"
                          onClick={() => router.push(`/reports?open=${generatedReportId}`)}
                        >
                          <Icon name="eye" size={14} />
                          Open report
                        </button>
                      )}
                      <p className="note">
                        Generating a report marks the assessment completed and adds the report to Reports &amp;
                        exports.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Step Navigation Footer matching prototype line 2498 */}
              <div className="modal-f" style={{ marginTop: '16px' }}>
                <button
                  className="btn ghost"
                  id="as-back"
                  disabled={step === 1}
                  onClick={handlePrevStep}
                >
                  Back
                </button>
                <div className="row">
                  {step < 5 && (
                    <button className="btn primary" id="as-next" onClick={handleNextStep}>
                      Continue to {A_STEPS[step].toLowerCase()}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="empty">
              <b>Select or create an assessment</b>Assessments collect geography, indicators and findings into a report.
            </div>
          )}
        </section>
      </div>

      {/* Create Assessment Modal matching prototype lines 2454-2470 */}
      {newModalOpen && typeof document !== 'undefined' && document.getElementById('modal-root') &&
        createPortal(
          <>
            <div className="modal-scrim" onClick={() => setNewModalOpen(false)} />
            <div className="modal" role="dialog" aria-modal="true">
              <div className="modal-h">
                <div>
                  <h2>Create assessment</h2>
                  <p>Set the scope and starting indicators. You can change them later.</p>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => setNewModalOpen(false)}
                  aria-label="Close"
                >
                  <Icon name="x" size={16} />
                </button>
              </div>

              <div className="stack">
                <label className="field">
                  Assessment name
                  <input
                    className="input"
                    id="na-t"
                    value={modalTitle}
                    onChange={e => setModalTitle(e.target.value)}
                  />
                </label>

                <div className="grid g-12" style={{ gap: '12px' }}>
                  <label className="field c-6 c-lg-6">
                    Jurisdiction
                    <select
                      className="input"
                      id="na-j"
                      value={modalJur}
                      onChange={e => setModalJur(e.target.value)}
                    >
                      {jurisdictions.map(c => (
                        <option key={c._id} value={c._id}>
                          {c.name} County, {c.stateAbbr}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field c-6 c-lg-6">
                    Due date
                    <input
                      type="date"
                      className="input"
                      id="na-d"
                      value={modalDue}
                      onChange={e => setModalDue(e.target.value)}
                    />
                  </label>
                </div>

                <div className="field">
                  <span>Starting template</span>
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}
                  >
                    {Object.entries(TEMPLATES).map(([k, meta]) => (
                      <label key={k} className="check">
                        <input
                          type="radio"
                          name="na-tp"
                          value={k}
                          checked={modalTemplate === k}
                          onChange={() => setModalTemplate(k as any)}
                        />
                        <span>
                          {meta.name}
                          <small>{meta.indicators.length} indicators</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-f">
                <button className="btn ghost" onClick={() => setNewModalOpen(false)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  id="na-go"
                  onClick={handleCreateAssessment}
                  disabled={submittingModal}
                >
                  <Icon name="plus" size={14} />
                  Create draft
                </button>
              </div>
            </div>
          </>,
          document.getElementById('modal-root')!
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
