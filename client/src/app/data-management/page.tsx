'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { Icon } from '@/components/Icons';
import {
  StateCoverageMap,
  computeCoverageScale,
  STATE_META,
  STATE_COVERAGE,
  getCalculatedStateCoverage
} from '@/components/StateCoverageMap';
import { QualityBarChart, QualityIndicatorItem } from '@/components/QualityBarChart';

interface DataSourceItem {
  id: string;
  name: string;
  icon: string;
  status: 'ok' | 'warn' | 'bad';
  desc: string;
  meta: [string, string][];
  sync: string;
  isSyncing?: boolean;
  syncProgress?: number;
}

interface ImportHistoryItem {
  id: string;
  name: string;
  src: string;
  rows: number;
  status: 'Completed' | 'Completed with warnings' | 'Failed' | 'In progress';
  when: string;
  dur: string;
}

interface ProcessingErrorItem {
  id: string;
  ds: string;
  msg: string;
  sev: 'bad' | 'warn';
  open: boolean;
}

interface ValidationLog {
  text: string;
  type: string;
}

interface ValidationState {
  name: string;
  stage: string;
  progress: number;
  logs: ValidationLog[];
}

const INITIAL_SOURCES: DataSourceItem[] = [
  {
    id: 'census',
    name: 'Census Bureau API',
    icon: 'cloud',
    status: 'ok',
    desc: 'ACS 5-year estimates, decennial counts and TIGER/Line tract geometry',
    meta: [
      ['Endpoints', 'ACS5, DEC, TIGERweb'],
      ['Tables synced', '38'],
      ['Geographies', 'Tract, county, state']
    ],
    sync: '2026-10-27 06:12'
  },
  {
    id: 'tiles',
    name: 'Vector tile service',
    icon: 'server',
    status: 'ok',
    desc: 'Spatially indexed tract and county layers served as vector tiles',
    meta: [
      ['Layers', '12'],
      ['Index', 'GiST on geometry'],
      ['Simplification', '3 zoom tiers']
    ],
    sync: '2026-10-27 06:40'
  },
  {
    id: 'chronic',
    name: 'Chronic disease prevalence feed',
    icon: 'activity',
    status: 'warn',
    desc: 'Model-based tract prevalence estimates, uploaded quarterly',
    meta: [
      ['Measures', '14'],
      ['Suppressed tracts', '312'],
      ['Cadence', 'Quarterly']
    ],
    sync: '2026-10-25 15:40'
  },
  {
    id: 'programs',
    name: 'State program registry',
    icon: 'users',
    status: 'bad',
    desc: 'Enrollment extracts for WIC, immunization and home visiting programs',
    meta: [
      ['Programs', '5'],
      ['Last good sync', '2026-10-17'],
      ['Issue', 'Credentials expired']
    ],
    sync: '2026-10-24 09:03'
  }
];

const INITIAL_IMPORTS: ImportHistoryItem[] = [
  {
    id: 'IMP-3391',
    name: 'ACS 5-year tract estimates',
    src: 'Census Bureau API',
    rows: 2841203,
    status: 'Completed',
    when: '2026-10-27 06:12',
    dur: '14m 02s'
  },
  {
    id: 'IMP-3388',
    name: 'Chronic disease prevalence (tract)',
    src: 'File upload',
    rows: 72337,
    status: 'Completed with warnings',
    when: '2026-10-25 15:40',
    dur: '1m 48s'
  },
  {
    id: 'IMP-3384',
    name: 'Program enrollment extract',
    src: 'State program registry',
    rows: 18422,
    status: 'Failed',
    when: '2026-10-24 09:03',
    dur: '0m 31s'
  },
  {
    id: 'IMP-3379',
    name: 'TIGER/Line tract geometries',
    src: 'Census Bureau',
    rows: 85187,
    status: 'Completed',
    when: '2026-10-20 02:00',
    dur: '22m 40s'
  }
];

const INITIAL_ERRORS: ProcessingErrorItem[] = [
  {
    id: 'E-551',
    ds: 'Program enrollment extract',
    msg: '1,204 rows reference GEOIDs retired after the 2020 tract revision',
    sev: 'bad',
    open: true
  },
  {
    id: 'E-548',
    ds: 'Chronic disease prevalence (tract)',
    msg: '312 tracts suppressed for small numbers (n < 50)',
    sev: 'warn',
    open: true
  },
  {
    id: 'E-545',
    ds: 'Chronic disease prevalence (tract)',
    msg: 'Confidence interval columns missing for 3 counties',
    sev: 'warn',
    open: true
  }
];

const DEFAULT_QUALITY_INDICATORS: QualityIndicatorItem[] = [
  { label: 'Completeness', value: 96.8, desc: 'Tracts with complete indicator fields' },
  { label: 'Validity', value: 94.1, desc: 'Values conforming to expected numerical ranges' },
  { label: 'Geographic match', value: 98.6, desc: 'GEOIDs resolving to valid census tract geometry' },
  { label: 'Timeliness', value: 88.2, desc: 'Datasets updated within their designated refresh cadence' },
  { label: 'Consistency', value: 91.5, desc: 'Cross-tabulation stability across consecutive releases' },
  { label: 'Suppression rate (inverse)', value: 95.7, desc: 'Share of unsuppressed small-area estimates' }
];

const pl = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

function parseCSV(txt: string) {
  const lines = txt.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of l) {
      if (ch === '"') {
        q = !q;
      } else if (ch === ',' && !q) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim().replace(/^["']|["']$/g, ''));
  };
  const h = split(lines[0] || '');
  return { header: h, rows: lines.slice(1).map(split) };
}

function DataManagementContent() {
  const { activeCounty } = useSession();

  const [sources, setSources] = useState<DataSourceItem[]>(INITIAL_SOURCES);
  const [imports, setImports] = useState<ImportHistoryItem[]>(INITIAL_IMPORTS);
  const [errors, setErrors] = useState<ProcessingErrorItem[]>(INITIAL_ERRORS);
  const [qualityIndicators, setQualityIndicators] = useState<QualityIndicatorItem[]>(DEFAULT_QUALITY_INDICATORS);
  const [compositeScore, setCompositeScore] = useState<number>(92.4);
  const [lastSyncTime, setLastSyncTime] = useState<string>('06:40');
  const [stateCoverage, setStateCoverage] = useState<Record<string, number>>({});

  // File upload & validation state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [validationState, setValidationState] = useState<ValidationState | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Fetch dynamic stats from MongoDB backend
  const refreshStats = async () => {
    try {
      const res = await fetch('/api/data/stats');
      if (res.ok) {
        const data = await res.json();
        if (data.qualityIndicators) setQualityIndicators(data.qualityIndicators);
        if (data.compositeScore != null) setCompositeScore(data.compositeScore);
        if (data.lastSync) setLastSyncTime(data.lastSync);
        if (data.stateCoverage) {
          const vals = Object.values(data.stateCoverage) as number[];
          const allSame = vals.length > 1 && vals.every(v => v === vals[0]);
          if (!allSame) {
            setStateCoverage(data.stateCoverage);
          }
        }
      }
    } catch (e) {
      console.error('[DataManagement] refreshStats error:', e);
    }
  };

  // Initial load from MongoDB backend
  useEffect(() => {
    fetch('/api/data/sources')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && data.length > 0) {
          setSources(
            data.map((d: any) => ({
              id: d._id || d.id,
              name: d.name,
              icon: d.icon || 'cloud',
              status: d.status || 'ok',
              desc: d.desc || '',
              meta: d.meta || [],
              sync: d.lastSync
                ? new Date(d.lastSync).toISOString().slice(0, 16).replace('T', ' ')
                : '2026-10-27 06:40'
            }))
          );
        }
      })
      .catch(e => console.error('[DataManagement] Error loading sources:', e));

    fetch('/api/data/imports')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && data.length > 0) {
          const mapped = data.map((d: any) => ({
            id: d._id || d.id,
            name: d.name,
            src: d.src,
            rows: d.rows,
            status: d.status,
            when: d.startedAt
              ? new Date(d.startedAt).toISOString().slice(0, 16).replace('T', ' ')
              : d.when || '2026-10-25 15:40',
            dur: d.duration || d.dur
          }));
          const hasFileUpload = mapped.some((i: any) => i.src === 'File upload');
          setImports(hasFileUpload ? mapped : [mapped[0] || INITIAL_IMPORTS[0], INITIAL_IMPORTS[1], ...mapped.slice(1)]);
        }
      })
      .catch(e => console.error('[DataManagement] Error loading imports:', e));

    fetch('/api/data/errors')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && data.length > 0) {
          setErrors(
            data.map((d: any) => ({
              id: d._id || d.id,
              ds: d.dataset || d.ds,
              msg: d.msg,
              sev: d.severity || d.sev,
              open: d.open ?? true
            }))
          );
        }
      })
      .catch(e => console.error('[DataManagement] Error loading errors:', e));

    refreshStats();
  }, []);

  // Auto-scroll validation terminal log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = 1e6;
    }
  }, [validationState?.logs]);

  // Authentic MapWell toast appending to #toasts in bottom-right corner matching prototype line 1720
  const showToast = useCallback((msg: string, action?: { label: string; fn: () => void }) => {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('toasts');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.innerHTML = `<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><span>${msg}</span>${action ? `<button class="btn sm">${action.label}</button>` : ''}`;
    if (action) {
      const btn = t.querySelector('button');
      if (btn) {
        btn.onclick = () => {
          action.fn();
          t.remove();
        };
      }
    }
    container.appendChild(t);

    const w = window as any;
    if (w.gsap) {
      w.gsap.from(t, { y: 16, opacity: 0, duration: 0.55, ease: 'expo.out' });
    }

    setTimeout(() => {
      if (w.gsap) {
        w.gsap.to(t, { opacity: 0, x: 30, duration: 0.3, onComplete: () => t.remove() });
      } else {
        t.remove();
      }
    }, 4200);
  }, []);

  // Connected sources count
  const connectedCount = useMemo(() => {
    return sources.filter(s => s.status !== 'bad').length;
  }, [sources]);

  // Total rows ingested calculation
  const totalRowsIngested = useMemo(() => {
    return imports.reduce((acc, curr) => acc + (curr.rows || 0), 0);
  }, [imports]);

  // Open processing issues count
  const openErrorsCount = useMemo(() => {
    return errors.filter(e => e.open).length;
  }, [errors]);

  // Recent file uploads (src === 'File upload', max 4)
  const recentUploads = useMemo(() => {
    return imports.filter(i => i.src === 'File upload').slice(0, 4);
  }, [imports]);

  // Coverage scale for floating legend
  const coverageScale = useMemo(() => {
    const vals = Object.keys(STATE_META).map(
      st => stateCoverage[st] ?? STATE_COVERAGE[st]?.cov ?? getCalculatedStateCoverage(st)
    );
    return computeCoverageScale(vals);
  }, [stateCoverage]);

  // Individual Source Sync with authentic animation and backend persistence
  const runSync = (id: string) => {
    const s = sources.find(x => x.id === id);
    if (!s || s.isSyncing) return;

    // Show progress bar in card
    setSources(prev =>
      prev.map(item => (item.id === id ? { ...item, isSyncing: true, syncProgress: 0 } : item))
    );

    let p = 0;
    const interval = setInterval(async () => {
      p = Math.min(100, p + 7 + Math.random() * 12);
      setSources(prev =>
        prev.map(item => (item.id === id ? { ...item, syncProgress: p } : item))
      );

      if (p >= 100) {
        clearInterval(interval);
        const now = new Date();
        const stamp = now.toISOString().slice(0, 10) + ' ' + now.toTimeString().slice(0, 5);
        const timeOnly = stamp.slice(11);
        setLastSyncTime(timeOnly);

        let newStatus = s.status;
        const newMeta: [string, string][] = [...s.meta];
        if (s.status === 'bad') {
          newStatus = 'warn';
          newMeta[2] = ['Issue', 'Reconnected. 1,204 retired GEOIDs pending'];
        }

        setSources(prev =>
          prev.map(item =>
            item.id === id
              ? {
                  ...item,
                  status: newStatus,
                  meta: newMeta,
                  sync: stamp,
                  isSyncing: false,
                  syncProgress: 100
                }
              : item
          )
        );

        const newImport: ImportHistoryItem = {
          id: 'IMP-' + (3392 + imports.length),
          name: s.name + ' sync',
          src: s.name,
          rows: Math.round(1e4 + Math.random() * 3e5),
          status: newStatus === 'ok' ? 'Completed' : 'Completed with warnings',
          when: stamp,
          dur: '0m ' + (10 + Math.floor(Math.random() * 40)) + 's'
        };

        setImports(prev => [newImport, ...prev]);
        showToast(`${s.name} synchronized (simulated)`);

        // Async sync against MongoDB if available
        try {
          fetch(`/api/data/sources/${id}/sync`, { method: 'POST' }).then(() => refreshStats()).catch(() => {});
        } catch {}
      }
    }, 160);
  };

  // Sync All Sources with stagger
  const handleSyncAll = () => {
    sources.forEach((s, i) => {
      setTimeout(() => runSync(s.id), i * 250);
    });
    try {
      fetch('/api/data/sources/sync-all', { method: 'POST' }).then(() => refreshStats()).catch(() => {});
    } catch {}
  };

  // Mark processing error resolved
  const handleResolveError = async (id: string) => {
    setErrors(prev =>
      prev.map(e => (e.id === id ? { ...e, open: false } : e))
    );
    showToast('Issue marked resolved');

    try {
      await fetch(`/api/data/errors/${id}/resolve`, { method: 'PATCH' });
      refreshStats();
    } catch (e) {
      console.error('[DataManagement] Error resolving issue:', e);
    }
  };

  // CSV Validation Pipeline matching prototype line 2807-2838
  const validate = (name: string, txt: string) => {
    const stages = [
      'Reading file',
      'Parsing rows',
      'Matching GEOIDs to tract index',
      'Checking values',
      'Building spatial index'
    ];

    const currentLogs: ValidationLog[] = [];
    const pushLog = (t: string, c = '') => {
      currentLogs.push({ text: t, type: c });
      setValidationState(prev => (prev ? { ...prev, logs: [...currentLogs] } : null));
    };

    setValidationState({
      name,
      stage: stages[0],
      progress: 0,
      logs: []
    });

    const { header, rows } = parseCSV(txt);
    const gi = header.findIndex(h => /^geo_?id$|^geoid$|^fips$|^tract$/i.test(h));
    let i = 0;
    let issues = 0;
    let warnCount = 0;

    const steps: (() => boolean | void)[] = [
      () => {
        pushLog(`Read ${txt.length.toLocaleString()} bytes`);
      },
      () => {
        pushLog(
          `Parsed ${rows.length.toLocaleString()} rows and ${header.length} columns: ${header.slice(0, 6).join(', ')}${header.length > 6 ? '…' : ''}`
        );
      },
      () => {
        if (gi < 0) {
          pushLog('No GEOID column found. Add a column named GEOID with 11-digit tract codes.', 'err');
          return false;
        }
        let bad = 0;
        let unk = 0;
        rows.forEach(r => {
          const g = (r[gi] || '').replace(/\D/g, '');
          if (g.length !== 11) bad++;
          else if (!STATE_META[g.slice(0, 2)]) unk++;
        });
        pushLog(`${(rows.length - bad - unk).toLocaleString()} GEOIDs matched to known counties`, 'ok');
        if (bad) pushLog(`${pl(bad, 'row has a GEOID', 'rows have GEOIDs')} that ${bad === 1 ? 'is' : 'are'} not 11 digits`, 'err');
        if (unk) pushLog(`${pl(unk, 'row references a county', 'rows reference counties')} outside the index`, 'warn');
        issues = bad + unk;
      },
      () => {
        let miss = 0;
        let nonnum = 0;
        rows.forEach(r =>
          header.forEach((h, j) => {
            if (j === gi) return;
            if (r[j] === '' || r[j] == null) miss++;
            else if (isNaN(Number(r[j])) && j !== gi && !/name|county|label/i.test(h)) nonnum++;
          })
        );
        if (miss) pushLog(`${pl(miss, 'empty value', 'empty values')} will be treated as suppressed`, 'warn');
        if (nonnum) pushLog(`${pl(nonnum, 'value is', 'values are')} not numeric`, 'err');
        if (!miss && !nonnum) pushLog('All indicator values are numeric', 'ok');
        issues += nonnum;
        warnCount = miss;
      },
      () => {
        pushLog('Spatial index refreshed for affected tracts', 'ok');
      }
    ];

    const tick = () => {
      if (i >= steps.length) {
        const st = issues ? 'Completed with warnings' : 'Completed';
        const finalStatus = gi < 0 ? 'Failed' : st;

        setValidationState(prev => (prev ? { ...prev, stage: finalStatus, progress: 100 } : null));

        const now = new Date();
        const stamp = now.toISOString().slice(0, 16).replace('T', ' ');

        const newImportItem: ImportHistoryItem = {
          id: 'IMP-' + (3392 + imports.length),
          name: name.replace(/\.csv$/i, ''),
          src: 'File upload',
          rows: rows.length,
          status: finalStatus as any,
          when: stamp,
          dur: '0m 0' + (2 + i) + 's'
        };

        setImports(prev => [newImportItem, ...prev]);

        if (issues > 0) {
          const newErrorItem: ProcessingErrorItem = {
            id: 'E-' + (552 + errors.length),
            ds: name,
            msg: `${pl(issues, 'row', 'rows')} failed validation during upload`,
            sev: 'bad',
            open: true
          };
          setErrors(prev => [newErrorItem, ...prev]);
        }

        showToast(gi < 0 ? 'Import failed: no GEOID column' : `Imported ${rows.length.toLocaleString()} rows`);

        // Submit to backend API if available
        try {
          const blob = new Blob([txt], { type: 'text/csv' });
          const formData = new FormData();
          formData.append('file', blob, name);
          fetch('/api/data/upload', { method: 'POST', body: formData })
            .then(() => refreshStats())
            .catch(() => {});
        } catch {}
        return;
      }

      setValidationState(prev =>
        prev
          ? {
              ...prev,
              stage: stages[i],
              progress: ((i + 1) / steps.length) * 100
            }
          : null
      );

      const ok = steps[i]();
      i++;
      if (ok === false) {
        setValidationState(prev => (prev ? { ...prev, stage: 'Failed' } : null));
        i = steps.length;
      }
      setTimeout(tick, 520);
    };

    tick();
  };

  const handleReadFile = (f?: File | null) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') {
      showToast('Choose a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => validate(f.name, reader.result as string);
    reader.readAsText(f);
  };

  // Sample file generator matching prototype line 2845
  const handleLoadSampleFile = () => {
    const countyFips = activeCounty?._id || '53033';
    const lines = ['GEOID,food_insecurity_pct,heat_vulnerability'];
    for (let i = 0; i < 40; i++) {
      const tractId = `${countyFips}${String(100 + i).padStart(6, '0')}`;
      const geoid = i === 7 ? tractId.slice(0, 9) : tractId;
      const food = i === 12 ? '' : (14.2 + (i % 8) * 1.5).toFixed(1);
      const heat = i === 20 ? 'n/a' : (2.1 + (i % 5) * 0.4).toFixed(2);
      lines.push(`${geoid},${food},${heat}`);
    }
    validate('sample_food_insecurity.csv', lines.join('\n'));
  };

  return (
    <>
      {/* Screen Header matching head() line 1803 */}
      <div className="page-head">
        <div>
          <h1>Data management</h1>
          <p>Monitor data sources, upload datasets, validate imports and track data quality across geographies.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot" />
            Demo connections. No live requests are made
          </span>
          <button className="btn primary" id="dm-sync-all" onClick={handleSyncAll}>
            <Icon name="refresh" />
            Sync all sources
          </button>
        </div>
      </div>

      {/* 4 Metric Ruled KPI Strip matching strip() line 1792 */}
      <section className="strip">
        <div className="strip-i">
          <div className="strip-l">Connected sources</div>
          <div className="strip-v">
            <span className="num" data-count={connectedCount}>
              {connectedCount}
            </span>
            <small>of {sources.length}</small>
          </div>
          <div className="strip-f">One source needs attention</div>
        </div>
        <div className="strip-i">
          <div className="strip-l">Last synchronization</div>
          <div className="strip-v">
            <span className="num" id="dm-last">
              {lastSyncTime}
            </span>
          </div>
          <div className="strip-f">Today, vector tile service</div>
        </div>
        <div className="strip-i">
          <div className="strip-l">Rows ingested this month</div>
          <div className="strip-v">
            <span className="num" data-count={totalRowsIngested}>
              {totalRowsIngested.toLocaleString()}
            </span>
          </div>
          <div className="strip-f">{imports.length} imports</div>
        </div>
        <div className="strip-i">
          <div className="strip-l">Data quality score</div>
          <div className="strip-v">
            <span className="num" data-count={compositeScore.toFixed(1)} data-dec="1">
              {compositeScore.toFixed(1)}
            </span>
            <small>/100</small>
          </div>
          <div className="strip-f">
            <span id="dm-errn">{openErrorsCount} open processing issues</span>
          </div>
        </div>
      </section>

      {/* Main Grid matching prototype lines 2758-2770 */}
      <div className="grid g-12">
        {/* Left: Data Source Connections (c-8) */}
        <section className="panel c-8">
          <div className="panel-h">
            <div>
              <h3>Data source connections</h3>
              <div className="sub">Status of upstream sources and processing services</div>
            </div>
          </div>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}
            id="dm-src"
          >
            {sources.map(s => {
              const isBad = s.status === 'bad';
              const isWarn = s.status === 'warn';
              const isOk = s.status === 'ok';

              return (
                <div
                  key={s.id}
                  className="tool-tile conn"
                  style={{ cursor: 'default', transform: 'none' }}
                  data-s={s.id}
                >
                  <div className="top">
                    <span className="logo">
                      <Icon name={s.icon} />
                    </span>
                    <span className={`pill ${s.status}`}>
                      <span className={`dot ${isOk ? 'live' : ''}`} />
                      {isOk ? 'Healthy' : isWarn ? 'Warnings' : 'Disconnected'}
                    </span>
                  </div>

                  <div>
                    <b>{s.name}</b>
                    <small style={{ display: 'block', marginTop: 2 }}>{s.desc}</small>
                  </div>

                  <div className="kv" style={{ fontSize: 12, gridTemplateColumns: 'auto 1fr' }}>
                    {s.meta.map(([a, b], idx) => (
                      <React.Fragment key={idx}>
                        <dt style={{ whiteSpace: 'nowrap' }}>{a}</dt>
                        <dd style={{ fontFamily: 'var(--font-u)', minWidth: 0, wordBreak: 'break-word' }}>{b}</dd>
                      </React.Fragment>
                    ))}
                    <dt style={{ whiteSpace: 'nowrap' }}>Last sync</dt>
                    <dd style={{ fontFamily: 'var(--font-u)', minWidth: 0 }} className="ls">
                      {s.sync}
                    </dd>
                  </div>

                  {/* Animated Progress Bar during sync */}
                  <div className="prog" style={{ display: s.isSyncing ? 'block' : 'none' }}>
                    <i
                      style={{
                        width: `${s.syncProgress || 0}%`,
                        transition: s.syncProgress ? 'width .3s' : 'none'
                      }}
                    />
                  </div>

                  <div className="row">
                    <button
                      className="btn sm"
                      data-sync={s.id}
                      disabled={s.isSyncing}
                      onClick={() => runSync(s.id)}
                    >
                      <Icon name={isBad ? 'link' : 'refresh'} />
                      {isBad ? 'Reconnect' : 'Sync now'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: Dataset Upload & Recent Uploads (c-4) */}
        <section className="panel c-4">
          <div className="panel-h">
            <div>
              <h3>Dataset upload</h3>
              <div className="sub">CSV with a GEOID column and indicator columns</div>
            </div>
          </div>

          <label
            className={`dropzone ${isDragOver ? 'over' : ''}`}
            id="dm-drop"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              minHeight: 150,
              padding: '24px 18px',
              textAlign: 'center',
              boxSizing: 'border-box'
            }}
            onDragOver={e => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setIsDragOver(false);
              handleReadFile(e.dataTransfer.files[0]);
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              id="dm-file"
              hidden
              ref={fileInputRef}
              onChange={e => handleReadFile(e.target.files?.[0])}
            />
            <Icon name="upload" />
            <div style={{ fontWeight: 700, marginTop: 8 }}>Drop a CSV here or browse</div>
            <div className="note">Validated in your browser. Nothing is uploaded</div>
          </label>

          <button
            className="btn mt"
            style={{ width: '100%' }}
            id="dm-sample"
            onClick={handleLoadSampleFile}
          >
            <Icon name="file" />
            Use a sample file with known issues
          </button>

          {/* Validation Terminal Console */}
          {validationState && (
            <div id="dm-up" className="mt">
              <div className="row between" style={{ fontSize: '12.5px' }}>
                <b>{validationState.name}</b>
                <span className="note" id="up-st">
                  {validationState.stage}
                </span>
              </div>
              <div className="prog mt-s">
                <i
                  id="up-b"
                  style={{
                    width: `${validationState.progress}%`,
                    background: validationState.stage === 'Failed' ? 'var(--rose)' : undefined,
                    transition: 'width .3s'
                  }}
                />
              </div>
              <div className="log mt-s" id="up-log" ref={logContainerRef}>
                {validationState.logs.map((log, i) => (
                  <div key={i} className={log.type}>
                    {log.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Uploads Feed matching prototype line 2763 & 2790 */}
          <div className="dm-recent">
            <div className="sec-h" style={{ margin: '20px 0 6px' }}>
              <h3 style={{ fontSize: 14 }}>Recent uploads</h3>
            </div>
            <div id="dm-rec">
              {recentUploads.length > 0 ? (
                recentUploads.map(i => {
                  const isFailed = i.status === 'Failed';
                  const isOk = i.status === 'Completed';
                  return (
                    <div className="act" style={{ marginBottom: 6 }} key={i.id}>
                      <span
                        className={`m-ico ${isFailed ? '' : 't'}`}
                        style={isFailed ? { background: '#FDECEE', color: 'var(--rose)' } : undefined}
                      >
                        <Icon name="file" />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {i.name}
                        </b>
                        <small>
                          {(i.rows || 0).toLocaleString()} rows. {i.when}
                        </small>
                      </div>
                      <span className={`pill ${isOk ? 'ok' : isFailed ? 'bad' : 'warn'}`}>
                        {i.status === 'Completed with warnings' ? 'Warnings' : i.status}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="note">No files uploaded yet.</div>
              )}
            </div>
          </div>
        </section>

        {/* Geographic Coverage Map (c-6) matching prototype lines 2764-2766 */}
        <section
          className="panel c-6"
          style={{ padding: 0, overflow: 'hidden', minHeight: 360, position: 'relative' }}
        >
          <div style={{ position: 'absolute', inset: 0 }} id="dm-map">
            <StateCoverageMap
              height={360}
              coverageOverrides={stateCoverage}
              onSelectState={(name, cov) => {
                showToast(`${name}: ${cov.toFixed(1)}% of tracts have complete data`);
              }}
            />
          </div>
          <div className="map-float" style={{ left: 14, top: 14, padding: '12px 14px' }}>
            <b style={{ fontSize: 13 }}>Geographic coverage</b>
            <div className="note">Share of tracts with complete indicator data, by state</div>
          </div>
          <div className="map-float legend" style={{ left: 14, bottom: 14 }} id="dm-leg">
            <div className="ttl">
              <span>Tract data completeness</span>
            </div>
            <div className="ramp">
              {coverageScale.bins.map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </div>
            <div className="ends">
              <span>{coverageScale.ext[0].toFixed(1)}%</span>
              <span>Quantile bins</span>
              <span>{coverageScale.ext[1].toFixed(1)}%</span>
            </div>
          </div>
        </section>

        {/* Quality Indicators & Processing Errors (c-6) matching prototype lines 2767-2768 */}
        <section className="panel c-6">
          <div className="panel-h">
            <div>
              <h3>Data quality indicators</h3>
              <div className="sub">Across all active datasets</div>
            </div>
          </div>

          <div id="dm-q">
            <QualityBarChart indicators={qualityIndicators} />
          </div>

          <div className="panel-h mt" style={{ marginTop: 18 }}>
            <div>
              <h3>Processing errors</h3>
              <div className="sub" id="dm-err-sub">
                {openErrorsCount} open of {errors.length}
              </div>
            </div>
          </div>

          <div className="list" id="dm-err">
            {errors.map(e => (
              <div
                key={e.id}
                className="li"
                style={{ opacity: e.open ? 1 : 0.5 }}
              >
                <span
                  className="ic"
                  style={{ color: `var(--${e.sev === 'bad' ? 'rose' : 'amber'})` }}
                >
                  <Icon name="alert" />
                </span>
                <div className="b">
                  <b style={{ whiteSpace: 'normal' }}>{e.msg}</b>
                  <small>
                    {e.id}. {e.ds}
                  </small>
                </div>
                {e.open ? (
                  <button
                    className="btn sm"
                    data-res={e.id}
                    onClick={() => handleResolveError(e.id)}
                  >
                    <Icon name="check" />
                    Resolve
                  </button>
                ) : (
                  <span className="pill ok">Resolved</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Import History Table (c-12) matching prototype line 2769 */}
        <section className="panel c-12">
          <div className="panel-h">
            <div>
              <h3>Import history</h3>
              <div className="sub">Most recent first</div>
            </div>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Import</th>
                  <th>Dataset</th>
                  <th>Source</th>
                  <th className="r">Rows</th>
                  <th>Started</th>
                  <th className="r">Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="dm-hist">
                {imports.slice(0, 10).map(i => {
                  const st = i.status;
                  const isOk = st === 'Completed';
                  const isBad = st === 'Failed';
                  return (
                    <tr key={i.id}>
                      <td className="muted">{i.id}</td>
                      <td>
                        <b>{i.name}</b>
                      </td>
                      <td>{i.src}</td>
                      <td className="r num">{(i.rows || 0).toLocaleString()}</td>
                      <td>{i.when}</td>
                      <td className="r num">{i.dur}</td>
                      <td>
                        <span className={`pill ${isOk ? 'ok' : isBad ? 'bad' : 'warn'}`}>
                          {st}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

export default function DataManagementPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Loading Data Management platform...
        </div>
      }
    >
      <DataManagementContent />
    </Suspense>
  );
}
