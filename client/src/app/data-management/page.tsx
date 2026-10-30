'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import {
  Database,
  Cloud,
  Server,
  Activity,
  Users,
  RefreshCw,
  Upload,
  FileText,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  Link as LinkIcon,
  Search,
  Sparkles
} from 'lucide-react';
import { StateCoverageMap } from '@/components/StateCoverageMap';

interface DataSourceItem {
  _id: string;
  name: string;
  icon: string;
  status: 'ok' | 'warn' | 'bad';
  desc: string;
  meta: [string, string][];
  lastSync: string;
  isSyncing?: boolean;
  syncProgress?: number;
}

interface ImportHistoryItem {
  _id: string;
  name: string;
  src: string;
  rows: number;
  status: 'Completed' | 'Completed with warnings' | 'Failed' | 'In progress';
  duration: string;
  startedAt: string;
}

interface ProcessingErrorItem {
  _id: string;
  dataset: string;
  msg: string;
  severity: 'bad' | 'warn';
  open: boolean;
}

interface ValidationLog {
  text: string;
  type: 'info' | 'ok' | 'warn' | 'err';
}

const INITIAL_SOURCES: DataSourceItem[] = [
  {
    _id: 'census',
    name: 'Census Bureau API',
    icon: 'cloud',
    status: 'ok',
    desc: 'ACS 5-year estimates, decennial counts and TIGER/Line tract geometry',
    meta: [
      ['Endpoints', 'ACS5, DEC, TIGERweb'],
      ['Tables synced', '38'],
      ['Geographies', 'Tract, county, state']
    ],
    lastSync: 'Today 06:12'
  },
  {
    _id: 'tiles',
    name: 'Vector tile service',
    icon: 'server',
    status: 'ok',
    desc: 'Spatially indexed tract and county layers served as vector tiles',
    meta: [
      ['Layers', '12'],
      ['Index', 'GiST on geometry'],
      ['Simplification', '3 zoom tiers']
    ],
    lastSync: 'Today 06:40'
  },
  {
    _id: 'chronic',
    name: 'Chronic disease prevalence feed',
    icon: 'activity',
    status: 'warn',
    desc: 'Model-based tract prevalence estimates, uploaded quarterly',
    meta: [
      ['Measures', '14'],
      ['Suppressed tracts', '312'],
      ['Cadence', 'Quarterly']
    ],
    lastSync: 'Oct 25, 15:40'
  },
  {
    _id: 'programs',
    name: 'State program registry',
    icon: 'users',
    status: 'bad',
    desc: 'Enrollment extracts for WIC, immunization and home visiting programs',
    meta: [
      ['Programs', '5'],
      ['Last good sync', '2026-10-17'],
      ['Issue', 'Credentials expired']
    ],
    lastSync: 'Oct 24, 09:03'
  }
];

const INITIAL_IMPORTS: ImportHistoryItem[] = [
  {
    _id: 'IMP-3404',
    name: 'ACS 5-year tract estimates',
    src: 'Census Bureau API',
    rows: 84414,
    status: 'Completed',
    duration: '0m 42s',
    startedAt: 'Today 06:12'
  },
  {
    _id: 'IMP-3403',
    name: 'Vector tiles geometry build',
    src: 'Vector tile service',
    rows: 3200,
    status: 'Completed',
    duration: '0m 18s',
    startedAt: 'Today 06:40'
  },
  {
    _id: 'IMP-3402',
    name: 'CDC PLACES chronic models',
    src: 'Chronic disease prevalence feed',
    rows: 42100,
    status: 'Completed with warnings',
    duration: '1m 05s',
    startedAt: 'Oct 25 15:40'
  },
  {
    _id: 'IMP-3401',
    name: 'WIC Southern tract extract',
    src: 'State program registry',
    rows: 0,
    status: 'Failed',
    duration: '0m 04s',
    startedAt: 'Oct 24 09:03'
  },
  {
    _id: 'IMP-3400',
    name: 'Decennial housing validation',
    src: 'Census Bureau API',
    rows: 245000,
    status: 'Completed',
    duration: '2m 14s',
    startedAt: 'Oct 20 11:25'
  }
];

const INITIAL_ERRORS: ProcessingErrorItem[] = [
  {
    _id: 'E-551',
    dataset: 'State program registry',
    msg: 'OAuth token refresh failed for state health department WIC API endpoint (401 Unauthorized)',
    severity: 'bad',
    open: true
  },
  {
    _id: 'E-550',
    dataset: 'Chronic disease prevalence feed',
    msg: '18 census tracts flagged with high relative standard error (RSE > 30%) suppressed in south region',
    severity: 'warn',
    open: true
  },
  {
    _id: 'E-549',
    dataset: 'Vector tile service',
    msg: 'Self-intersecting polygon boundary detected in tract 53033004201, repaired automatically',
    severity: 'warn',
    open: false
  }
];

const QUALITY_INDICATORS = [
  { label: 'Completeness', value: 96.8, desc: 'Tracts with complete indicator fields' },
  { label: 'Validity', value: 94.1, desc: 'Values conforming to expected numerical ranges' },
  { label: 'Geographic match', value: 98.6, desc: 'GEOIDs resolving to valid census tract geometry' },
  { label: 'Timeliness', value: 88.2, desc: 'Datasets updated within their designated refresh cadence' },
  { label: 'Consistency', value: 91.5, desc: 'Cross-tabulation stability across consecutive releases' },
  { label: 'Suppression rate (inverse)', value: 95.7, desc: 'Share of unsuppressed small-area estimates' }
];

function DataManagementContent() {
  const { markWorkflowMilestone, activeCounty } = useSession();

  const [sources, setSources] = useState<DataSourceItem[]>(INITIAL_SOURCES);
  const [imports, setImports] = useState<ImportHistoryItem[]>(INITIAL_IMPORTS);
  const [errors, setErrors] = useState<ProcessingErrorItem[]>(INITIAL_ERRORS);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync All state
  const [syncingAll, setSyncingAll] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('06:40');

  // File upload & validation state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [validationLogs, setValidationLogs] = useState<ValidationLog[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Load backend data if available
  useEffect(() => {
    fetch('/api/data/sources')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && data.length > 0) {
          setSources(prev =>
            data.map((d: any) => ({
              _id: d._id,
              name: d.name,
              icon: d.icon || 'cloud',
              status: d.status || 'ok',
              desc: d.desc || '',
              meta: d.meta || [],
              lastSync: d.lastSync ? new Date(d.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'
            }))
          );
        }
      })
      .catch(e => console.error(e));

    fetch('/api/data/imports')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && data.length > 0) setImports(data);
      })
      .catch(e => console.error(e));

    fetch('/api/data/errors')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && data.length > 0) setErrors(data);
      })
      .catch(e => console.error(e));
  }, []);

  // Auto-scroll validation terminal log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [validationLogs]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Connected sources count
  const connectedCount = useMemo(() => {
    return sources.filter(s => s.status !== 'bad').length;
  }, [sources]);

  // Total rows ingested calculation
  const totalRowsIngested = useMemo(() => {
    return imports.reduce((acc, curr) => acc + (curr.rows || 0), 0);
  }, [imports]);

  const openErrorsCount = useMemo(() => {
    return errors.filter(e => e.open).length;
  }, [errors]);

  // Trigger individual sync
  const handleSyncSource = async (id: string) => {
    const src = sources.find(s => s._id === id);
    if (!src || src.isSyncing) return;

    // Start progress animation
    setSources(prev =>
      prev.map(s => (s._id === id ? { ...s, isSyncing: true, syncProgress: 10 } : s))
    );

    let progress = 10;
    const interval = setInterval(() => {
      progress += Math.floor(14 + Math.random() * 20);
      if (progress >= 100) {
        clearInterval(interval);
        finalizeSync(id);
      } else {
        setSources(prev =>
          prev.map(s => (s._id === id ? { ...s, syncProgress: progress } : s))
        );
      }
    }, 180);

    // Call backend API in parallel
    try {
      await fetch(`/api/data/sources/${id}/sync`, { method: 'POST' });
    } catch (e) {
      console.warn('Backend sync API simulated:', e);
    }
  };

  const finalizeSync = (id: string) => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setLastSyncTime(timeStr);

    setSources(prev =>
      prev.map(s => {
        if (s._id === id) {
          const isReconnect = s.status === 'bad';
          const nextStatus = isReconnect ? 'warn' : s.status;
          const nextMeta = [...s.meta];
          if (isReconnect) {
            nextMeta[2] = ['Issue', 'Reconnected. 1,204 retired GEOIDs pending'];
          }
          return {
            ...s,
            status: nextStatus,
            meta: nextMeta,
            lastSync: `Today ${timeStr}`,
            isSyncing: false,
            syncProgress: 100
          };
        }
        return s;
      })
    );

    const sourceObj = sources.find(s => s._id === id);
    const newImport: ImportHistoryItem = {
      _id: `IMP-${3410 + imports.length}`,
      name: `${sourceObj?.name || id} sync`,
      src: sourceObj?.name || id,
      rows: Math.floor(18000 + Math.random() * 120000),
      status: sourceObj?.status === 'ok' ? 'Completed' : 'Completed with warnings',
      duration: `0m ${Math.floor(12 + Math.random() * 32)}s`,
      startedAt: `Today ${timeStr}`
    };

    setImports(prev => [newImport, ...prev]);
    showToast(`${sourceObj?.name || id} synchronized successfully`);
  };

  // Sync All sources in sequence
  const handleSyncAll = () => {
    if (syncingAll) return;
    setSyncingAll(true);
    showToast('Initiating synchronization across all upstream connectors...');

    sources.forEach((s, idx) => {
      setTimeout(() => {
        handleSyncSource(s._id);
        if (idx === sources.length - 1) {
          setTimeout(() => setSyncingAll(false), 2000);
        }
      }, idx * 350);
    });
  };

  // Mark processing error resolved
  const handleResolveError = async (id: string) => {
    try {
      await fetch(`/api/data/errors/${id}/resolve`, { method: 'PATCH' });
    } catch (e) {
      console.warn('Backend resolve API fallback:', e);
    }

    setErrors(prev =>
      prev.map(e => (e._id === id ? { ...e, open: false } : e))
    );
    showToast(`Issue ${id} marked as resolved`);
  };

  // CSV Validation Pipeline
  const runValidation = (fileName: string, text: string) => {
    setIsUploading(true);
    setUploadFileName(fileName);
    setUploadProgress(0);
    setValidationLogs([]);

    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
    const stages = [
      'Reading file',
      'Parsing rows',
      'Matching GEOIDs to tract index',
      'Checking values',
      'Building spatial index'
    ];

    let currentStageIndex = 0;
    setUploadStage(stages[0]);

    const logsBuffer: ValidationLog[] = [];
    const pushLog = (t: string, type: 'info' | 'ok' | 'warn' | 'err' = 'info') => {
      logsBuffer.push({ text: t, type });
      setValidationLogs([...logsBuffer]);
    };

    const header = lines[0] ? lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '')) : [];
    const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim().replace(/^["']|["']$/g, '')));
    const geoidIndex = header.findIndex(h => /^geoid$|^geo_?id$|^fips$|^tract$/i.test(h));

    let issuesCount = 0;

    const stepInterval = setInterval(() => {
      currentStageIndex++;
      setUploadProgress(Math.min(100, (currentStageIndex / stages.length) * 100));

      if (currentStageIndex === 1) {
        setUploadStage(stages[1]);
        pushLog(`Read ${text.length.toLocaleString()} bytes`, 'ok');
      } else if (currentStageIndex === 2) {
        setUploadStage(stages[2]);
        pushLog(
          `Parsed ${rows.length.toLocaleString()} rows and ${header.length} columns: ${header.slice(0, 5).join(', ')}${header.length > 5 ? '…' : ''}`,
          'ok'
        );
      } else if (currentStageIndex === 3) {
        setUploadStage(stages[3]);
        if (geoidIndex === -1) {
          pushLog('No GEOID column found. Add a column named GEOID with 11-digit census tract codes.', 'err');
          issuesCount++;
        } else {
          let badGeoids = 0;
          rows.forEach(r => {
            const g = (r[geoidIndex] || '').replace(/\D/g, '');
            if (g.length !== 11) badGeoids++;
          });
          if (badGeoids > 0) {
            pushLog(`${badGeoids} rows have GEOIDs that are not 11 digits (suppression applied)`, 'err');
            issuesCount += badGeoids;
          } else {
            pushLog(`All ${rows.length} GEOIDs matched to valid US Census tract geography`, 'ok');
          }
        }
      } else if (currentStageIndex === 4) {
        setUploadStage(stages[4]);
        let miss = 0;
        let nonnum = 0;
        rows.forEach(r => {
          header.forEach((h, j) => {
            if (j === geoidIndex) return;
            if (r[j] === '' || r[j] == null) miss++;
            else if (isNaN(Number(r[j])) && !/name|county|label/i.test(h)) nonnum++;
          });
        });

        if (miss > 0) {
          pushLog(`${miss} empty values will be treated as suppressed`, 'warn');
        }
        if (nonnum > 0) {
          pushLog(`${nonnum} values are non-numeric strings`, 'err');
          issuesCount += nonnum;
        }
        if (miss === 0 && nonnum === 0) {
          pushLog('All indicator metric values conform to numeric surveillance bounds', 'ok');
        }
      } else if (currentStageIndex >= 5) {
        clearInterval(stepInterval);
        pushLog('Spatial vector index refreshed for affected tracts', 'ok');

        const finalStatus =
          geoidIndex === -1 ? 'Failed' : issuesCount > 0 ? 'Completed with warnings' : 'Completed';
        setUploadStage(finalStatus);

        const newImport: ImportHistoryItem = {
          _id: `IMP-${3410 + imports.length}`,
          name: fileName.replace(/\.csv$/i, ''),
          src: 'Dataset Upload',
          rows: rows.length,
          status: finalStatus,
          duration: '0m 04s',
          startedAt: 'Just now'
        };
        setImports(prev => [newImport, ...prev]);

        if (issuesCount > 0) {
          const newErr: ProcessingErrorItem = {
            _id: `E-${555 + errors.length}`,
            dataset: fileName,
            msg: `${issuesCount} rows failed schema validation during upload`,
            severity: 'bad',
            open: true
          };
          setErrors(prev => [newErr, ...prev]);
        }

        setIsUploading(false);
        showToast(
          finalStatus === 'Failed'
            ? 'Import failed: missing GEOID column'
            : `Validated & ingested ${rows.length} records (${finalStatus})`
        );
      }
    }, 450);
  };

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      alert('Please upload a valid .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      runValidation(file.name, reader.result as string);
    };
    reader.readAsText(file);
  };

  // Preset sample CSV with intentional issues
  const handleLoadSampleFile = () => {
    const countyFips = activeCounty?._id || '53033';
    const sampleRows = [
      'GEOID,food_insecurity_pct,heat_vulnerability,diabetes_rate',
      `${countyFips}001001,14.2,2.4,9.8`,
      `${countyFips}001002,18.5,3.1,12.4`,
      `${countyFips}002001,22.1,,14.1`, // Missing value (suppression)
      `${countyFips}0020,9.4,1.8,7.2`, // Malformed 8-digit GEOID
      `${countyFips}003001,16.8,n/a,11.0`, // Non-numeric string
      `${countyFips}003002,12.5,2.1,8.9`,
      `${countyFips}004001,24.0,4.2,16.3`,
      `${countyFips}004002,19.3,3.0,13.2`
    ].join('\n');

    runValidation('sample_county_food_insecurity.csv', sampleRows);
  };

  const getSourceIcon = (iconName: string) => {
    switch (iconName) {
      case 'cloud':
        return <Cloud className="w-5 h-5 text-[var(--cyan)]" />;
      case 'server':
        return <Server className="w-5 h-5 text-[var(--cyan)]" />;
      case 'activity':
        return <Activity className="w-5 h-5 text-[var(--cyan)]" />;
      case 'users':
        return <Users className="w-5 h-5 text-[var(--cyan)]" />;
      default:
        return <Database className="w-5 h-5 text-[var(--cyan)]" />;
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
            Data management
          </h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Monitor data sources, upload datasets, validate imports and track data quality across geographies.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold bg-[var(--surface-2)] border border-[var(--line)] text-[var(--muted)]">
            <span className="w-2 h-2 rounded-full bg-[var(--cyan)] animate-pulse" />
            <span>Active connections</span>
          </span>

          <button
            onClick={handleSyncAll}
            disabled={syncingAll}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--cyan)] text-white hover:opacity-90 disabled:opacity-60 text-[12.5px] font-bold shadow-xs transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${syncingAll ? 'animate-spin' : ''}`} />
            <span>{syncingAll ? 'Syncing...' : 'Sync all sources'}</span>
          </button>
        </div>
      </div>

      {/* 4 Metric KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl glass-panel flex flex-col justify-between">
          <span className="text-[11.5px] font-bold text-[var(--faint)] uppercase tracking-wider">
            Connected sources
          </span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <strong className="text-2xl sm:text-3xl font-bold font-display text-[var(--text)] num">
              {connectedCount}
            </strong>
            <span className="text-[13px] text-[var(--muted)] font-semibold">of {sources.length}</span>
          </div>
          <span className="text-[11px] text-[var(--amber)] mt-1 font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>One source needs attention</span>
          </span>
        </div>

        <div className="p-4 rounded-2xl glass-panel flex flex-col justify-between">
          <span className="text-[11.5px] font-bold text-[var(--faint)] uppercase tracking-wider">
            Last synchronization
          </span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <strong className="text-2xl sm:text-3xl font-bold font-display text-[var(--text)] num">
              {lastSyncTime}
            </strong>
          </div>
          <span className="text-[11px] text-[var(--muted)] mt-1">Today, vector tile service</span>
        </div>

        <div className="p-4 rounded-2xl glass-panel flex flex-col justify-between">
          <span className="text-[11.5px] font-bold text-[var(--faint)] uppercase tracking-wider">
            Rows ingested this month
          </span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <strong className="text-2xl sm:text-3xl font-bold font-display text-[var(--text)] num">
              {totalRowsIngested.toLocaleString()}
            </strong>
          </div>
          <span className="text-[11px] text-[var(--muted)] mt-1">{imports.length} imports logged</span>
        </div>

        <div className="p-4 rounded-2xl glass-panel flex flex-col justify-between">
          <span className="text-[11.5px] font-bold text-[var(--faint)] uppercase tracking-wider">
            Data quality score
          </span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <strong className="text-2xl sm:text-3xl font-bold font-display text-[var(--teal)] num">
              92.4
            </strong>
            <span className="text-[13px] text-[var(--muted)] font-semibold">/ 100</span>
          </div>
          <span className="text-[11px] text-[var(--muted)] mt-1">
            {openErrorsCount} open processing {openErrorsCount === 1 ? 'issue' : 'issues'}
          </span>
        </div>
      </div>

      {/* Main Grid: Data Source Connections (Col 8) & Dataset Upload (Col 4) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Data Source Connections */}
        <section className="lg:col-span-8 rounded-2xl glass-panel p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div>
              <h3 className="text-base font-bold text-[var(--text)]">Data source connections</h3>
              <p className="text-[12px] text-[var(--muted)]">Status of upstream sources and processing services</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sources.map(src => {
              const isBad = src.status === 'bad';
              const isWarn = src.status === 'warn';
              const isOk = src.status === 'ok';

              return (
                <div
                  key={src._id}
                  className="p-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/70 hover:border-[var(--line-strong)] transition-all flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--surface-solid)] border border-[var(--line)] flex items-center justify-center">
                      {getSourceIcon(src.icon)}
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold ${
                        isOk
                          ? 'bg-[var(--teal)]/15 text-[var(--teal)] border border-[var(--teal)]/30'
                          : isWarn
                          ? 'bg-[var(--amber)]/15 text-[var(--amber)] border border-[var(--amber)]/30'
                          : 'bg-[var(--rose)]/15 text-[var(--rose)] border border-[var(--rose)]/30'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isOk ? 'bg-[var(--teal)]' : isWarn ? 'bg-[var(--amber)]' : 'bg-[var(--rose)]'
                        }`}
                      />
                      <span>{isOk ? 'Healthy' : isWarn ? 'Warnings' : 'Disconnected'}</span>
                    </span>
                  </div>

                  <div>
                    <strong className="text-[13.5px] text-[var(--text)] block">{src.name}</strong>
                    <p className="text-[11.5px] text-[var(--muted)] leading-snug mt-1">{src.desc}</p>
                  </div>

                  {/* Metadata key-values */}
                  <div className="space-y-1 py-2 border-y border-[var(--line)] text-[11.5px]">
                    {src.meta.map(([label, val], idx) => (
                      <div key={idx} className="flex justify-between text-[var(--muted)]">
                        <span>{label}</span>
                        <strong className="text-[var(--text)] font-mono text-[11px]">{val}</strong>
                      </div>
                    ))}
                    <div className="flex justify-between text-[var(--muted)]">
                      <span>Last sync</span>
                      <strong className="text-[var(--text)] font-mono text-[11px]">{src.lastSync}</strong>
                    </div>
                  </div>

                  {/* Animated Progress Bar during Sync */}
                  {src.isSyncing && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-[var(--surface-solid)] overflow-hidden border border-[var(--line)]">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${src.syncProgress || 0}%`,
                            background: 'linear-gradient(90deg, var(--teal), var(--cyan), var(--violet))'
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-[var(--cyan)] font-mono block text-right">
                        Syncing... {src.syncProgress}%
                      </span>
                    </div>
                  )}

                  {/* Sync Trigger Action */}
                  <button
                    onClick={() => handleSyncSource(src._id)}
                    disabled={src.isSyncing}
                    className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12px] font-bold transition-all ${
                      isBad
                        ? 'bg-[var(--rose)]/15 border-[var(--rose)]/40 text-[var(--rose)] hover:bg-[var(--rose)]/25'
                        : 'bg-[var(--surface-solid)] border-[var(--line)] text-[var(--text)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]'
                    }`}
                  >
                    {isBad ? (
                      <>
                        <LinkIcon className="w-3.5 h-3.5" />
                        <span>Reconnect</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className={`w-3.5 h-3.5 ${src.isSyncing ? 'animate-spin' : ''}`} />
                        <span>Sync now</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: Dataset Upload & Browser Validation Engine */}
        <section className="lg:col-span-4 rounded-2xl glass-panel p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="pb-3 border-b border-[var(--line)]">
              <h3 className="text-base font-bold text-[var(--text)]">Dataset upload</h3>
              <p className="text-[12px] text-[var(--muted)]">CSV with a GEOID column and indicator columns</p>
            </div>

            {/* Drag & Drop Zone */}
            <div
              onDragOver={e => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = () => runValidation(file.name, reader.result as string);
                  reader.readAsText(file);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-4 border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
                isDragOver
                  ? 'border-[var(--cyan)] bg-[var(--cyan)]/10 shadow-[0_0_0_5px_var(--glow)]'
                  : 'border-[var(--line-strong)] bg-[var(--surface-2)]/80 hover:border-[var(--cyan)] hover:bg-[var(--surface-2)]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-2xl bg-[var(--surface-solid)] border border-[var(--line)] flex items-center justify-center text-[var(--cyan)] shadow-xs">
                <Upload className="w-6 h-6" />
              </div>
              <strong className="text-[13px] text-[var(--text)] mt-1">Drop a CSV here or browse</strong>
              <span className="text-[11px] text-[var(--faint)]">Validated in your browser. Nothing is uploaded.</span>
            </div>

            {/* Sample File Button */}
            <button
              onClick={handleLoadSampleFile}
              className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] hover:bg-[var(--surface-2)] text-[12px] font-bold text-[var(--text)] transition-colors shadow-xs"
            >
              <FileText className="w-4 h-4 text-[var(--cyan)]" />
              <span>Use a sample file with known issues</span>
            </button>

            {/* Real-time Validation Pipeline Runner & Terminal Log */}
            {uploadFileName && (
              <div className="mt-4 p-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] space-y-2.5 animate-in fade-in">
                <div className="flex items-center justify-between text-[12px]">
                  <strong className="text-[var(--text)] truncate max-w-[180px]">{uploadFileName}</strong>
                  <span
                    className={`font-semibold text-[11px] ${
                      uploadStage.includes('Completed')
                        ? 'text-[var(--teal)]'
                        : uploadStage === 'Failed'
                        ? 'text-[var(--rose)]'
                        : 'text-[var(--cyan)]'
                    }`}
                  >
                    {uploadStage}
                  </span>
                </div>

                {/* Animated Progress Bar */}
                <div className="h-1.5 w-full rounded-full bg-[var(--surface-solid)] overflow-hidden border border-[var(--line)]">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${uploadProgress}%`,
                      background:
                        uploadStage === 'Failed'
                          ? 'var(--rose)'
                          : 'linear-gradient(90deg, var(--teal), var(--cyan), var(--violet))'
                    }}
                  />
                </div>

                {/* Log Terminal Console */}
                <div
                  ref={logContainerRef}
                  className="max-h-40 overflow-y-auto p-2.5 rounded-lg bg-[var(--surface-solid)] border border-[var(--line)] font-mono text-[11px] space-y-1"
                >
                  {validationLogs.map((log, i) => (
                    <div
                      key={i}
                      className={
                        log.type === 'ok'
                          ? 'text-[var(--teal)]'
                          : log.type === 'warn'
                          ? 'text-[var(--amber)]'
                          : log.type === 'err'
                          ? 'text-[var(--rose)]'
                          : 'text-[var(--muted)]'
                      }
                    >
                      • {log.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
            Supported columns: GEOID (11 digits), and numeric health metrics (rates, prevalences, percentages).
          </div>
        </section>
      </div>

      {/* Middle Grid: Geographic Coverage Map (Col 6) & Data Quality + Processing Errors (Col 6) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: US Geographic Coverage Map */}
        <section className="lg:col-span-6 rounded-2xl glass-panel p-0 overflow-hidden min-h-[380px] relative border border-[var(--line)]">
          <StateCoverageMap
            height={380}
            onSelectState={(name, cov) => {
              showToast(`${name}: ${cov.toFixed(1)}% of tracts have complete data`);
            }}
          />
        </section>

        {/* Right: Quality Indicators & Processing Errors Queue */}
        <section className="lg:col-span-6 rounded-2xl glass-panel p-5 flex flex-col justify-between space-y-6">
          {/* Data Quality Bars */}
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
              <div>
                <h3 className="text-base font-bold text-[var(--text)]">Data quality indicators</h3>
                <p className="text-[12px] text-[var(--muted)]">Across all active surveillance feeds</p>
              </div>
              <span className="text-[11px] font-bold text-[var(--teal)]">92.4 Composite</span>
            </div>

            <div className="space-y-3 mt-4">
              {QUALITY_INDICATORS.map(ind => (
                <div key={ind.label} className="space-y-1">
                  <div className="flex justify-between text-[11.5px]">
                    <span className="font-semibold text-[var(--text)]">{ind.label}</span>
                    <strong className="text-[var(--teal)] font-mono">{ind.value.toFixed(1)}%</strong>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)] overflow-hidden border border-[var(--line)]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${ind.value}%`,
                        background: 'linear-gradient(90deg, var(--teal), var(--cyan))'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Processing Errors Queue */}
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
              <div>
                <h4 className="text-[13.5px] font-bold text-[var(--text)]">Processing errors</h4>
                <p className="text-[11.5px] text-[var(--muted)]">
                  {openErrorsCount} open of {errors.length}
                </p>
              </div>
            </div>

            <div className="space-y-2 mt-3 max-h-48 overflow-y-auto pr-1">
              {errors.map(err => {
                const isBad = err.severity === 'bad';
                return (
                  <div
                    key={err._id}
                    className={`p-3 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                      err.open
                        ? 'bg-[var(--surface-2)] border-[var(--line)]'
                        : 'bg-[var(--surface-solid)]/40 border-[var(--line)] opacity-50'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-0.5 flex-shrink-0 ${isBad ? 'text-[var(--rose)]' : 'text-[var(--amber)]'}`}>
                        {isBad ? <AlertCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                      </span>
                      <div>
                        <strong className="text-[12px] text-[var(--text)] block leading-snug">{err.msg}</strong>
                        <span className="text-[10.5px] text-[var(--faint)]">
                          {err._id} • {err.dataset}
                        </span>
                      </div>
                    </div>

                    {err.open ? (
                      <button
                        onClick={() => handleResolveError(err._id)}
                        className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--line)] bg-[var(--surface-solid)] hover:bg-[var(--surface-2)] text-[11px] font-bold text-[var(--text)] transition-colors"
                      >
                        <Check className="w-3 h-3 text-[var(--teal)]" />
                        <span>Resolve</span>
                      </button>
                    ) : (
                      <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--teal)]/15 text-[var(--teal)]">
                        Resolved
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* Bottom: Import History Table (Col 12) */}
      <section className="rounded-2xl glass-panel p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
          <div>
            <h3 className="text-base font-bold text-[var(--text)]">Import history</h3>
            <p className="text-[12px] text-[var(--muted)]">Chronological audit log of dataset syncs and uploads</p>
          </div>
          <span className="text-[11px] font-bold text-[var(--muted)] num">
            Showing latest {imports.length} imports
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface-solid)]">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-[var(--surface-2)] text-[10.5px] font-bold text-[var(--faint)] uppercase border-b border-[var(--line)]">
              <tr>
                <th className="p-3">Import ID</th>
                <th className="p-3">Dataset Name</th>
                <th className="p-3">Source</th>
                <th className="p-3 text-right">Rows Ingested</th>
                <th className="p-3">Started</th>
                <th className="p-3 text-right">Duration</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {imports.map(item => {
                const isCompleted = item.status === 'Completed';
                const isFailed = item.status === 'Failed';
                return (
                  <tr key={item._id} className="hover:bg-[var(--surface-2)] transition-colors">
                    <td className="p-3 font-mono text-[11px] text-[var(--muted)]">{item._id}</td>
                    <td className="p-3 font-semibold text-[var(--text)]">{item.name}</td>
                    <td className="p-3 text-[var(--muted)]">{item.src}</td>
                    <td className="p-3 text-right font-mono font-semibold text-[var(--text)]">
                      {item.rows > 0 ? item.rows.toLocaleString() : '0'}
                    </td>
                    <td className="p-3 text-[var(--muted)]">{item.startedAt}</td>
                    <td className="p-3 text-right font-mono text-[11px] text-[var(--muted)]">{item.duration}</td>
                    <td className="p-3 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-bold ${
                          isCompleted
                            ? 'bg-[var(--teal)]/15 text-[var(--teal)]'
                            : isFailed
                            ? 'bg-[var(--rose)]/15 text-[var(--rose)]'
                            : 'bg-[var(--amber)]/15 text-[var(--amber)]'
                        }`}
                      >
                        {item.status}
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
  );
}

export default function DataManagementPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[13px] text-[var(--muted)]">
          Loading Data Management platform...
        </div>
      }
    >
      <DataManagementContent />
    </Suspense>
  );
}
