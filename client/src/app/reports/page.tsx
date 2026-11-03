'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { Report, CensusTract, Assessment } from '@/types';
import { METRICS_CONFIG, TIER_COLORS, TIER_LABELS } from '@/config/metrics';
import { Icon } from '@/components/Icons';
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

  // Load Assessments for Modal (prioritizing active jurisdiction)
  useEffect(() => {
    fetch('/api/assessments')
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        const sorted = [...data].sort((a, b) => {
          if (a.jurisdictionId === activeCounty?._id) return -1;
          if (b.jurisdictionId === activeCounty?._id) return 1;
          return 0;
        });
        setAssessmentsList(sorted);
      })
      .catch(e => console.error(e));
  }, [activeCounty]);

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
      const selectedAss = assessmentsList.find(a => a._id === modalSource);
      const jurId = selectedAss?.jurisdictionId || activeCounty?._id || '53033';

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: modalTitle.trim(),
          type: modalType,
          fromAssessmentId: modalSource || null,
          jurisdictionId: jurId,
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
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300 }}>
          <div className="toast">
            <span className="dot live" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Screen Header */}
      <div className="page-head">
        <div>
          <h2>Reports &amp; exports</h2>
          <p>Review saved reports, preview their maps and tables, and export them for partners and boards.</p>
        </div>
        <div className="row">
          <span className="pill demo"><span className="dot" />Demo data. Values are synthetic</span>
          <button
            className="btn primary"
            id="rp-new"
            onClick={() => {
              setModalTitle(`${activeCounty?.name || 'County'} vulnerability brief`);
              setNewModalOpen(true);
            }}
          >
            <Icon name="plus" />New report
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="toolbar">
        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            Search
            <input
              className="input"
              id="rp-q"
              placeholder="Report title or ID"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </label>
          <label className="field">
            Type
            <select
              className="input"
              id="rp-t"
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
            >
              {REPORT_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Status</span>
            <div className="seg" id="rp-s">
              {(['All', 'Draft', 'Published'] as const).map(s => (
                <button
                  key={s}
                  className={statusFilter === s ? 'on' : ''}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Col 4 (Saved Reports List) & Col 8 (Report Document & Exports) */}
      <div className="grid g-12">
        {/* Left Col (Col 4): Saved Reports List */}
        <section className="panel c-4">
          <div className="panel-h">
            <h3>Saved reports</h3>
            <span className="note" id="rp-n">
              {filteredReports.length} of {reports.length}
            </span>
          </div>

          <div className="stack" id="rp-list">
            {filteredReports.length === 0 ? (
              <div className="empty">
                <b>No reports match</b>Change the filters or create a new report.
              </div>
            ) : (
              filteredReports.map(r => {
                const isSelected = r._id === selectedId;
                const dateStr = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'Recent';

                return (
                  <button
                    key={r._id}
                    className="tool-tile"
                    data-r={r._id}
                    onClick={() => setSelectedId(r._id)}
                    style={{
                      padding: 14,
                      gap: 6,
                      borderColor: isSelected ? 'var(--cyan)' : undefined,
                      boxShadow: isSelected ? '0 0 0 3px var(--glow)' : undefined
                    }}
                  >
                    <div className="row between" style={{ width: '100%', flexWrap: 'nowrap' }}>
                      <b style={{ fontSize: '13.5px' }}>{r.title}</b>
                      <span className={`pill ${r.status === 'Published' ? 'ok' : 'warn'}`}>
                        <span className="dot" />{r.status}
                      </span>
                    </div>
                    <span className="note">
                      {r._id}. {r.type}. {dateStr}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Col (Col 8): Report Document & Export Bar */}
        <section className="c-8 stack" style={{ gap: 18 }}>
          <div className="panel tight">
            <div className="row between">
              <div className="row" id="rp-acts">
                {activeReport?.status === 'Draft' ? (
                  <button className="btn sm primary" id="rp-pub" onClick={handlePublish}>
                    <Icon name="check" />Publish
                  </button>
                ) : (
                  <span className="pill ok"><span className="dot" />Published</span>
                )}
                <button className="btn sm" id="rp-dup" onClick={handleDuplicate}>
                  <Icon name="plus" />Duplicate
                </button>
                <button className="btn sm ghost danger" id="rp-del" onClick={() => setDeleteModalOpen(true)}>
                  <Icon name="trash" />Delete
                </button>
              </div>

              <div className="row">
                <span className="note">Export as</span>
                <button className="btn sm" data-x="html" onClick={() => handleExportAs('html')}>
                  <Icon name="download" />HTML report
                </button>
                <button className="btn sm" data-x="csv" onClick={() => handleExportAs('csv')}>
                  <Icon name="download" />CSV table
                </button>
                <button className="btn sm" data-x="json" onClick={() => handleExportAs('json')}>
                  <Icon name="download" />GeoJSON-lite
                </button>
                <button className="btn sm" data-x="md" onClick={() => handleExportAs('md')}>
                  <Icon name="download" />Markdown
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Report Paper Document */}
          <div className="report-paper" id="rp-doc">
            {!activeReport ? (
              <div className="empty">
                <b>Select a report</b>Or create one from a template.
              </div>
            ) : (
              <>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <span className="note">
                      {activeReport._id}. {activeReport.type}. Prepared by Public Health Analyst, {countyMeta.name} County, {countyMeta.stateAbbr || 'WA'} health department
                    </span>
                    <h2 className="mt-s">{activeReport.title}</h2>
                  </div>
                  <span className="pill demo"><span className="dot" />Demo data. Values are synthetic</span>
                </div>

                <p>
                  This {activeReport.type.toLowerCase()} summarizes {metricMeta.label.toLowerCase()} and related indicators across {tracts.length} census tracts in {countyMeta.name} County, {countyMeta.stateAbbr || 'WA'}{activeReport.fromAssessmentId ? `, prepared for assessment ${activeReport.fromAssessmentId}` : ''}. All figures are synthetic demo values.
                </p>

                <div className="grid g-12 mt">
                  <div
                    className="c-7"
                    style={{
                      position: 'relative',
                      height: 280,
                      borderRadius: 14,
                      border: '1px solid var(--line)',
                      overflow: 'hidden'
                    }}
                  >
                    <div id="rp-map" style={{ position: 'absolute', inset: 0 }}>
                      <ReportMap
                        countyFips={activeReport.jurisdictionId}
                        tracts={tracts}
                        metric={activeReport.primaryMetric}
                        focusTractIds={focusTractIds}
                        height={280}
                      />
                    </div>
                  </div>

                  <div className="c-5 stack">
                    <div className="mini-metrics" style={{ margin: 0 }}>
                      <div className="metric">
                        <span className="lbl">Tracts</span>
                        <b className="val num">{tracts.length}</b>
                      </div>
                      <div className="metric">
                        <span className="lbl">Focus tracts</span>
                        <b className="val num">{focusTractList.length}</b>
                      </div>
                      <div className="metric">
                        <span className="lbl">Mean {metricMeta.short}</span>
                        <b className="val num">
                          {tracts.length > 0
                            ? (tracts.reduce((acc, t) => acc + getMetricVal(t), 0) / tracts.length).toFixed(1)
                            : '0.0'}
                          {metricMeta.unit}
                        </b>
                      </div>
                      <div className="metric">
                        <span className="lbl">Worst tract</span>
                        <b className="val num">
                          {tracts.length > 0
                            ? Math.max(...tracts.map(t => getMetricVal(t))).toFixed(1)
                            : '0.0'}
                          {metricMeta.unit}
                        </b>
                      </div>
                    </div>

                    <div>
                      <h4 style={{ marginTop: 4 }}>{metricMeta.short} by vulnerability tier</h4>
                      <div id="rp-ch">
                        <BarChart data={tierDistributionData} height={120} unit={metricMeta.unit} />
                      </div>
                    </div>
                  </div>
                </div>

                <h4>Focus tracts</h4>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Tract</th>
                        <th>GEOID</th>
                        <th className="r">Vulnerability</th>
                        <th className="r">{metricMeta.short}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {focusTractList.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '16px' }}>
                            No focus tracts designated.
                          </td>
                        </tr>
                      ) : (
                        focusTractList.slice(0, 20).map(t => (
                          <tr key={t._id}>
                            <td><b>{t.name.replace('Census Tract ', '')}</b></td>
                            <td className="muted num">{t._id}</td>
                            <td className="r num">{t.svi.toFixed(2)}</td>
                            <td className="r num"><b>{getMetricVal(t).toFixed(1)}{metricMeta.unit}</b></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {(activeReport.findingsSnapshot && activeReport.findingsSnapshot.length > 0) || (fromAssessment?.findings && fromAssessment.findings.length > 0) ? (
                  <>
                    <h4>Findings</h4>
                    {activeReport.findingsSnapshot && activeReport.findingsSnapshot.length > 0 ? (
                      activeReport.findingsSnapshot.map((note, i) => (
                        <p key={i}>• {typeof note === 'string' ? note : (note as any)?.note || JSON.stringify(note)}</p>
                      ))
                    ) : (
                      fromAssessment?.findings?.map(f => (
                        <p key={f._id}>• {typeof f === 'string' ? f : f?.note || JSON.stringify(f)}</p>
                      ))
                    )}
                  </>
                ) : null}

                <h4>Method note</h4>
                <p>
                  Census tract boundaries are synthetic subdivisions of real county outlines. Indicator values are mock estimates calibrated to realistic surveillance ranges. Exported files contain the same synthetic rows shown here.
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      {/* New Report Modal */}
      {newModalOpen && (
        <div className="modal-scrim" onClick={() => setNewModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <h2>New report</h2>
                <p>Choose a template and the data it should summarize.</p>
              </div>
              <button
                className="icon-btn"
                onClick={() => setNewModalOpen(false)}
                aria-label="Close"
              >
                <Icon name="x" />
              </button>
            </div>

            <div className="stack">
              <label className="field">
                Report title
                <input
                  className="input"
                  id="nr-t"
                  value={modalTitle}
                  onChange={e => setModalTitle(e.target.value)}
                />
              </label>

              <div className="field">
                <span>Template</span>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                  {[
                    ['Vulnerability brief', 'svi', 'Tract vulnerability and focus areas'],
                    ['Program review', 'utilization', 'Coverage gaps by program'],
                    ['Assessment summary', 'diabetes', 'From a needs assessment']
                  ].map(([n, mk, d]) => (
                    <label key={n} className="check">
                      <input
                        type="radio"
                        name="nr-tp"
                        value={n}
                        checked={modalType === n}
                        onChange={() => {
                          setModalType(n);
                          setModalMetric(mk);
                        }}
                      />
                      <span>{n}<small>{d}</small></span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid g-12" style={{ gap: 12 }}>
                <label className="field c-6 c-lg-6">
                  Source
                  <select
                    className="input"
                    id="nr-src"
                    value={modalSource}
                    onChange={e => setModalSource(e.target.value)}
                  >
                    <option value="">Jurisdiction: {countyMeta.name} County, {countyMeta.stateAbbr || 'WA'}</option>
                    {assessmentsList.map(a => (
                      <option key={a._id} value={a._id}>
                        Assessment {a._id}: {a.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field c-6 c-lg-6">
                  Focus indicator
                  <select
                    className="input"
                    id="nr-m"
                    value={modalMetric}
                    onChange={e => setModalMetric(e.target.value)}
                  >
                    {['svi', 'sdoh', 'diabetes', 'hypertension', 'asthma', 'uninsured', 'utilization', 'access', 'poverty'].map(k => (
                      <option key={k} value={k}>
                        {METRICS_CONFIG[k]?.label || k}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="modal-f">
              <button className="btn ghost" onClick={() => setNewModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={handleCreateReport}
                disabled={submittingModal}
              >
                <Icon name="file" />
                {submittingModal ? 'Creating...' : 'Create report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && activeReport && (
        <div className="modal-scrim" onClick={() => setDeleteModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <h2>Delete {activeReport._id}?</h2>
                <p>{activeReport.title} will be removed permanently. This cannot be undone.</p>
              </div>
              <button
                className="icon-btn"
                onClick={() => setDeleteModalOpen(false)}
                aria-label="Close"
              >
                <Icon name="x" />
              </button>
            </div>

            <div className="modal-f">
              <button className="btn ghost" onClick={() => setDeleteModalOpen(false)}>
                Keep
              </button>
              <button className="btn danger" onClick={handleDelete}>
                <Icon name="trash" />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Loading Reports &amp; Exports...
        </div>
      }
    >
      <ReportsContent />
    </Suspense>
  );
}
