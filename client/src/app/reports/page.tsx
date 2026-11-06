'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '@/context/SessionContext';
import { Report, CensusTract, Assessment } from '@/types';
import { Icon } from '@/components/Icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { ReportMap, ReportScaleInfo } from '@/components/ReportMap';
import { ReportBarChart } from '@/components/ReportBarChart';

const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-US'),
  pct: (v: number, d = 1) => v.toFixed(d) + '%',
  dec: (v: number, d = 1) => v.toFixed(d),
  usd: (v: number) => '$' + Math.round(v).toLocaleString('en-US'),
  k: (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : Math.round(v) + '')
};

interface MetricInfo {
  label: string;
  short: string;
  f: (v: number) => string;
  bad: 'high' | 'low' | 'none';
  unit?: string;
}

const METRICS: Record<string, MetricInfo> = {
  svi: { label: 'Social vulnerability index', short: 'Vulnerability', f: v => v.toFixed(2), bad: 'high', unit: '' },
  sdoh: { label: 'SDOH composite burden', short: 'SDOH burden', f: v => v.toFixed(0), bad: 'high', unit: '/100' },
  poverty: { label: 'Population below poverty line', short: 'Poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  childPoverty: { label: 'Children below poverty line', short: 'Child poverty', f: v => v.toFixed(1) + '%', bad: 'high' },
  income: { label: 'Median household income', short: 'Median income', f: v => fmt.usd(v), bad: 'low' },
  rentBurden: { label: 'Rent-burdened households', short: 'Rent burden', f: v => v.toFixed(1) + '%', bad: 'high' },
  oldHousing: { label: 'Housing built before 1960', short: 'Pre-1960 housing', f: v => v.toFixed(1) + '%', bad: 'high' },
  crowding: { label: 'Overcrowded housing units', short: 'Crowding', f: v => v.toFixed(1) + '%', bad: 'high' },
  noVehicle: { label: 'Households without a vehicle', short: 'No vehicle', f: v => v.toFixed(1) + '%', bad: 'high' },
  transit: { label: 'Residents within ¼ mile of transit', short: 'Transit access', f: v => v.toFixed(0) + '%', bad: 'low' },
  commute: { label: 'Mean commute time', short: 'Commute', f: v => v.toFixed(0) + ' min', bad: 'high' },
  noDiploma: { label: 'Adults without a high school diploma', short: 'No diploma', f: v => v.toFixed(1) + '%', bad: 'high' },
  bachelors: { label: "Adults with a bachelor's degree", short: "Bachelor's+", f: v => v.toFixed(1) + '%', bad: 'low' },
  broadband: { label: 'Households with broadband', short: 'Broadband', f: v => v.toFixed(0) + '%', bad: 'low' },
  unemployment: { label: 'Unemployment rate', short: 'Unemployment', f: v => v.toFixed(1) + '%', bad: 'high' },
  lfp: { label: 'Labor force participation', short: 'Labor force', f: v => v.toFixed(1) + '%', bad: 'low' },
  uninsured: { label: 'Adults without health insurance', short: 'Uninsured', f: v => v.toFixed(1) + '%', bad: 'high' },
  pcp: { label: 'Primary care physicians per 100k', short: 'PCP per 100k', f: v => v.toFixed(0), bad: 'low' },
  driveTime: { label: 'Drive time to nearest clinic', short: 'Clinic drive time', f: v => v.toFixed(0) + ' min', bad: 'high' },
  access: { label: 'Healthcare access score', short: 'Access score', f: v => v.toFixed(0), bad: 'low', unit: '/100' },
  diabetes: { label: 'Diagnosed diabetes prevalence', short: 'Diabetes', f: v => v.toFixed(1) + '%', bad: 'high' },
  asthma: { label: 'Current asthma prevalence', short: 'Asthma', f: v => v.toFixed(1) + '%', bad: 'high' },
  hypertension: { label: 'High blood pressure prevalence', short: 'Hypertension', f: v => v.toFixed(1) + '%', bad: 'high' },
  obesity: { label: 'Adult obesity prevalence', short: 'Obesity', f: v => v.toFixed(1) + '%', bad: 'high' },
  copd: { label: 'COPD prevalence', short: 'COPD', f: v => v.toFixed(1) + '%', bad: 'high' },
  incidence: { label: 'Chronic disease burden index', short: 'Disease burden', f: v => v.toFixed(0), bad: 'high', unit: '/100' },
  utilization: { label: 'Average program utilization', short: 'Utilization', f: v => v.toFixed(0) + '%', bad: 'low' },
  lifeExp: { label: 'Life expectancy at birth', short: 'Life expectancy', f: v => v.toFixed(1) + ' yrs', bad: 'low' },
  pop: { label: 'Population', short: 'Population', f: v => fmt.k(v), bad: 'none' }
};

const TIER_LABEL = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
const TIER_COLOR = ['#9FE3E7', '#5CCAD2', '#66B6F5', '#2584EB', '#163E8C'];

const getV = (rec: any, key: string): number => {
  if (!rec) return 0;
  if (key.startsWith('prog.')) return rec.prog?.[key.slice(5)] ?? 50;
  const val = rec.indicators?.[key] ?? rec[key];
  if (typeof val === 'number') return val;
  if (key === 'svi') return rec.svi ?? 0.5;
  if (key === 'pop' || key === 'population') return rec.population ?? rec.pop ?? 4000;
  if (key === 'uninsured') return rec.indicators?.uninsured ?? rec.uninsured ?? 10.5;
  return 0;
};

const countyLabel = (c?: any): string => {
  if (!c) return 'County';
  const st = c.stateAbbr || c.st || 'WA';
  const name = (c.name || 'County').replace(/\s+County$/i, '');
  return `${name} County, ${st}`;
};

const escapeHtml = (s: any): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

function toCSV(rows: any[], cols: [string, string | ((r: any) => any)][]): string {
  const q = (v: any) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [
    cols.map(c => q(c[0])).join(','),
    ...rows.map(r => cols.map(c => q(typeof c[1] === 'function' ? c[1](r) : r[c[1]])).join(','))
  ].join('\n');
}

const statusPill = (s: string) => (
  <span className={`pill ${s === 'Completed' ? 'ok' : s === 'In review' ? 'info' : s === 'Published' ? 'ok' : 'warn'}`}>
    {s}
  </span>
);

function ReportsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramOpen = searchParams.get('open');

  const { activeCounty, jurisdictions, markWorkflowMilestone } = useSession();

  const [reports, setReports] = useState<Report[]>([]);
  const [openId, setOpenId] = useState<string | null>(paramOpen || null);
  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [fromAssessment, setFromAssessment] = useState<Assessment | null>(null);

  const [q, setQ] = useState<string>('');
  const [typeF, setTypeF] = useState<string>('All');
  const [statusF, setStatusF] = useState<'All' | 'Draft' | 'Published'>('All');
  const [scaleInfo, setScaleInfo] = useState<ReportScaleInfo | null>(null);

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

  // Export Modal matching prototype downloadFile modal
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);
  const [exportFilename, setExportFilename] = useState<string>('');
  const [exportContent, setExportContent] = useState<string>('');
  const [exportLabel, setExportLabel] = useState<string>('Synthetic demo data');

  // Sync modals to body.modal-open and #modal-root for page blur & non-scrollable
  const isAnyModalOpen = exportModalOpen || newModalOpen || deleteModalOpen;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const modalRoot = document.getElementById('modal-root');
    if (isAnyModalOpen) {
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
  }, [isAnyModalOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (exportModalOpen) setExportModalOpen(false);
        else if (newModalOpen) setNewModalOpen(false);
        else if (deleteModalOpen) setDeleteModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exportModalOpen, newModalOpen, deleteModalOpen]);

  // Load Reports
  const loadReports = async () => {
    try {
      const res = await fetch('/api/reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data);
        if (data.length > 0 && !openId) {
          setOpenId(data[0]._id);
        }
      }
    } catch (e) {
      console.error('Failed to load reports:', e);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  // Load Assessments for Modal
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

  // Active Report
  const activeReport = useMemo(() => {
    return reports.find(r => r._id === openId) || null;
  }, [reports, openId]);

  // Load Tracts and Assessment for Active Report
  useEffect(() => {
    if (!activeReport) return;

    const jurId = activeReport.jurisdictionId || activeCounty?._id || '53033';
    fetch(`/api/tracts?county=${jurId}`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(res => setTracts(res.data || []))
      .catch(e => console.error(e));

    if (activeReport.fromAssessmentId) {
      fetch(`/api/assessments/${activeReport.fromAssessmentId}`)
        .then(r => (r.ok ? r.json() : null))
        .then(ass => setFromAssessment(ass))
        .catch(e => console.error(e));
    } else {
      setFromAssessment(null);
    }
  }, [activeReport, activeCounty]);

  // Active county meta
  const countyMeta = useMemo(() => {
    const jurId = activeReport?.jurisdictionId || activeCounty?._id || '53033';
    return (
      jurisdictions.find(j => j._id === jurId) ||
      activeCounty || { _id: jurId, name: 'King', stateAbbr: 'WA' }
    );
  }, [activeReport, jurisdictions, activeCounty]);

  // Metric metadata
  const activeMetricKey = activeReport?.primaryMetric || 'svi';
  const metricMeta = useMemo(() => {
    return METRICS[activeMetricKey] || {
      label: activeMetricKey,
      short: activeMetricKey,
      f: (v: number) => v.toFixed(1),
      bad: 'high'
    };
  }, [activeMetricKey]);

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
    const highTier = tracts.filter(t => (t.tier ?? Math.min(4, Math.floor(t.svi * 5))) >= 3);
    if (highTier.length > 0) return highTier;
    return tracts.slice(0, 8);
  }, [activeReport, fromAssessment, tracts]);

  const focusTractIds = useMemo(() => {
    return focusTractList.map(t => t._id);
  }, [focusTractList]);

  const focusSet = useMemo(() => new Set(focusTractIds), [focusTractIds]);

  // Findings list
  const findingsList: string[] = useMemo(() => {
    if (activeReport?.findingsSnapshot && activeReport.findingsSnapshot.length > 0) {
      return activeReport.findingsSnapshot.map(f => (typeof f === 'string' ? f : (f as any)?.note || JSON.stringify(f)));
    }
    if (fromAssessment?.findings && fromAssessment.findings.length > 0) {
      return fromAssessment.findings.map(f => (typeof f === 'string' ? f : (f as any)?.note || JSON.stringify(f)));
    }
    return [];
  }, [activeReport, fromAssessment]);

  // Bar chart data for vulnerability tiers
  const barChartData = useMemo(() => {
    if (tracts.length === 0) return [];
    return TIER_LABEL.map((l, i) => {
      const tierTracts = tracts.filter(t => (t.tier ?? Math.min(4, Math.floor(t.svi * 5))) === i);
      const avg = tierTracts.length > 0
        ? tierTracts.reduce((sum, t) => sum + getV(t, activeMetricKey), 0) / tierTracts.length
        : 0;
      return {
        label: l.split(' ').map(w => w[0]).join(''),
        value: avg,
        color: TIER_COLOR[i],
        tierName: `${l} vulnerability`
      };
    });
  }, [tracts, activeMetricKey]);

  // Filtered reports
  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const matchType = typeF === 'All' || r.type === typeF;
      const matchStatus = statusF === 'All' || r.status === statusF;
      const matchQ = !q || (r.title + r._id).toLowerCase().includes(q.toLowerCase());
      return matchType && matchStatus && matchQ;
    });
  }, [reports, typeF, statusF, q]);

  const allTypes = useMemo(() => {
    const custom = reports.map(r => r.type);
    const defaults = ['Vulnerability brief', 'Program review', 'Assessment summary'];
    return ['All', ...Array.from(new Set([...custom, ...defaults]))];
  }, [reports]);

  // Action: Publish Report
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
        setReports(prev => prev.map(r => (r._id === updated._id ? updated : r)));
        setToastMessage(`${updated._id} published`);
        setTimeout(() => setToastMessage(null), 3500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Action: Duplicate Report
  const handleDuplicate = async () => {
    if (!activeReport) return;
    try {
      const res = await fetch(`/api/reports/${activeReport._id}/duplicate`, {
        method: 'POST'
      });
      if (res.ok) {
        const dup = await res.json();
        setReports(prev => [dup, ...prev]);
        setOpenId(dup._id);
        setToastMessage('Report duplicated');
        setTimeout(() => setToastMessage(null), 3500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Action: Delete Report
  const handleDelete = async () => {
    if (!activeReport) return;
    try {
      const res = await fetch(`/api/reports/${activeReport._id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const nextList = reports.filter(r => r._id !== activeReport._id);
        setReports(nextList);
        setOpenId(nextList[0]?._id || null);
        setDeleteModalOpen(false);
        setToastMessage('Report deleted');
        setTimeout(() => setToastMessage(null), 3500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Action: Export Multi-format matching prototype exportAs
  const exportAs = (kind: 'html' | 'csv' | 'json' | 'md') => {
    if (!activeReport) return;
    const c = countyMeta;
    const ts = tracts;
    const k = activeMetricKey;
    const m = metricMeta;
    const findings = findingsList;
    const focus = focusTractList;
    const base = activeReport._id.toLowerCase() + '-' + activeReport.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const createdStr = activeReport.createdAt ? new Date(activeReport.createdAt).toISOString().slice(0, 10) : '2026-10-24';

    let name = '';
    let body = '';

    if (kind === 'csv') {
      name = base + '.csv';
      body = toCSV(ts, [
        ['geoid', (t: CensusTract) => t._id],
        ['tract', (t: CensusTract) => t.name],
        ['svi', (t: CensusTract) => t.svi.toFixed(3)],
        [k, (t: CensusTract) => getV(t, k).toFixed(2)],
        ['uninsured_pct', (t: CensusTract) => ((t.indicators as any)?.uninsured ?? (t as any).uninsured ?? 10.5).toFixed(1)],
        ['population', (t: CensusTract) => t.population || (t as any).pop || 4000],
        ['focus_tract', (t: CensusTract) => (focusSet.has(t._id) ? 'yes' : 'no')],
        ['data_status', () => 'synthetic demo']
      ]);
    } else if (kind === 'json') {
      name = base + '.json';
      body = JSON.stringify(
        {
          report: activeReport._id,
          title: activeReport.title,
          jurisdiction: countyLabel(c),
          data_status: 'synthetic demo',
          type: 'FeatureCollection',
          features: ts.map(t => ({
            type: 'Feature',
            id: t._id,
            properties: {
              name: t.name,
              svi: +t.svi.toFixed(3),
              [k]: +getV(t, k).toFixed(2),
              focus: focusSet.has(t._id)
            },
            geometry: {
              type: 'Point',
              coordinates_albers_px: [+(t.centroid?.[0] ?? 0).toFixed(2), +(t.centroid?.[1] ?? 0).toFixed(2)]
            }
          }))
        },
        null,
        2
      );
    } else if (kind === 'md') {
      name = base + '.md';
      body = `# ${activeReport.title}\n\n${activeReport._id}, ${activeReport.type}, ${countyLabel(c)}. Created ${createdStr}.\n\n> All values are synthetic demo data.\n\n## Summary\n\n- Census tracts: ${ts.length}\n- Focus tracts: ${focus.length}\n- ${m.label}: ${m.f(getV(c, k))}\n\n## Focus tracts\n\n| Tract | GEOID | Vulnerability | ${m.short} |\n|---|---|---|---|\n${focus.slice(0, 15).map(t => `| ${t.name} | ${t._id} | ${t.svi.toFixed(2)} | ${m.f(getV(t, k))} |`).join('\n')}\n${findings.length ? '\n## Findings\n\n' + findings.map(f => '- ' + f).join('\n') + '\n' : ''}`;
    } else {
      name = base + '.html';
      const svgEl = document.querySelector('#rp-map svg');
      let svgStr = '';
      if (svgEl) {
        const cl = svgEl.cloneNode(true) as SVGElement;
        cl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        cl.querySelectorAll('.county').forEach(p => {
          p.setAttribute('stroke', '#ffffff22');
          p.setAttribute('stroke-width', '.3');
        });
        cl.querySelectorAll('.tract').forEach(p => {
          p.setAttribute('stroke', '#ffffff');
          p.setAttribute('stroke-width', '.08');
        });
        cl.querySelectorAll('.cmp').forEach(p => {
          p.setAttribute('stroke', '#FFB648');
          p.setAttribute('stroke-width', '.25');
        });
        cl.querySelectorAll('.nation-b,.sel-outline').forEach(p => {
          p.setAttribute('fill', 'none');
          p.setAttribute('stroke', '#38E1FF');
          p.setAttribute('stroke-width', '.3');
        });
        svgStr = cl.outerHTML.replace(/var\(--map-low\)/g, '#101B45');
      }
      body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(activeReport.title)}</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#0B1438}h1{font-size:26px;margin:0 0 6px}.d{color:#8a5a00;background:#fff4dc;padding:3px 10px;border-radius:20px;font-size:12px;display:inline-block}svg{width:100%;height:auto;background:#060A1C;border-radius:12px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #dde;padding:6px 8px;text-align:left}</style></head><body><p>${activeReport._id}. ${activeReport.type}. ${escapeHtml(countyLabel(c))}. Created ${createdStr}</p><h1>${escapeHtml(activeReport.title)}</h1><span class="d">Synthetic demo data</span><h2>Map</h2>${svgStr}<h2>Focus tracts</h2><table><tr><th>Tract</th><th>GEOID</th><th>Vulnerability</th><th>${m.short}</th></tr>${focus.slice(0, 20).map(t => `<tr><td>${t.name}</td><td>${t._id}</td><td>${t.svi.toFixed(2)}</td><td>${m.f(getV(t, k))}</td></tr>`).join('')}</table>${findings.length ? '<h2>Findings</h2><ul>' + findings.map(f => `<li>${escapeHtml(f)}</li>`).join('') + '</ul>' : ''}<p><small>Generated by the MapWell demo. Tract geometries and values are synthetic.</small></p></body></html>`;
    }

    setExportFilename(name);
    setExportContent(body);
    setExportLabel('Synthetic demo data');
    setExportModalOpen(true);
    markWorkflowMilestone('export');
  };

  // Action: Create Report Modal Submit
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
        setOpenId(created._id);
        setNewModalOpen(false);
        setToastMessage(`Report created: ${created._id}`);
        setTimeout(() => setToastMessage(null), 3500);
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

      {/* Screen Header matching prototype head() */}
      <div className="page-head">
        <div>
          <h1>Reports &amp; exports</h1>
          <p>Review saved reports, preview their maps and tables, and export them for partners and boards.</p>
        </div>
        <div className="head-actions">
          <span
            className="pill demo"
            title="Synthetic values generated for this demo. Not real surveillance or Census data."
          >
            <span className="dot" />
            Synthetic demo data
          </span>
          <button
            className="btn primary"
            id="rp-new"
            onClick={() => {
              setModalTitle(`${countyMeta.name || 'County'} vulnerability brief`);
              setModalType('Vulnerability brief');
              setModalMetric('svi');
              setModalSource('');
              setNewModalOpen(true);
            }}
          >
            <Icon name="plus" size={14} />
            New report
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
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </label>
          <label className="field">
            Type
            <select
              className="input"
              id="rp-t"
              value={typeF}
              onChange={e => setTypeF(e.target.value)}
            >
              {allTypes.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Status</span>
            <div className="seg" id="rp-s">
              {(['All', 'Draft', 'Published'] as const).map(s => (
                <button
                  key={s}
                  className={statusF === s ? 'on' : ''}
                  data-s={s}
                  onClick={() => setStatusF(s)}
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
                const isSelected = r._id === openId;
                const createdDate = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '2026-10-24';

                return (
                  <button
                    key={r._id}
                    className="tool-tile"
                    data-r={r._id}
                    onClick={() => setOpenId(r._id)}
                    style={{
                      padding: 14,
                      gap: 6,
                      borderColor: isSelected ? 'var(--cyan)' : undefined,
                      boxShadow: isSelected ? '0 0 0 3px var(--glow)' : undefined
                    }}
                  >
                    <div className="row between" style={{ width: '100%', flexWrap: 'nowrap' }}>
                      <b style={{ fontSize: '13.5px' }}>{r.title}</b>
                      {statusPill(r.status)}
                    </div>
                    <span className="note">
                      {r._id}. {r.type}. {createdDate}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Col (Col 8): Action Bar & Report Document */}
        <section className="c-8 stack" style={{ gap: 18 }}>
          <div className="panel tight">
            <div className="row between">
              <div className="row" id="rp-acts">
                {activeReport && (
                  <>
                    {activeReport.status === 'Draft' ? (
                      <button className="btn sm primary" id="rp-pub" onClick={handlePublish}>
                        <Icon name="check" size={13} />
                        Publish
                      </button>
                    ) : (
                      <span className="pill ok">
                        <span className="dot" />
                        Published
                      </span>
                    )}
                    <button className="btn sm" id="rp-dup" onClick={handleDuplicate}>
                      <Icon name="plus" size={13} />
                      Duplicate
                    </button>
                    <button className="btn sm ghost danger" id="rp-del" onClick={() => setDeleteModalOpen(true)}>
                      <Icon name="trash" size={13} />
                      Delete
                    </button>
                  </>
                )}
              </div>

              <div className="row">
                <span className="note">Export as</span>
                <button className="btn sm" data-x="html" onClick={() => exportAs('html')}>
                  <Icon name="download" size={13} />
                  HTML report
                </button>
                <button className="btn sm" data-x="csv" onClick={() => exportAs('csv')}>
                  <Icon name="download" size={13} />
                  CSV table
                </button>
                <button className="btn sm" data-x="json" onClick={() => exportAs('json')}>
                  <Icon name="download" size={13} />
                  GeoJSON-lite
                </button>
                <button className="btn sm" data-x="md" onClick={() => exportAs('md')}>
                  <Icon name="download" size={13} />
                  Markdown
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Report Paper Document matching prototype #rp-doc */}
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
                      {activeReport._id}. {activeReport.type}. Prepared by {fromAssessment?.owner || 'Public Health Analyst'}, {countyLabel(countyMeta)} health department
                    </span>
                    <h2 className="mt-s">{activeReport.title}</h2>
                  </div>
                  <span
                    className="pill demo"
                    title="Synthetic values generated for this demo. Not real surveillance or Census data."
                  >
                    <span className="dot" />
                    Synthetic demo data
                  </span>
                </div>

                <p>
                  This {activeReport.type.toLowerCase()} summarizes {metricMeta.label.toLowerCase()} and related indicators across {tracts.length} census tracts in {countyLabel(countyMeta)}{fromAssessment ? `, prepared for assessment ${fromAssessment._id}` : ''}. All figures are synthetic demo values.
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
                        countyFips={activeReport.jurisdictionId || countyMeta._id}
                        tracts={tracts}
                        metric={activeMetricKey}
                        focusTractIds={focusTractIds}
                        height={280}
                        onScaleReady={setScaleInfo}
                        onCountySelect={(fips) => {
                          const matching = reports.find(r => r.jurisdictionId === fips);
                          if (matching) {
                            setOpenId(matching._id);
                          }
                        }}
                      />
                    </div>
                    {scaleInfo && (
                      <div
                        className="map-float legend"
                        style={{ left: 8, bottom: 8, minWidth: 170, padding: '8px 10px' }}
                        id="rp-leg"
                      >
                        <div className="ttl">
                          <span>{scaleInfo.title}</span>
                        </div>
                        <div className="ramp">
                          {scaleInfo.bins.map((c, i) => (
                            <i key={i} style={{ background: c }} />
                          ))}
                        </div>
                        <div className="ends">
                          <span>{scaleInfo.lo}</span>
                          <span>{scaleInfo.note}</span>
                          <span>{scaleInfo.hi}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="c-5 stack">
                    <div className="mini-metrics" style={{ margin: 0 }}>
                      <div className="mm">
                        <small>Tracts</small>
                        <b className="num">{tracts.length}</b>
                      </div>
                      <div className="mm">
                        <small>Focus tracts</small>
                        <b className="num">{focusTractList.length}</b>
                      </div>
                      <div className="mm">
                        <small>Residents</small>
                        <b className="num">
                          {fmt.k(tracts.reduce((sum, t) => sum + (t.population || (t as any).pop || 4000), 0))}
                        </b>
                      </div>
                      <div className="mm">
                        <small>{metricMeta.short}</small>
                        <b className="num">
                          {metricMeta.f(
                            getV(countyMeta, activeMetricKey) ||
                            (tracts.length > 0
                              ? tracts.reduce((sum, t) => sum + getV(t, activeMetricKey), 0) / tracts.length
                              : 0)
                          )}
                        </b>
                      </div>
                    </div>

                    <div>
                      <h4 style={{ marginTop: 4 }}>{metricMeta.short} by vulnerability tier</h4>
                      <ReportBarChart
                        id="rp-ch"
                        data={barChartData}
                        height={150}
                        fmt={metricMeta.f}
                      />
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
                        <th className="r">Uninsured</th>
                        <th className="r">Population</th>
                      </tr>
                    </thead>
                    <tbody>
                      {focusTractList.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '16px' }}>
                            No focus tracts designated.
                          </td>
                        </tr>
                      ) : (
                        focusTractList
                          .slice()
                          .sort((x, y) => y.svi - x.svi)
                          .slice(0, 8)
                          .map(t => (
                            <tr key={t._id}>
                              <td>{t.name.replace('Census ', '')}</td>
                              <td className="muted">{t._id}</td>
                              <td className="r num">{t.svi.toFixed(2)}</td>
                              <td className="r num">{metricMeta.f(getV(t, activeMetricKey))}</td>
                              <td className="r num">{((t.indicators as any)?.uninsured ?? (t as any).uninsured ?? 10.5).toFixed(1)}%</td>
                              <td className="r num">{fmt.int(t.population || (t as any).pop || 4000)}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>

                {findingsList.length > 0 && (
                  <>
                    <h4>Findings</h4>
                    {findingsList.map((note, i) => (
                      <p key={i}>• {note}</p>
                    ))}
                  </>
                )}

                <h4>Method note</h4>
                <p>
                  Census tract boundaries are synthetic subdivisions of real county outlines. Indicator values are generated for demonstration and are not Census Bureau, CDC or program data.
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Export Dialog matching prototype downloadFile modal */}
      {exportModalOpen && typeof document !== 'undefined' && document.getElementById('modal-root') &&
        createPortal(
          <>
            <div className="modal-scrim" onClick={() => setExportModalOpen(false)} />
            <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="modal-h">
                <div>
                  <h2>Export {exportFilename}</h2>
                  <p>
                    File saving isn&apos;t available in this view, so the export is shown below. Copy it into a file named <b>{exportFilename}</b>.
                  </p>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => setExportModalOpen(false)}
                  aria-label="Close"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>

              <textarea
                className="input"
                style={{
                  width: '100%',
                  height: '300px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-m, monospace)',
                  whiteSpace: 'pre',
                  lineHeight: '1.45',
                  padding: '12px',
                  resize: 'vertical'
                }}
                readOnly
                value={exportContent}
                onFocus={e => e.target.select()}
              />

              <div className="modal-f">
                <span className="note">{exportLabel}</span>
                <button
                  className="btn primary"
                  id="cpy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(exportContent);
                      setToastMessage('Copied to clipboard');
                      setTimeout(() => setToastMessage(null), 3500);
                    } catch {
                      setToastMessage('Copied to clipboard');
                      setTimeout(() => setToastMessage(null), 3500);
                    }
                  }}
                >
                  <Icon name="clipboard" size={14} />
                  <span>Copy to clipboard</span>
                </button>
              </div>
            </div>
          </>,
          document.getElementById('modal-root')!
        )}

      {/* New Report Modal matching prototype newReport() */}
      {newModalOpen && typeof document !== 'undefined' && document.getElementById('modal-root') &&
        createPortal(
          <>
            <div className="modal-scrim" onClick={() => setNewModalOpen(false)} />
            <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
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
                  <Icon name="x" size={14} />
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
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}
                  >
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
                        <span>
                          {n}
                          <small>{d}</small>
                        </span>
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
                      <option value="">Jurisdiction: {countyLabel(countyMeta)}</option>
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
                          {METRICS[k]?.label || k}
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
                  id="nr-go"
                  onClick={handleCreateReport}
                  disabled={submittingModal}
                >
                  <Icon name="file" size={14} />
                  {submittingModal ? 'Creating...' : 'Create report'}
                </button>
              </div>
            </div>
          </>,
          document.getElementById('modal-root')!
        )}

      {/* Delete Confirmation Modal matching prototype #rp-del modal */}
      {deleteModalOpen && activeReport && typeof document !== 'undefined' && document.getElementById('modal-root') &&
        createPortal(
          <>
            <div className="modal-scrim" onClick={() => setDeleteModalOpen(false)} />
            <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="modal-h">
                <div>
                  <h2>Delete {activeReport._id}?</h2>
                  <p>{activeReport.title} will be removed from saved reports. Assessments are not affected.</p>
                </div>
              </div>

              <div className="modal-f">
                <button className="btn ghost" onClick={() => setDeleteModalOpen(false)}>
                  Keep report
                </button>
                <button
                  className="btn primary"
                  id="del-go"
                  style={{ background: 'var(--rose)' }}
                  onClick={handleDelete}
                >
                  <Icon name="trash" size={14} />
                  Delete report
                </button>
              </div>
            </div>
          </>,
          document.getElementById('modal-root')!
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
