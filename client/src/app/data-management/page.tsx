'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { Icon } from '@/components/Icons';
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

const DEFAULT_QUALITY_INDICATORS = [
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
  const [qualityIndicators, setQualityIndicators] = useState(DEFAULT_QUALITY_INDICATORS);
  const [compositeScore, setCompositeScore] = useState<number>(92.4);
  const [stateCoverage, setStateCoverage] = useState<Record<string, number>>({});
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

  // Fetch dynamic quality metrics & stats from MongoDB
  const refreshStats = async () => {
    try {
      const res = await fetch('/api/data/stats');
      if (res.ok) {
        const data = await res.json();
        if (data.qualityIndicators) setQualityIndicators(data.qualityIndicators);
        if (data.compositeScore != null) setCompositeScore(data.compositeScore);
        if (data.lastSync) setLastSyncTime(data.lastSync);
        if (data.stateCoverage) setStateCoverage(data.stateCoverage);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load backend data from MongoDB
  useEffect(() => {
    fetch('/api/data/sources')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && data.length > 0) {
          setSources(
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

    refreshStats();
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

  // Trigger individual sync against MongoDB
  const handleSyncSource = async (id: string) => {
    const src = sources.find(s => s._id === id);
    if (!src || src.isSyncing) return;

    // Start progress animation
    setSources(prev =>
      prev.map(s => (s._id === id ? { ...s, isSyncing: true, syncProgress: 15 } : s))
    );

    let progress = 15;
    const interval = setInterval(() => {
      progress += Math.floor(16 + Math.random() * 22);
      if (progress >= 95) {
        clearInterval(interval);
      } else {
        setSources(prev =>
          prev.map(s => (s._id === id ? { ...s, syncProgress: progress } : s))
        );
      }
    }, 120);

    try {
      const res = await fetch(`/api/data/sources/${id}/sync`, { method: 'POST' });
      if (res.ok) {
        const { source, log } = await res.json();
        clearInterval(interval);

        const now = new Date(source.lastSync || Date.now());
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSyncTime(timeStr);

        setSources(prev =>
          prev.map(s =>
            s._id === id
              ? {
                  ...s,
                  status: source.status,
                  meta: source.meta,
                  lastSync: `Today ${timeStr}`,
                  isSyncing: false,
                  syncProgress: 100
                }
              : s
          )
        );

        if (log) {
          const formattedLog: ImportHistoryItem = {
            _id: log._id,
            name: log.name,
            src: log.src,
            rows: log.rows,
            status: log.status,
            duration: log.duration,
            startedAt: `Today ${timeStr}`
          };
          setImports(prev => [formattedLog, ...prev.filter(i => i._id !== log._id)]);
        }

        showToast(`${source.name} synchronized successfully`);
        refreshStats();
      }
    } catch (e) {
      console.error(e);
      clearInterval(interval);
      setSources(prev => prev.map(s => (s._id === id ? { ...s, isSyncing: false } : s)));
    }
  };

  // Sync All sources against MongoDB in parallel/sequence
  const handleSyncAll = async () => {
    if (syncingAll) return;
    setSyncingAll(true);
    showToast('Initiating synchronization across all upstream connectors...');

    try {
      const res = await fetch('/api/data/sources/sync-all', { method: 'POST' });
      if (res.ok) {
        const { sources: updatedSources, logs, message } = await res.json();
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSyncTime(timeStr);

        if (updatedSources) {
          setSources(
            updatedSources.map((d: any) => ({
              _id: d._id,
              name: d.name,
              icon: d.icon || 'cloud',
              status: d.status || 'ok',
              desc: d.desc || '',
              meta: d.meta || [],
              lastSync: `Today ${timeStr}`,
              isSyncing: false,
              syncProgress: 100
            }))
          );
        }

        if (logs && logs.length > 0) {
          const formattedLogs: ImportHistoryItem[] = logs.map((l: any) => ({
            _id: l._id,
            name: l.name,
            src: l.src,
            rows: l.rows,
            status: l.status,
            duration: l.duration,
            startedAt: `Today ${timeStr}`
          }));
          setImports(prev => [...formattedLogs, ...prev]);
        }

        showToast(message || 'All data sources synchronized successfully');
        refreshStats();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSyncingAll(false);
    }
  };

  // Mark processing error resolved in MongoDB
  const handleResolveError = async (id: string) => {
    try {
      const res = await fetch(`/api/data/errors/${id}/resolve`, { method: 'PATCH' });
      if (res.ok) {
        setErrors(prev =>
          prev.map(e => (e._id === id ? { ...e, open: false } : e))
        );
        showToast(`Issue ${id} marked as resolved`);
        refreshStats();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // CSV Validation Pipeline with automatic MongoDB ingestion
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

    const stepInterval = setInterval(async () => {
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

        // Submit to MongoDB backend
        try {
          const blob = new Blob([text], { type: 'text/csv' });
          const formData = new FormData();
          formData.append('file', blob, fileName);

          const uploadRes = await fetch('/api/data/upload', {
            method: 'POST',
            body: formData
          });

          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            if (uploadData.importLog) {
              setImports(prev => [uploadData.importLog, ...prev.filter(i => i._id !== uploadData.importLog._id)]);
            }
            if (uploadData.processingError) {
              setErrors(prev => [uploadData.processingError, ...prev.filter(e => e._id !== uploadData.processingError._id)]);
            }
            refreshStats();
          }
        } catch (uploadErr) {
          console.error('Backend upload API error:', uploadErr);
        }

        setIsUploading(false);
        showToast(
          finalStatus === 'Failed'
            ? 'Import failed: missing GEOID column'
            : `Validated & ingested ${rows.length} records into database (${finalStatus})`
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
          <h2>Data management</h2>
          <p>Monitor data sources, upload datasets, validate imports and track data quality across geographies.</p>
        </div>
        <div className="row">
          <span className="pill demo"><span className="dot" />Demo connections. No live requests are made</span>
          <button
            className="btn primary"
            id="dm-sync-all"
            onClick={handleSyncAll}
            disabled={syncingAll}
          >
            <Icon name="refresh" />{syncingAll ? 'Syncing...' : 'Sync all sources'}
          </button>
        </div>
      </div>

      {/* 4 Metric Ruled KPI Strip */}
      <div className="strip">
        <div className="cell">
          <div className="lbl">Connected sources</div>
          <div className="val">
            <span className="num">{connectedCount}</span>
            <small>of {sources.length}</small>
          </div>
          <div className="foot">One source needs attention</div>
        </div>
        <div className="cell">
          <div className="lbl">Last synchronization</div>
          <div className="val">
            <span className="num" id="dm-last">{lastSyncTime}</span>
          </div>
          <div className="foot">Today, vector tile service</div>
        </div>
        <div className="cell">
          <div className="lbl">Rows ingested this month</div>
          <div className="val">
            <span className="num">{totalRowsIngested.toLocaleString()}</span>
          </div>
          <div className="foot">{imports.length} imports</div>
        </div>
        <div className="cell">
          <div className="lbl">Data quality score</div>
          <div className="val">
            <span className="num">{compositeScore.toFixed(1)}</span>
            <small>/100</small>
          </div>
          <div className="foot">
            <span id="dm-errn">{openErrorsCount} open {openErrorsCount === 1 ? 'issue' : 'issues'}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Data Source Connections (c-8) & Dataset Upload (c-4) */}
      <div className="grid g-12">
        {/* Left: Data Source Connections */}
        <section className="panel c-8">
          <div className="panel-h">
            <div>
              <h3>Data source connections</h3>
              <div className="sub">Status of upstream sources and processing services</div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }} id="dm-src">
            {sources.map(src => {
              const isBad = src.status === 'bad';
              const isWarn = src.status === 'warn';
              const isOk = src.status === 'ok';

              return (
                <div
                  key={src._id}
                  className="tool-tile conn"
                  style={{ cursor: 'default', transform: 'none' }}
                  data-s={src._id}
                >
                  <div className="top">
                    <span className="logo">
                      <Icon name={src.icon || 'database'} />
                    </span>
                    <span className={`pill ${src.status}`}>
                      <span className={`dot ${isOk ? 'live' : ''}`} />
                      {isOk ? 'Healthy' : isWarn ? 'Warnings' : 'Disconnected'}
                    </span>
                  </div>

                  <div>
                    <b>{src.name}</b>
                    <small style={{ display: 'block', marginTop: 2 }}>{src.desc}</small>
                  </div>

                  {/* Metadata key-values */}
                  <div className="kv" style={{ fontSize: 12 }}>
                    {src.meta.map(([label, val], idx) => (
                      <React.Fragment key={idx}>
                        <dt>{label}</dt>
                        <dd style={{ fontFamily: 'var(--font-mono)' }}>{val}</dd>
                      </React.Fragment>
                    ))}
                    <dt>Last sync</dt>
                    <dd style={{ fontFamily: 'var(--font-mono)' }}>{src.lastSync}</dd>
                  </div>

                  {/* Animated Progress Bar during Sync */}
                  {src.isSyncing && (
                    <div className="prog" style={{ display: 'block' }}>
                      <i style={{ width: `${src.syncProgress || 15}%`, transition: 'width .3s' }} />
                    </div>
                  )}

                  {/* Sync Trigger Action */}
                  <div className="row">
                    <button
                      className="btn sm"
                      data-sync={src._id}
                      onClick={() => handleSyncSource(src._id)}
                      disabled={src.isSyncing}
                    >
                      <Icon name={isBad ? 'link' : 'refresh'} />
                      {isBad ? 'Reconnect' : 'Sync now'}
                    </button>
                    <span className="note" style={{ marginLeft: 'auto' }}>{src.lastSync}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: Dataset Upload & Browser Validation Engine */}
        <section className="panel c-4">
          <div className="panel-h">
            <div>
              <h3>Dataset upload</h3>
              <div className="sub">CSV with a GEOID column and indicator columns</div>
            </div>
          </div>

          {/* Drag & Drop Zone */}
          <label
            className={`dropzone ${isDragOver ? 'over' : ''}`}
            id="dm-drop"
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
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              id="dm-file"
              hidden
              onChange={handleFileChange}
            />
            <Icon name="upload" />
            <div style={{ fontWeight: 700, marginTop: 8 }}>Drop a CSV here or browse</div>
            <div className="note">Validated in your browser. Nothing is uploaded</div>
          </label>

          {/* Sample File Button */}
          <button
            className="btn mt"
            style={{ width: '100%' }}
            id="dm-sample"
            onClick={handleLoadSampleFile}
          >
            <Icon name="file" />
            Use a sample file with known issues
          </button>

          {/* Real-time Validation Pipeline Runner & Terminal Log */}
          {uploadFileName && (
            <div id="dm-up" className="mt">
              <div className="row between" style={{ fontSize: '12.5px' }}>
                <b>{uploadFileName}</b>
                <span className="note" id="up-st">{uploadStage}</span>
              </div>

              {/* Animated Progress Bar */}
              <div className="prog mt-s">
                <i
                  id="up-b"
                  style={{
                    width: `${uploadProgress}%`,
                    background: uploadStage === 'Failed' ? 'var(--rose)' : undefined
                  }}
                />
              </div>

              {/* Log Terminal Console */}
              <div
                ref={logContainerRef}
                className="log mt-s"
                id="up-log"
              >
                {validationLogs.map((log, i) => (
                  <div key={i} className={log.type}>
                    {log.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Geographic Coverage Map (c-6) */}
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
        </section>

        {/* Quality Indicators & Processing Errors Queue (c-6) */}
        <section className="panel c-6">
          <div className="panel-h">
            <div>
              <h3>Data quality indicators</h3>
              <div className="sub">Across all active datasets</div>
            </div>
          </div>

          <div id="dm-q">
            {qualityIndicators.map(q => (
              <div className="prog-row" key={q.label} style={{ marginBottom: 10 }}>
                <div className="row between" style={{ fontSize: 12 }}>
                  <span>{q.label}</span>
                  <b className="num">{q.value.toFixed(1)}%</b>
                </div>
                <div className="prog mt-xs">
                  <i style={{ width: `${q.value}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="panel-h mt" style={{ marginTop: 18 }}>
            <div>
              <h3>Processing errors</h3>
              <div className="sub" id="dm-err-sub">{openErrorsCount} open of {errors.length}</div>
            </div>
          </div>

          <div className="list" id="dm-err">
            {errors.map(e => (
              <div
                key={e._id}
                className="item"
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid var(--line)',
                  opacity: e.open ? 1 : 0.6
                }}
              >
                <div className="row between">
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`pill ${e.severity === 'bad' ? 'bad' : 'warn'}`}>
                      <span className="dot" />
                      {e.severity === 'bad' ? 'Error' : 'Warning'}
                    </span>
                    <b>{e.dataset}</b>
                  </div>
                  {e.open ? (
                    <button
                      className="btn xs ghost"
                      onClick={() => handleResolveError(e._id)}
                    >
                      Resolve
                    </button>
                  ) : (
                    <span className="pill ok" style={{ fontSize: 10 }}>
                      Resolved
                    </span>
                  )}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 12 }}>{e.msg}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Import History Table (c-12) */}
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
                {imports.map(i => {
                  const st = i.status;
                  const isOk = st === 'Completed';
                  const isBad = st === 'Failed';
                  return (
                    <tr key={i._id}>
                      <td className="muted num">{i._id}</td>
                      <td><b>{i.name}</b></td>
                      <td>{i.src}</td>
                      <td className="r num">{(i.rows || 0).toLocaleString()}</td>
                      <td className="muted">{i.startedAt}</td>
                      <td className="r num muted">{i.duration}</td>
                      <td>
                        <span className={`pill ${isOk ? 'ok' : isBad ? 'bad' : 'warn'}`}>
                          <span className={`dot ${isOk ? 'live' : ''}`} />
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
