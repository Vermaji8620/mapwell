'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { Report, CensusTract, Assessment, Finding } from '@/types';
import { METRICS_CONFIG, TIER_COLORS, TIER_LABELS } from '@/config/metrics';
import {
  FileText,
  Plus,
  Download,
  Search,
  Check,
  Trash2,
  Copy,
  ExternalLink,
  Sparkles,
  Layers,
  ChevronRight,
  Filter,
  X,
  Eye,
  Activity
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ReportMap } from '@/components/ReportMap';
import { BarChart, BarDatum } from '@/components/BarChart';

const REPORT_TYPES = ['All', 'Vulnerability brief', 'Program review', 'Assessment summary'] as const;

function ReportsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramOpen = searchParams.get('open');

  const { activeCounty, jurisdictions, markWorkflowMilestone } = useSession();

  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(paramOpen || null);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [fromAssessment, setFromAssessment] = useState<Assessment | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Draft' | 'Published'>('All');
  const [loading, setLoading] = useState<boolean>(true);

  // Modal State
  const [newModalOpen, setNewModalOpen] = useState<boolean>(false);
  const [modalTitle, setModalTitle] = useState<string>('');
  const [modalType, setModalType] = useState<string>('Vulnerability brief');
  const [modalMetric, setModalMetric] = useState<string>('svi');
  const [modalSource, setModalSource] = useState<string>('');
  const [assessmentsList, setAssessmentsList] = useState<Assessment[]>([]);
  const [submittingModal, setSubmittingModal] = useState<boolean>(false);

  // Delete Confirmation Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mark workflow milestone on load
  useEffect(() => {
    markWorkflowMilestone('export');
  }, [markWorkflowMilestone]);

  // Load Reports
  const loadReports = async () => {
    try {
      const res = await fetch('/api/reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data);
        if (data.length > 0 && !selectedId) {
          setSelectedId(data[0]._id);
        }
      }
    } catch (e) {
      console.error('Failed to load reports:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  // Load Assessments for Modal
  useEffect(() => {
    fetch('/api/assessments')
      .then(r => (r.ok ? r.json() : []))
      .then(data => setAssessmentsList(data))
      .catch(e => console.error(e));
  }, []);

  // Load specific active report
  useEffect(() => {
    if (!selectedId) return;

    fetch(`/api/reports/${selectedId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data) {
          setActiveReport(data);

          // Load county tracts
          const jurId = data.jurisdictionId || activeCounty?._id || '53033';
          fetch(`/api/tracts?county=${jurId}`)
            .then(r => (r.ok ? r.json() : { data: [] }))
            .then(res => setTracts(res.data || []))
            .catch(e => console.error(e));

          // Load attached assessment if any
          if (data.fromAssessmentId) {
            fetch(`/api/assessments/${data.fromAssessmentId}`)
              .then(r => (r.ok ? r.json() : null))
              .then(ass => setFromAssessment(ass))
              .catch(e => console.error(e));
          } else {
            setFromAssessment(null);
          }
        }
      })
      .catch(e => console.error(e));
  }, [selectedId, activeCounty]);

  // Active county meta
  const countyMeta = useMemo(() => {
    const jurId = activeReport?.jurisdictionId || activeCounty?._id || '53033';
    return (
      jurisdictions.find(j => j._id === jurId) ||
      activeCounty || { _id: jurId, name: 'County', stateAbbr: 'WA' }
    );
  }, [activeReport, jurisdictions, activeCounty]);

  // Filtered reports list
  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const matchType = typeFilter === 'All' || r.type === typeFilter;
      const matchStatus = statusFilter === 'All' || r.status === statusFilter;
      const matchQ =
        !searchQuery.trim() ||
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r._id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchType && matchStatus && matchQ;
    });
  }, [reports, typeFilter, statusFilter, searchQuery]);

  // Focus Tracts Cohort
  const focusTractList = useMemo(() => {
    if (!activeReport) return [];
    if (activeReport.focusTracts && activeReport.focusTracts.length > 0) {
      const ids = new Set(activeReport.focusTracts.map(t => (typeof t === 'string' ? t : t.id || t._id)));
      return tracts.filter(t => ids.has(t._id));
    }
    if (fromAssessment && fromAssessment.focusTracts && fromAssessment.focusTracts.length > 0) {
      const ids = new Set(fromAssessment.focusTracts);
      return tracts.filter(t => ids.has(t._id));
    }
    // Fallback: top high-vulnerability tracts
    return tracts.filter(t => (t.tier ?? 0) >= 3);
  }, [activeReport, fromAssessment, tracts]);

  const focusTractIds = useMemo(() => {
    return focusTractList.map(t => t._id);
  }, [focusTractList]);

  // Primary metric configuration
  const activeMetricKey = activeReport?.primaryMetric || 'svi';
  const metricMeta = useMemo(() => {
    return METRICS_CONFIG[activeMetricKey] || { label: activeMetricKey, short: activeMetricKey, unit: '%' };
  }, [activeMetricKey]);

  const getMetricVal = (t: CensusTract): number => {
    if (activeMetricKey.startsWith('prog.')) {
      const pk = activeMetricKey.replace('prog.', '');
      return (t.prog as any)?.[pk] ?? 50;
    }
    const val = (t.indicators as any)?.[activeMetricKey] ?? (t as any)[activeMetricKey] ?? t.svi;
    return typeof val === 'number' ? val : 0;
  };

  // Vulnerability Tier distribution data for BarChart
  const tierDistributionData: BarDatum[] = useMemo(() => {
    if (tracts.length === 0) return [];

    return [0, 1, 2, 3, 4].map(tierIndex => {
      const tierTracts = tracts.filter(t => (t.tier ?? 0) === tierIndex);
      const avg =
        tierTracts.length > 0
          ? tierTracts.reduce((acc, t) => acc + getMetricVal(t), 0) / tierTracts.length
          : 0;

      return {
        label: TIER_LABELS[tierIndex]?.replace(' Vulnerability', '') || `Tier ${tierIndex}`,
        value: Math.round(avg * 10) / 10,
        color: TIER_COLORS[tierIndex] || '#37C8CF'
      };
    });
  }, [tracts, activeMetricKey]);

  // Actions: Publish Report
  const handlePublish = async () => {
    if (!activeReport) return;
    try {
      const res = await fetch(`/api/reports/${activeReport._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Published' })
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveReport(updated);
        setReports(prev => prev.map(r => (r._id === updated._id ? updated : r)));
        setToastMessage(`Report ${updated._id} published`);
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Actions: Duplicate Report
  const handleDuplicate = async () => {
    if (!activeReport) return;
    try {
      const res = await fetch(`/api/reports/${activeReport._id}/duplicate`, {
        method: 'POST'
      });
      if (res.ok) {
        const dup = await res.json();
        setReports(prev => [dup, ...prev]);
        setSelectedId(dup._id);
        setToastMessage(`Duplicated report as ${dup._id}`);
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Actions: Delete Report
  const handleDelete = async () => {
    if (!activeReport) return;
    try {
      const res = await fetch(`/api/reports/${activeReport._id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const nextList = reports.filter(r => r._id !== activeReport._id);
        setReports(nextList);
        setSelectedId(nextList[0]?._id || null);
        setDeleteModalOpen(false);
        setToastMessage(`Report ${activeReport._id} deleted`);
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Multi-format Exporter using secure blob download
  const handleExportAs = async (format: 'html' | 'csv' | 'json' | 'md') => {
    if (!activeReport) return;

    try {
      markWorkflowMilestone('export');
      const url = `/api/reports/${activeReport._id}/export?format=${format}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Export request failed');

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.setAttribute(
        'download',
        `${activeReport._id}-${activeReport.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${format}`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);

      setToastMessage(`Exported report as ${format.toUpperCase()}`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      console.error(err);
      alert('Failed to download report export.');
    }
  };

  // Create New Report Modal Submit
  const handleCreateReport = async () => {
    if (!modalTitle.trim()) return;
    setSubmittingModal(true);

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: modalTitle.trim(),
          type: modalType,
          fromAssessmentId: modalSource || null,
          jurisdictionId: activeCounty?._id || '53033',
          primaryMetric: modalMetric
        })
      });

      if (res.ok) {
        const created = await res.json();
        setReports(prev => [created, ...prev]);
        setSelectedId(created._id);
        setNewModalOpen(false);
        setToastMessage(`Report created: ${created._id}`);
        setTimeout(() => setToastMessage(null), 4000);
      } else {
        alert('Failed to create report');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmittingModal(false);
    }
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
            Reports & exports
          </h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Review saved reports, preview their maps and tables, and export them for partners and boards.
          </p>
        </div>

        <button
          onClick={() => {
            setModalTitle(`${activeCounty?.name || 'County'} vulnerability brief`);
            setNewModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--cyan)] text-white hover:opacity-90 text-[12.5px] font-bold shadow-xs transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New report</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-2xl glass-panel">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[var(--faint)] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search report title or ID..."
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Type Dropdown */}
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-[var(--faint)] font-bold">Type:</span>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="h-9 px-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12px] text-[var(--text)] font-semibold outline-none focus:border-[var(--cyan)]"
            >
              {REPORT_TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Status Segmented Buttons */}
          <div className="flex rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-0.5 text-[11.5px] font-bold">
            {(['All', 'Draft', 'Published'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  statusFilter === s
                    ? 'bg-[var(--surface-solid)] text-[var(--text)] shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Grid: Col 4 (Saved Reports List) & Col 8 (Report Document & Exports) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col (Col 4): Saved Reports List */}
        <section className="lg:col-span-4 rounded-2xl glass-panel p-5 flex flex-col justify-between min-h-[600px]">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
              <h3 className="text-base font-bold text-[var(--text)]">Saved reports</h3>
              <span className="text-[11px] font-bold text-[var(--muted)] num">
                {filteredReports.length} of {reports.length}
              </span>
            </div>

            <div className="space-y-2.5 mt-3 max-h-[500px] overflow-y-auto pr-1">
              {filteredReports.length === 0 ? (
                <div className="py-12 text-center text-[12px] text-[var(--muted)]">
                  No reports match filter criteria.
                </div>
              ) : (
                filteredReports.map(r => {
                  const isSelected = r._id === selectedId;
                  const dateStr = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'Recent';

                  return (
                    <div
                      key={r._id}
                      onClick={() => setSelectedId(r._id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                        isSelected
                          ? 'bg-[var(--glow)]/70 border-[var(--cyan)] shadow-sm'
                          : 'bg-[var(--surface-solid)]/60 border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[13px] text-[var(--text)] leading-snug line-clamp-1">
                          {r.title}
                        </strong>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${
                            r.status === 'Published'
                              ? 'bg-[var(--teal)]/20 text-[var(--teal)]'
                              : 'bg-[var(--amber)]/20 text-[var(--amber)]'
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                        <span>
                          {r._id} • {r.type}
                        </span>
                        <span className="num">{dateStr}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            Select a report to preview document and export across data formats
          </div>
        </section>

        {/* Right Col (Col 8): Report Document & Export Bar */}
        <section className="lg:col-span-8 flex flex-col gap-4">
          {/* Top Export & Action Control Bar */}
          <div className="p-3.5 rounded-2xl glass-panel flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Status & Lifecycle Actions */}
            <div className="flex items-center gap-2">
              {activeReport?.status === 'Draft' ? (
                <button
                  onClick={handlePublish}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--cyan)] text-white hover:opacity-90 text-[12px] font-bold shadow-xs transition-all"
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Publish</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--teal)]/15 border border-[var(--teal)]/30 text-[var(--teal)] text-[12px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--teal)]" />
                  <span>Published</span>
                </span>
              )}

              <button
                onClick={handleDuplicate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:bg-[var(--surface-solid)] text-[12px] font-bold text-[var(--text)] transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Duplicate</span>
              </button>

              <button
                onClick={() => setDeleteModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-transparent hover:bg-[var(--rose)]/15 text-[12px] font-bold text-[var(--rose)] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>

            {/* Export Multi-Format Buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-[var(--faint)] uppercase mr-1">Export:</span>
              <button
                onClick={() => handleExportAs('html')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-solid)] hover:bg-[var(--surface-2)] text-[11.5px] font-bold text-[var(--text)] transition-colors"
                title="Download Standalone HTML Report"
              >
                <Download className="w-3.5 h-3.5 text-[var(--cyan)]" />
                <span>HTML</span>
              </button>
              <button
                onClick={() => handleExportAs('csv')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-solid)] hover:bg-[var(--surface-2)] text-[11.5px] font-bold text-[var(--text)] transition-colors"
                title="Download CSV Data Table"
              >
                <Download className="w-3.5 h-3.5 text-[var(--cyan)]" />
                <span>CSV</span>
              </button>
              <button
                onClick={() => handleExportAs('json')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-solid)] hover:bg-[var(--surface-2)] text-[11.5px] font-bold text-[var(--text)] transition-colors"
                title="Download GeoJSON Feature Collection"
              >
                <Download className="w-3.5 h-3.5 text-[var(--cyan)]" />
                <span>GeoJSON</span>
              </button>
              <button
                onClick={() => handleExportAs('md')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-solid)] hover:bg-[var(--surface-2)] text-[11.5px] font-bold text-[var(--text)] transition-colors"
                title="Download Markdown Document"
              >
                <Download className="w-3.5 h-3.5 text-[var(--cyan)]" />
                <span>Markdown</span>
              </button>
            </div>
          </div>

          {/* Interactive Report Paper Document */}
          <div className="rounded-2xl glass-panel p-6 sm:p-8 space-y-6 border border-[var(--line)] bg-[var(--surface-solid)]/80">
            {!activeReport ? (
              <div className="py-20 text-center text-[13px] text-[var(--muted)]">
                Select a report from the left panel to preview its document.
              </div>
            ) : (
              <>
                {/* Formal Document Header */}
                <div className="pb-4 border-b border-[var(--line)]">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] font-bold text-[var(--cyan)] uppercase tracking-wider">
                        {activeReport._id} • {activeReport.type}
                      </span>
                      <h2 className="text-2xl font-bold font-display text-[var(--text)] mt-1 tracking-tight">
                        {activeReport.title}
                      </h2>
                      <p className="text-[12px] text-[var(--muted)] mt-1">
                        Prepared by Public Health Analyst, {countyMeta.name} County Public Health Department
                        {activeReport.fromAssessmentId && ` • Linked to Assessment ${activeReport.fromAssessmentId}`}
                      </p>
                    </div>

                    <span className="px-2.5 py-1 rounded-full text-[10.5px] font-bold bg-[var(--cyan)]/15 border border-[var(--cyan)]/30 text-[var(--cyan)] self-start sm:self-auto">
                      CDC / ACS Benchmark
                    </span>
                  </div>

                  {/* Executive Narrative */}
                  <p className="text-[12.5px] text-[var(--muted)] leading-relaxed mt-3">
                    This {activeReport.type.toLowerCase()} summarizes {metricMeta.label.toLowerCase()} and related vulnerability indicators across {tracts.length} census tracts in {countyMeta.name} County. Focus tracts identify communities facing disproportionate disparities requiring targeted public health intervention and resource allocation.
                  </p>
                </div>

                {/* Embedded Map & Mini-Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                  {/* Left: Vector Map of Primary Metric */}
                  <div className="md:col-span-7 rounded-xl overflow-hidden border border-[var(--line)] bg-[var(--surface-solid)] relative min-h-[280px]">
                    <ReportMap
                      countyFips={activeReport.jurisdictionId}
                      tracts={tracts}
                      metric={activeReport.primaryMetric}
                      focusTractIds={focusTractIds}
                      height={280}
                    />
                  </div>

                  {/* Right: Metrics & Tier Distribution Chart */}
                  <div className="md:col-span-5 flex flex-col justify-between space-y-3">
                    {/* 4 Mini Metrics Strip */}
                    <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[11.5px]">
                      <div>
                        <span className="text-[var(--faint)] block">Total Tracts</span>
                        <strong className="text-[var(--text)] num text-base">{tracts.length}</strong>
                      </div>
                      <div>
                        <span className="text-[var(--faint)] block">Focus Tracts</span>
                        <strong className="text-[var(--cyan)] num text-base">{focusTractList.length}</strong>
                      </div>
                      <div>
                        <span className="text-[var(--faint)] block">Total Population</span>
                        <strong className="text-[var(--text)] num text-base">
                          {tracts.reduce((acc, t) => acc + (t.population || 4000), 0) >= 1000
                            ? `${(tracts.reduce((acc, t) => acc + (t.population || 4000), 0) / 1000).toFixed(0)}k`
                            : tracts.reduce((acc, t) => acc + (t.population || 4000), 0).toLocaleString()}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[var(--faint)] block">{metricMeta.short} County Rate</span>
                        <strong className="text-[var(--text)] num text-base">
                          {tracts.length > 0
                            ? (tracts.reduce((acc, t) => acc + getMetricVal(t), 0) / tracts.length).toFixed(1)
                            : 0}
                          {metricMeta.unit}
                        </strong>
                      </div>
                    </div>

                    {/* Tier Distribution Bar Chart */}
                    <div className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] flex-1 flex flex-col justify-between">
                      <span className="text-[11px] font-bold text-[var(--text)] block mb-1">
                        {metricMeta.short} by Vulnerability Tier
                      </span>
                      <BarChart data={tierDistributionData} height={130} unit={metricMeta.unit} />
                    </div>
                  </div>
                </div>

                {/* Focus Tracts Detailed Data Table */}
                <div className="space-y-2">
                  <h4 className="text-[13px] font-bold text-[var(--text)]">Prioritized Focus Tracts</h4>
                  <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] max-h-[260px] overflow-y-auto">
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-[var(--surface-2)] text-[10px] font-bold text-[var(--faint)] uppercase border-b border-[var(--line)] sticky top-0 backdrop-blur-md">
                        <tr>
                          <th className="p-2.5">Tract Name</th>
                          <th className="p-2.5">GEOID</th>
                          <th className="p-2.5 text-right">Vulnerability (SVI)</th>
                          <th className="p-2.5 text-right">{metricMeta.short}</th>
                          <th className="p-2.5 text-right">Uninsured</th>
                          <th className="p-2.5 text-right">Population</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--line)]">
                        {focusTractList.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-4 text-center text-[12px] text-[var(--muted)]">
                              No focus tracts designated. Displaying countywide distribution across all {tracts.length} tracts.
                            </td>
                          </tr>
                        ) : (
                          focusTractList
                            .slice()
                            .sort((a, b) => b.svi - a.svi)
                            .map(t => (
                              <tr key={t._id} className="hover:bg-[var(--surface-2)]">
                                <td className="p-2.5 font-semibold text-[var(--text)]">
                                  {t.name.replace('Census Tract ', '')}
                                </td>
                                <td className="p-2.5 text-[var(--muted)] num text-[11px]">{t._id}</td>
                                <td className="p-2.5 text-right num font-bold text-[var(--cyan)]">
                                  {t.svi.toFixed(2)}
                                </td>
                                <td className="p-2.5 text-right num font-bold text-[var(--text)]">
                                  {getMetricVal(t).toFixed(1)}
                                  {metricMeta.unit}
                                </td>
                                <td className="p-2.5 text-right num text-[var(--muted)]">
                                  {(t.indicators?.uninsured || 8.5).toFixed(1)}%
                                </td>
                                <td className="p-2.5 text-right num text-[var(--muted)]">
                                  {(t.population || 4000).toLocaleString()}
                                </td>
                              </tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Key Findings Section */}
                <div className="space-y-2">
                  <h4 className="text-[13px] font-bold text-[var(--text)]">Synthesized Field Findings</h4>
                  {activeReport.findingsSnapshot && activeReport.findingsSnapshot.length > 0 ? (
                    <div className="space-y-1.5 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12px] text-[var(--text)] leading-relaxed">
                      {activeReport.findingsSnapshot.map((note, i) => (
                        <p key={i}>• {typeof note === 'string' ? note : (note as any)?.note || JSON.stringify(note)}</p>
                      ))}
                    </div>
                  ) : fromAssessment && fromAssessment.findings && fromAssessment.findings.length > 0 ? (
                    <div className="space-y-1.5 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12px] text-[var(--text)] leading-relaxed">
                      {fromAssessment.findings.map(f => (
                        <p key={f._id}>• {typeof f === 'string' ? f : f?.note || JSON.stringify(f)}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-[var(--muted)] italic p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                      No qualitative findings recorded for this report. Analysis is based on empirical CDC PLACES and Census SVI indicators.
                    </p>
                  )}
                </div>

                {/* Data Governance & Method Note */}
                <div className="pt-4 border-t border-[var(--line)] text-[11px] text-[var(--faint)] leading-relaxed">
                  <strong>Methodology Note:</strong> Census tract boundaries and demographic metrics conform to US Census Bureau ACS 5-year surveillance benchmarks. Health outcomes and prevalence measures reflect CDC PLACES small-area estimation modeling. Compiled by MapWell Community Health Surveillance System.
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* New Report Modal */}
      {newModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-[var(--line)]">
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">New report</h3>
                <p className="text-[12px] text-[var(--muted)]">
                  Choose a template and the data it should summarize.
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
              {/* Title Input */}
              <div className="space-y-1.5">
                <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                  Report Title
                </label>
                <input
                  type="text"
                  value={modalTitle}
                  onChange={e => setModalTitle(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12.5px] text-[var(--text)] font-semibold outline-none focus:border-[var(--cyan)]"
                />
              </div>

              {/* Template Selection */}
              <div className="space-y-1.5">
                <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                  Template
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { name: 'Vulnerability brief', metric: 'svi', desc: 'Tract vulnerability and focus areas' },
                    { name: 'Program review', metric: 'utilization', desc: 'Coverage gaps by program' },
                    { name: 'Assessment summary', metric: 'diabetes', desc: 'From a needs assessment' }
                  ].map(tpl => {
                    const isSelected = modalType === tpl.name;
                    return (
                      <label
                        key={tpl.name}
                        onClick={() => {
                          setModalType(tpl.name);
                          setModalMetric(tpl.metric);
                        }}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-[var(--glow)]/80 border-[var(--cyan)] shadow-xs'
                            : 'bg-[var(--surface-2)] border-[var(--line)] hover:border-[var(--line-strong)]'
                        }`}
                      >
                        <strong className="text-[12px] text-[var(--text)] leading-tight">{tpl.name}</strong>
                        <span className="text-[10px] text-[var(--faint)] mt-1">{tpl.desc}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Source & Primary Metric Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                    Source
                  </label>
                  <select
                    value={modalSource}
                    onChange={e => setModalSource(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12px] text-[var(--text)] font-semibold outline-none focus:border-[var(--cyan)]"
                  >
                    <option value="">Jurisdiction: {activeCounty?.name || 'County'}</option>
                    {assessmentsList.map(a => (
                      <option key={a._id} value={a._id}>
                        Assessment {a._id}: {a.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11.5px] font-bold text-[var(--faint)] uppercase block">
                    Focus Indicator
                  </label>
                  <select
                    value={modalMetric}
                    onChange={e => setModalMetric(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12px] text-[var(--text)] font-semibold outline-none focus:border-[var(--cyan)]"
                  >
                    {['svi', 'sdoh', 'diabetes', 'hypertension', 'asthma', 'uninsured', 'utilization', 'access', 'poverty'].map(
                      k => (
                        <option key={k} value={k}>
                          {METRICS_CONFIG[k]?.label || k}
                        </option>
                      )
                    )}
                  </select>
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
                onClick={handleCreateReport}
                disabled={submittingModal || !modalTitle.trim()}
                className="px-5 py-2 rounded-xl bg-[var(--cyan)] hover:opacity-90 disabled:opacity-50 text-[12.5px] font-bold text-white shadow-md transition-all flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>{submittingModal ? 'Creating...' : 'Create report'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && activeReport && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl p-6 space-y-4 animate-in zoom-in-95">
            <h3 className="text-lg font-bold text-[var(--text)]">Delete {activeReport._id}?</h3>
            <p className="text-[12.5px] text-[var(--muted)] leading-relaxed">
              &quot;{activeReport.title}&quot; will be permanently removed from saved reports. Underlying assessments and findings will not be affected.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
              <button
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 py-2 rounded-xl text-[12.5px] font-bold text-[var(--muted)] hover:text-[var(--text)]"
              >
                Keep report
              </button>
              <button
                onClick={handleDelete}
                className="px-5 py-2 rounded-xl bg-[var(--rose)] hover:opacity-90 text-[12.5px] font-bold text-white shadow-md transition-all flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete report</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[13px] text-[var(--muted)]">
          Loading reports and exports...
        </div>
      }
    >
      <ReportsContent />
    </Suspense>
  );
}
