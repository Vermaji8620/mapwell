'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Assessment, Jurisdiction } from '@/types';
import { TIER_LABELS, TIER_COLORS, METRICS_CONFIG } from '@/config/metrics';
import {
  Download,
  MapPin,
  Search,
  Flag,
  Share2,
  ClipboardList,
  Sparkles,
  X,
  Plus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  AlertCircle
} from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/Icons';
import { useSearchParams } from 'next/navigation';
import { CensusTractMap } from '@/components/CensusTractMap';
import { GroupedBarChart } from '@/components/GroupedBarChart';

function CensusTractsContent() {
  const searchParams = useSearchParams();
  const urlCounty = searchParams.get('county');
  const urlTract = searchParams.get('tract');

  const {
    activeCounty,
    jurisdictions,
    setActiveJurisdiction,
    session,
    toggleFlagTract,
    toggleCompareTract,
    markWorkflowMilestone
  } = useSession();

  const [currentCountyId, setCurrentCountyId] = useState<string>(
    urlCounty || activeCounty?._id || '53033'
  );
  const [tracts, setTracts] = useState<CensusTract[]>([]);
  const [selectedTractId, setSelectedTractId] = useState<string | null>(urlTract || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTiers, setSelectedTiers] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<string>('svi');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  // Compare tray full tract records (supports multi-county compare)
  const [comparedTracts, setComparedTracts] = useState<CensusTract[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);

  // Add Finding Modal state
  const [findingModalOpen, setFindingModalOpen] = useState(false);
  const [findingTract, setFindingTract] = useState<CensusTract | null>(null);
  const [findingNote, setFindingNote] = useState('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('');
  const [assessmentsList, setAssessmentsList] = useState<Assessment[]>([]);
  const [submittingFinding, setSubmittingFinding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync with URL or activeCounty
  useEffect(() => {
    if (urlCounty && urlCounty !== currentCountyId) {
      setCurrentCountyId(urlCounty);
    } else if (!urlCounty && activeCounty?._id && activeCounty._id !== currentCountyId) {
      setCurrentCountyId(activeCounty._id);
    }
  }, [urlCounty, activeCounty]);

  useEffect(() => {
    if (urlTract) {
      setSelectedTractId(urlTract);
    }
  }, [urlTract]);

  useEffect(() => {
    markWorkflowMilestone('tract');
  }, [markWorkflowMilestone]);

  // Load tracts for the active county
  useEffect(() => {
    if (!currentCountyId) return;
    setLoading(true);
    fetch(`/api/tracts?county=${currentCountyId}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(res => {
        const data = res.data || [];
        setTracts(data);
        if (!selectedTractId || !data.some((t: CensusTract) => t._id === selectedTractId)) {
          if (data.length > 0) {
            setSelectedTractId(data[0]._id);
          }
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [currentCountyId]);

  // Load compared tracts records when compare set changes
  const compareIds = session?.compareTracts || [];
  useEffect(() => {
    if (compareIds.length === 0) {
      setComparedTracts([]);
      return;
    }

    // Immediately show any matching tracts already loaded in current view
    const localMatches = tracts.filter(t => compareIds.includes(t._id));
    if (localMatches.length > 0) {
      setComparedTracts(localMatches);
    }

    setLoadingCompare(true);
    fetch(`/api/tracts/compare?ids=${compareIds.join(',')}`)
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (!res) return;
        const list = Array.isArray(res) ? res : res.tracts || [];
        if (list.length > 0) {
          setComparedTracts(list);
        }
      })
      .catch(err => {
        console.error(err);
      })
      .finally(() => setLoadingCompare(false));
  }, [compareIds, tracts]);

  // Load assessments for Finding modal
  useEffect(() => {
    fetch(`/api/assessments?jurisdiction=${currentCountyId}`)
      .then(r => r.ok ? r.json() : [])
      .then(res => {
        setAssessmentsList(res || []);
        if (res && res.length > 0) {
          setSelectedAssessmentId(res[0]._id);
        } else {
          setSelectedAssessmentId('__new');
        }
      })
      .catch(err => console.error(err));
  }, [currentCountyId]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const currentCounty = jurisdictions.find(j => j._id === currentCountyId) || activeCounty;

  // Selected tract object
  const selectedTract = useMemo(() => {
    return tracts.find(t => t._id === selectedTractId) || tracts[0] || null;
  }, [tracts, selectedTractId]);

  // Filtered and sorted tracts
  const filteredTracts = useMemo(() => {
    let result = tracts.filter(t => {
      if (selectedTiers.size > 0 && !selectedTiers.has(t.tier)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = t.name.toLowerCase().includes(q);
        const matchGeoid = t._id.includes(q);
        if (!matchName && !matchGeoid) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      let aVal: any = a[sortKey as keyof CensusTract] ?? (a.indicators as any)?.[sortKey] ?? 0;
      let bVal: any = b[sortKey as keyof CensusTract] ?? (b.indicators as any)?.[sortKey] ?? 0;

      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
        return sortDirection === 'asc' ? cmp : -cmp;
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });

    return result;
  }, [tracts, selectedTiers, searchQuery, sortKey, sortDirection]);

  // Sorting helper
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection(key === 'name' ? 'asc' : 'desc');
    }
  };

  // Toggle tier filter
  const toggleTierFilter = (tierIdx: number) => {
    setSelectedTiers(prev => {
      const next = new Set(prev);
      if (next.has(tierIdx)) {
        next.delete(tierIdx);
      } else {
        next.add(tierIdx);
      }
      return next;
    });
  };

  // Max values for table mini visual bars
  const maxVals = useMemo(() => {
    return {
      poverty: Math.max(...tracts.map(t => (t.indicators as any)?.poverty || 0), 1),
      uninsured: Math.max(...tracts.map(t => (t.indicators as any)?.uninsured || 0), 1),
      diabetes: Math.max(...tracts.map(t => (t.indicators as any)?.diabetes || 0), 1)
    };
  }, [tracts]);

  // CSV Export Generator
  const handleExportCSV = () => {
    if (filteredTracts.length === 0) return;

    const headers = [
      'geoid',
      'tract_name',
      'county_fips',
      'county_name',
      'population',
      'svi',
      'vulnerability_tier',
      'poverty_pct',
      'uninsured_pct',
      'diabetes_pct',
      'access_score',
      'life_expectancy'
    ];

    const rows = filteredTracts.map(t => [
      `"${t._id}"`,
      `"${t.name}"`,
      `"${t.countyFips}"`,
      `"${currentCounty?.name || ''}"`,
      t.population || 0,
      t.svi.toFixed(3),
      `"${TIER_LABELS[t.tier]}"`,
      ((t.indicators as any)?.poverty || 0).toFixed(1),
      ((t.indicators as any)?.uninsured || 0).toFixed(1),
      ((t.indicators as any)?.diabetes || 0).toFixed(1),
      ((t.indicators as any)?.access || 0).toFixed(0),
      ((t.indicators as any)?.lifeExp || 0).toFixed(1)
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `tracts-${currentCountyId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setToastMessage(`Exported ${filteredTracts.length} tracts to tracts-${currentCountyId}.csv`);
  };

  // Open finding modal for a tract
  const handleOpenFindingModal = (t: CensusTract) => {
    setFindingTract(t);
    const poverty = (t.indicators as any)?.poverty || 14.2;
    const uninsured = (t.indicators as any)?.uninsured || 8.6;
    const diabetes = (t.indicators as any)?.diabetes || 11.2;
    setFindingNote(
      `High-need area: SVI ${t.svi.toFixed(2)} (${TIER_LABELS[t.tier]} tier) with ${uninsured}% uninsured rate and ${diabetes}% diabetes prevalence. Candidate for mobile clinic outreach.`
    );
    setFindingModalOpen(true);
  };

  // Submit new finding to MongoDB
  const handleSubmitFinding = async () => {
    if (!findingTract || !findingNote.trim()) return;
    setSubmittingFinding(true);

    try {
      let finalAssessmentId = selectedAssessmentId;

      // Create new assessment first if __new selected
      if (finalAssessmentId === '__new') {
        const createRes = await fetch('/api/assessments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Community Assessment: ${currentCounty?.name || 'King County'}`,
            jurisdictionId: currentCountyId,
            template: 'custom',
            indicators: ['svi', 'poverty', 'uninsured', 'diabetes']
          })
        });
        if (createRes.ok) {
          const newAssessment = await createRes.json();
          finalAssessmentId = newAssessment._id;
        } else {
          throw new Error('Failed to create new assessment');
        }
      }

      // Record finding
      const res = await fetch('/api/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: finalAssessmentId,
          tractId: findingTract._id,
          note: findingNote
        })
      });

      if (res.ok) {
        await markWorkflowMilestone('finding');
        setToastMessage(`Finding attached to Assessment ${finalAssessmentId}`);
        setFindingModalOpen(false);
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

  // Comparison metrics grouped multi-bar configuration (matching prototype)
  const compareMetrics = [
    { key: 'poverty', label: 'Poverty' },
    { key: 'uninsured', label: 'Uninsured' },
    { key: 'noVehicle', label: 'No vehicle' },
    { key: 'diabetes', label: 'Diabetes' },
    { key: 'asthma', label: 'Asthma' },
    { key: 'unemployment', label: 'Unemployment' }
  ];

  const comparePalette = ['#2584EB', '#8B5CF6', '#F59E0B', '#F43F5E'];

  // Life Expectancy gap calculation in compare set
  const lifeExpGapInsight = useMemo(() => {
    if (comparedTracts.length < 2) return null;
    const sortedBySvi = [...comparedTracts].sort((a, b) => b.svi - a.svi);
    const mostVuln = sortedBySvi[0];
    const leastVuln = sortedBySvi[sortedBySvi.length - 1];

    const leMost = (mostVuln.indicators as any)?.lifeExp || 76.5;
    const leLeast = (leastVuln.indicators as any)?.lifeExp || 83.2;
    const gap = Math.abs(leLeast - leMost);

    return {
      mostName: mostVuln.name.replace('Census ', ''),
      leastName: leastVuln.name.replace('Census ', ''),
      gap: gap.toFixed(1)
    };
  }, [comparedTracts]);

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
          <h1>Census tract explorer</h1>
          <p>Explore community vulnerability, poverty, healthcare access and chronic disease by census tract.</p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot"></span>Demo environment
          </span>
          <button className="btn" id="ct-exp" onClick={handleExportCSV}>
            <Icon name="download" size={14} />
            <span>Export CSV</span>
          </button>
          <Link href={`/health-map?county=${currentCountyId}`} className="btn primary">
            <Icon name="map" size={14} />
            <span>Open in health map</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
          {/* County select */}
          <div className="field">
            <select
              id="ct-county"
              className="input"
              value={currentCountyId}
              onChange={(e) => setCurrentCountyId(e.target.value)}
              style={{ height: '36px', borderRadius: '10px', padding: '0 10px', fontSize: '12.5px', background: 'var(--surface-solid)' }}
            >
              {jurisdictions.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}, {c.stateAbbr}
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="search" style={{ minWidth: '220px', maxWidth: '300px' }}>
            <Icon name="search" size={14} />
            <input
              id="ct-q"
              placeholder="Search by tract or GEOID…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Tier filter chips */}
          <div className="chips" id="ct-tier">
            {[0, 1, 2, 3, 4].map((tierIdx) => (
              <button
                key={tierIdx}
                className={`chip ${selectedTiers.has(tierIdx) ? 'on' : ''}`}
                onClick={() => toggleTierFilter(tierIdx)}
              >
                <i
                  className="tier"
                  style={{
                    background: TIER_COLORS[tierIdx],
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    display: 'inline-block',
                    marginRight: '5px'
                  }}
                />
                {TIER_LABELS[tierIdx]}
              </button>
            ))}
          </div>
        </div>

        <span id="ct-count" style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 500 }}>
          {filteredTracts.length} of {tracts.length} tracts in {currentCounty?.name || 'King County'}
        </span>
      </div>

      {/* Main Grid: Table (c-8) and Side Inspector (c-4) */}
      <div className="grid g-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px' }}>
        {/* Left Column: Tracts Table */}
        <section className="panel c-8" style={{ gridColumn: 'span 8', padding: 0, overflow: 'hidden' }}>
          <div className="tbl-wrap" style={{ maxHeight: '620px', overflowY: 'auto' }}>
            <table className="tbl" id="ct-tbl">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}></th>
                  <th className={`sort ${sortKey === 'name' ? 'sorted' : ''}`} onClick={() => handleSort('name')}>
                    Tract <Icon name="chev" size={12} />
                  </th>
                  <th className={`r sort ${sortKey === 'population' ? 'sorted' : ''}`} onClick={() => handleSort('population')}>
                    Population <Icon name="chev" size={12} />
                  </th>
                  <th className={`r sort ${sortKey === 'svi' ? 'sorted' : ''}`} onClick={() => handleSort('svi')}>
                    Vulnerability <Icon name="chev" size={12} />
                  </th>
                  <th className={`r sort ${sortKey === 'poverty' ? 'sorted' : ''}`} onClick={() => handleSort('poverty')}>
                    Poverty <Icon name="chev" size={12} />
                  </th>
                  <th className={`r sort ${sortKey === 'uninsured' ? 'sorted' : ''}`} onClick={() => handleSort('uninsured')}>
                    Uninsured <Icon name="chev" size={12} />
                  </th>
                  <th className={`r sort ${sortKey === 'diabetes' ? 'sorted' : ''}`} onClick={() => handleSort('diabetes')}>
                    Diabetes <Icon name="chev" size={12} />
                  </th>
                  <th className={`r sort ${sortKey === 'access' ? 'sorted' : ''}`} onClick={() => handleSort('access')}>
                    Access <Icon name="chev" size={12} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTracts.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty" style={{ padding: '32px', textAlign: 'center' }}>
                        <b>No census tracts match this filter</b>
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Try adjusting your search query or tier filters.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTracts.map((t) => {
                    const isSel = selectedTract?._id === t._id;
                    const isCmp = session?.compareTracts?.includes(t._id);
                    const isFlg = session?.flaggedTracts?.includes(t._id);

                    const pov = (t.indicators as any)?.poverty || 0;
                    const unin = (t.indicators as any)?.uninsured || 0;
                    const diab = (t.indicators as any)?.diabetes || 0;
                    const acc = (t.indicators as any)?.accessScore || 50;

                    return (
                      <tr
                        key={t._id}
                        className={`clickable ${isSel ? 'sel' : ''}`}
                        onClick={() => setSelectedTractId(t._id)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={!!isCmp}
                            onChange={() => toggleCompareTract(t._id)}
                            style={{ accentColor: 'var(--cyan)' }}
                            aria-label={`Compare ${t.name}`}
                          />
                        </td>
                        <td>
                          <b>{t.name.replace('Census Tract ', 'Tract ')}</b>
                          {isFlg && (
                            <span className="pill bad" style={{ padding: '1px 5px', fontSize: '10px', marginLeft: '6px' }}>
                              Flagged
                            </span>
                          )}
                        </td>
                        <td className="r num">{(t.population || 0).toLocaleString()}</td>
                        <td className="r">
                          <span className="num">
                            <i
                              className="tier"
                              style={{
                                background: TIER_COLORS[t.tier],
                                width: '7px',
                                height: '7px',
                                borderRadius: '50%',
                                display: 'inline-block',
                                marginRight: '6px'
                              }}
                            />
                            {(t.svi || 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="r">
                          <div className="bar-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                            <span className="num">{pov.toFixed(1)}%</span>
                            <div style={{ width: '40px', height: '5px', background: 'var(--surface-2)', borderRadius: '2px', overflow: 'hidden' }}>
                              <i style={{ display: 'block', height: '100%', width: `${Math.min(100, (pov / maxVals.poverty) * 100)}%`, background: 'var(--cyan)' }} />
                            </div>
                          </div>
                        </td>
                        <td className="r">
                          <div className="bar-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                            <span className="num">{unin.toFixed(1)}%</span>
                            <div style={{ width: '40px', height: '5px', background: 'var(--surface-2)', borderRadius: '2px', overflow: 'hidden' }}>
                              <i style={{ display: 'block', height: '100%', width: `${Math.min(100, (unin / maxVals.uninsured) * 100)}%`, background: 'var(--teal)' }} />
                            </div>
                          </div>
                        </td>
                        <td className="r">
                          <div className="bar-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                            <span className="num">{diab.toFixed(1)}%</span>
                            <div style={{ width: '40px', height: '5px', background: 'var(--surface-2)', borderRadius: '2px', overflow: 'hidden' }}>
                              <i style={{ display: 'block', height: '100%', width: `${Math.min(100, (diab / maxVals.diabetes) * 100)}%`, background: 'var(--rose)' }} />
                            </div>
                          </div>
                        </td>
                        <td className="r num">{acc.toFixed(0)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right Column: Mini Map & Tract Detail (c-4) */}
        <div className="c-4 stack" style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <section className="panel" style={{ padding: 0, overflow: 'hidden', height: '280px', position: 'relative' }}>
            <div id="ct-map-el" style={{ position: 'absolute', inset: 0 }}>
              <CensusTractMap
                countyFips={currentCountyId}
                tracts={tracts}
                selectedTractId={selectedTract?._id}
                compareTractIds={session?.compareTracts || []}
                onSelectTract={(t: any) => setSelectedTractId(t._id)}
                height={280}
              />
            </div>
            <div className="map-float legend" id="ct-leg" style={{ position: 'absolute', left: '10px', bottom: '10px' }}>
              <div style={{ fontSize: '10.5px', color: 'var(--muted)', fontWeight: 600 }}>Tract vulnerability</div>
              <div style={{ height: '6px', width: '130px', borderRadius: '3px', background: 'linear-gradient(90deg, #E4ECFA, #2584EB, #123A7D)', marginTop: '2px' }} />
            </div>
          </section>

          <section className="panel" id="ct-detail" style={{ padding: '16px' }}>
            {selectedTract ? (
              <>
                <div className="panel-h" style={{ marginBottom: '10px' }}>
                  <div>
                    <h3 style={{ fontSize: '16px' }}>{selectedTract.name}</h3>
                    <div className="sub" style={{ fontSize: '11px' }}>
                      GEOID {selectedTract._id} • {currentCounty?.name}
                    </div>
                  </div>
                </div>

                <table className="tbl" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th>Indicator</th>
                      <th className="r">Tract</th>
                      <th className="r">County Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { key: 'svi', label: 'Vulnerability (SVI)', val: (selectedTract.svi || 0).toFixed(2), avg: '0.45' },
                      { key: 'poverty', label: 'Poverty Rate', val: `${((selectedTract.indicators as any)?.poverty || 0).toFixed(1)}%`, avg: '11.8%' },
                      { key: 'uninsured', label: 'Uninsured Rate', val: `${((selectedTract.indicators as any)?.uninsured || 0).toFixed(1)}%`, avg: '6.4%' },
                      { key: 'diabetes', label: 'Diabetes', val: `${((selectedTract.indicators as any)?.diabetes || 0).toFixed(1)}%`, avg: '8.2%' },
                      { key: 'access', label: 'Access Score', val: `${((selectedTract.indicators as any)?.accessScore || 50).toFixed(0)}`, avg: '65' }
                    ].map((row) => (
                      <tr key={row.key}>
                        <td style={{ fontWeight: 600 }}>{row.label}</td>
                        <td className="r num" style={{ fontWeight: 700, color: 'var(--cyan)' }}>{row.val}</td>
                        <td className="r num" style={{ color: 'var(--muted)' }}>{row.avg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="row mt" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button
                    className="btn sm"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() => toggleCompareTract(selectedTract._id)}
                  >
                    <Icon name="compare" size={14} />
                    <span>{session?.compareTracts?.includes(selectedTract._id) ? 'Remove compare' : 'Compare'}</span>
                  </button>
                  <button
                    className="btn sm"
                    style={{ flex: 1, justifyContent: 'center', color: session?.flaggedTracts?.includes(selectedTract._id) ? 'var(--rose)' : undefined }}
                    onClick={() => toggleFlagTract(selectedTract._id)}
                  >
                    <Icon name="flag" size={14} />
                    <span>{session?.flaggedTracts?.includes(selectedTract._id) ? 'Flagged' : 'Flag tract'}</span>
                  </button>
                </div>

                <button
                  className="btn primary mt-s"
                  style={{ width: '100%', marginTop: '8px', justifyContent: 'center' }}
                  onClick={() => handleOpenFindingModal(selectedTract)}
                >
                  <Icon name="clipboard" size={14} />
                  <span>Add finding to assessment</span>
                </button>
              </>
            ) : (
              <div className="empty" style={{ textAlign: 'center', padding: '24px 0' }}>
                <b>Select a tract</b>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Click a row in the table or a tract on the map.</span>
              </div>
            )}
          </section>
        </div>

        {/* Comparison Section (c-12) */}
        {comparedTracts.length >= 2 && (
          <section className="panel c-12" id="ct-cmp" style={{ gridColumn: 'span 12', padding: '18px' }}>
            <div className="panel-h" style={{ marginBottom: '14px' }}>
              <div>
                <h3>Tract comparison</h3>
                <div className="sub">{comparedTracts.length} tracts compared side-by-side (values in %)</div>
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  fetch('/api/session', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ compareTracts: [] })
                  }).catch(() => {});
                }}
              >
                <span>Clear comparison</span>
              </button>
            </div>

            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Tract</th>
                    <th className="r">Population</th>
                    <th className="r">Vulnerability</th>
                    <th className="r">Poverty</th>
                    <th className="r">Uninsured</th>
                    <th className="r">Diabetes</th>
                    <th className="r">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {comparedTracts.map((t) => (
                    <tr key={t._id}>
                      <td><b>{t.name}</b></td>
                      <td className="r num">{(t.population || 0).toLocaleString()}</td>
                      <td className="r num">{(t.svi || 0).toFixed(2)}</td>
                      <td className="r num">{((t.indicators as any)?.poverty || 0).toFixed(1)}%</td>
                      <td className="r num">{((t.indicators as any)?.uninsured || 0).toFixed(1)}%</td>
                      <td className="r num">{((t.indicators as any)?.diabetes || 0).toFixed(1)}%</td>
                      <td className="r num">{((t.indicators as any)?.accessScore || 50).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Add Finding Modal */}
      {findingModalOpen && findingTract && (
        <div id="modal-root" className="open">
          <div className="modal-scrim" onClick={() => setFindingModalOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" style={{ width: '480px', maxWidth: '90vw' }}>
            <div className="modal-h">
              <div>
                <h3>Add Finding to Needs Assessment</h3>
                <div className="sub">Tag a priority observation for {findingTract.name}</div>
              </div>
              <button className="icon-btn" onClick={() => setFindingModalOpen(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="modal-b" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                  Target Assessment
                </label>
                <select
                  className="input"
                  value={selectedAssessmentId}
                  onChange={(e) => setSelectedAssessmentId(e.target.value)}
                  style={{ width: '100%', height: '38px', borderRadius: '10px', padding: '0 10px', fontSize: '13px' }}
                >
                  <option value="new">+ Create New Assessment for {currentCounty?.name || 'this County'}</option>
                  {assessmentsList.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.title} ({a.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                  Finding Note & Observations
                </label>
                <textarea
                  className="input"
                  rows={4}
                  placeholder="Describe observed health disparity, service bottleneck, or intervention need..."
                  value={findingNote}
                  onChange={(e) => setFindingNote(e.target.value)}
                  style={{ width: '100%', borderRadius: '10px', padding: '10px', fontSize: '13px', resize: 'vertical' }}
                />
              </div>
            </div>

            <div className="modal-f" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn" onClick={() => setFindingModalOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={handleSubmitFinding} disabled={submittingFinding}>
                {submittingFinding ? 'Saving...' : 'Save Finding'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function CensusTractsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading census tract surveillance...</div>}>
      <CensusTractsContent />
    </Suspense>
  );
}
