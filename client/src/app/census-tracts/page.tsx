'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/context/SessionContext';
import { CensusTract, Assessment, Jurisdiction } from '@/types';
import { Icon } from '@/components/Icons';
import { CensusTractMap, VULN_RAMP } from '@/components/CensusTractMap';
import { GroupedBarChart } from '@/components/GroupedBarChart';
import { getCountyRepository, STATE_META } from '@/utils/countyRepository';

// Exact prototype tier labels & colors (prototype line 1167)
const TIER_LABEL = ['Very low', 'Low', 'Moderate', 'High', 'Very high'];
const TIER_COLOR = ['#9FE3E7', '#5CCAD2', '#66B6F5', '#2584EB', '#163E8C'];

// Exact prototype metric definitions for detail table (prototype lines 1047-1070)
const METRICS_DEF: Record<string, { label: string; short: string; bad: 'high' | 'low'; f: (v: number) => string }> = {
  svi: { label: 'Social vulnerability index', short: 'Vulnerability', bad: 'high', f: v => v.toFixed(2) },
  poverty: { label: 'Population below poverty line', short: 'Poverty', bad: 'high', f: v => v.toFixed(1) + '%' },
  uninsured: { label: 'Adults without health insurance', short: 'Uninsured', bad: 'high', f: v => v.toFixed(1) + '%' },
  noVehicle: { label: 'Households without a vehicle', short: 'No vehicle', bad: 'high', f: v => v.toFixed(1) + '%' },
  noDiploma: { label: 'Adults without a high school diploma', short: 'No diploma', bad: 'high', f: v => v.toFixed(1) + '%' },
  diabetes: { label: 'Diagnosed diabetes prevalence', short: 'Diabetes', bad: 'high', f: v => v.toFixed(1) + '%' },
  asthma: { label: 'Current asthma prevalence', short: 'Asthma', bad: 'high', f: v => v.toFixed(1) + '%' },
  lifeExp: { label: 'Life expectancy at birth', short: 'Life exp.', bad: 'low', f: v => v.toFixed(1) + ' yrs' },
  access: { label: 'Healthcare access score', short: 'Access score', bad: 'low', f: v => v.toFixed(0) },
  unemployment: { label: 'Unemployment rate', short: 'Unemployment', bad: 'high', f: v => v.toFixed(1) + '%' }
};

// Exact prototype detail table rows (prototype line 2116)
const rowsD = [
  ['svi', 'Vulnerability'],
  ['poverty', 'Poverty'],
  ['uninsured', 'Uninsured'],
  ['noVehicle', 'No vehicle'],
  ['noDiploma', 'No diploma'],
  ['diabetes', 'Diabetes'],
  ['asthma', 'Asthma'],
  ['lifeExp', 'Life expectancy']
] as const;

// Exact prototype table columns (prototype line 2070)
const cols = [
  ['name', 'Tract'],
  ['pop', 'Population'],
  ['svi', 'Vulnerability'],
  ['poverty', 'Poverty'],
  ['uninsured', 'Uninsured'],
  ['diabetes', 'Diabetes'],
  ['access', 'Access score']
] as const;

// Comparison palette (prototype line 2134)
const comparePalette = ['#2584EB', '#8B5CF6', '#F59E0B', '#F43F5E'];

function getV(d: any, k: string): number {
  if (!d) return 0;
  if (d.indicators && d.indicators[k] !== undefined) return Number(d.indicators[k]) || 0;
  if (d[k] !== undefined) return Number(d[k]) || 0;
  return 0;
}

function fmtInt(n: any): string {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString();
}

function countyLabel(c: any): string {
  if (!c) return '';
  const abbr = c.stateAbbr || (c.state && c.state.abbr) || (c.st && STATE_META[c.st]?.[0]) || (c.stateFips && STATE_META[c.stateFips]?.[0]) || '';
  return `${c.name}${abbr ? `, ${abbr}` : ''}`;
}

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
  const [sortDirection, setSortDirection] = useState<number>(-1);
  const [loading, setLoading] = useState(true);

  // Compare tray full tract records
  const [comparedTracts, setComparedTracts] = useState<CensusTract[]>([]);

  // Add Finding Modal state
  const [findingModalOpen, setFindingModalOpen] = useState(false);
  const [findingTract, setFindingTract] = useState<CensusTract | null>(null);
  const [findingNote, setFindingNote] = useState('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('__new');
  const [assessmentsList, setAssessmentsList] = useState<Assessment[]>([]);
  const [submittingFinding, setSubmittingFinding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // County repository for full state counties
  const [repo, setRepo] = useState<any>(null);
  useEffect(() => {
    getCountyRepository().then(r => setRepo(r)).catch(() => {});
  }, []);

  // Sync with URL or activeCounty
  useEffect(() => {
    if (urlCounty && urlCounty !== currentCountyId) {
      setCurrentCountyId(urlCounty);
    } else if (!urlCounty && activeCounty?._id && activeCounty._id !== currentCountyId) {
      setCurrentCountyId(activeCounty._id);
    }
  }, [urlCounty, activeCounty, currentCountyId]);

  useEffect(() => {
    if (urlTract) {
      setSelectedTractId(urlTract);
    }
  }, [urlTract]);

  // Workflow milestones matching prototype: wf('tract') on mount, and wf('review') if tract selected
  useEffect(() => {
    markWorkflowMilestone('tract');
    if (selectedTractId) {
      markWorkflowMilestone('review');
    }
  }, [markWorkflowMilestone, selectedTractId]);

  // Load tracts for active county
  useEffect(() => {
    if (!currentCountyId) return;
    setLoading(true);
    fetch(`/api/tracts?county=${currentCountyId}`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(res => {
        const data = res.data || [];
        setTracts(data);
        if (!selectedTractId || !data.some((t: CensusTract) => (t._id || (t as any).id) === selectedTractId)) {
          if (data.length > 0) {
            setSelectedTractId(data[0]._id || (data[0] as any).id);
          }
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [currentCountyId]);

  // Load compared tracts records when compare set changes
  const compareIds = session?.compareTracts || [];
  const flaggedIds = session?.flaggedTracts || [];

  useEffect(() => {
    if (compareIds.length === 0) {
      setComparedTracts([]);
      return;
    }

    const localMatches = tracts.filter(t => compareIds.includes(t._id || (t as any).id));
    if (localMatches.length === compareIds.length) {
      setComparedTracts(localMatches);
      return;
    }

    fetch(`/api/tracts/compare?ids=${compareIds.join(',')}`)
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        if (!res) return;
        const list = Array.isArray(res) ? res : res.tracts || [];
        if (list.length > 0) {
          setComparedTracts(list);
        } else if (localMatches.length > 0) {
          setComparedTracts(localMatches);
        }
      })
      .catch(() => {
        if (localMatches.length > 0) {
          setComparedTracts(localMatches);
        }
      });
  }, [compareIds, tracts]);

  // Load assessments for Finding modal
  useEffect(() => {
    fetch(`/api/assessments?jurisdiction=${currentCountyId}`)
      .then(r => (r.ok ? r.json() : []))
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

  const currentCounty = useMemo(() => {
    if (repo && currentCountyId && repo.countyById?.has(currentCountyId)) {
      return repo.countyById.get(currentCountyId);
    }
    return jurisdictions.find(j => (j._id || (j as any).id) === currentCountyId) || activeCounty;
  }, [repo, currentCountyId, jurisdictions, activeCounty]);

  const countyOptions = useMemo(() => {
    if (repo && currentCountyId) {
      const st = currentCountyId.slice(0, 2);
      const stCounties = repo.counties.filter((c: any) => c.st === st);
      if (stCounties.length > 0) {
        return stCounties.slice().sort((a: any, b: any) => a.name.localeCompare(b.name));
      }
    }
    return jurisdictions.map((j: any) => ({
      id: j._id || j.id,
      name: j.name,
      st: j.stateFips || (j._id || j.id).slice(0, 2),
      stateAbbr: j.stateAbbr || 'WA'
    }));
  }, [repo, currentCountyId, jurisdictions]);

  // Selected tract object
  const selectedTract = useMemo(() => {
    return tracts.find(t => (t._id || (t as any).id) === selectedTractId) || tracts[0] || null;
  }, [tracts, selectedTractId]);

  // Filtered and sorted tracts matching prototype rows() (prototype lines 2092-2094)
  const filteredTracts = useMemo(() => {
    const qs = searchQuery.trim().toLowerCase();
    const r = tracts.filter(t => {
      if (selectedTiers.size > 0 && !selectedTiers.has(t.tier)) return false;
      if (qs) {
        const id = t._id || (t as any).id || '';
        if (!(t.name + id).toLowerCase().includes(qs)) return false;
      }
      return true;
    });

    r.sort((a, b) => {
      if (sortKey === 'name') {
        return a.name.localeCompare(b.name, undefined, { numeric: true }) * sortDirection;
      }
      return (getV(a, sortKey) - getV(b, sortKey)) * sortDirection;
    });

    return r;
  }, [tracts, selectedTiers, searchQuery, sortKey, sortDirection]);

  // Max values for table mini visual bars: const mx = k => d3.max(tractsFor(cid), t => t[k]);
  const mx = (k: string) => {
    let max = 0;
    for (const t of tracts) {
      const v = getV(t, k);
      if (v > max) max = v;
    }
    return max || 1;
  };

  // Sorting handler matching prototype line 2146
  const handleSort = (k: string) => {
    if (sortKey === k) {
      setSortDirection(prev => prev * -1);
    } else {
      setSortKey(k);
      setSortDirection(k === 'name' ? 1 : -1);
    }
  };

  // Toggle tier filter matching prototype line 2145
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

  // Select tract matching prototype line 2113: wf('tract'); wf('review');
  const handleSelectTract = (id: string) => {
    setSelectedTractId(id);
    markWorkflowMilestone('tract');
    markWorkflowMilestone('review');
    const el = document.querySelector(`tr[data-id="${id}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // Toggle compare matching prototype lines 1812-1815
  const handleToggleCompare = (id: string) => {
    toggleCompareTract(id);
    if ((session?.compareTracts?.length || 0) + 1 >= 2) {
      markWorkflowMilestone('compare');
    }
  };

  // Flag tract matching prototype lines 1808-1811: wf('flag'); toast(...)
  const handleToggleFlag = (t: CensusTract) => {
    const tid = t._id || (t as any).id;
    toggleFlagTract(tid);
    markWorkflowMilestone('flag');
    setToastMessage(`${t.name} flagged as underserved`);
  };

  // Clear comparison matching prototype line 2141
  const handleClearCompare = () => {
    fetch('/api/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compareTracts: [] })
    }).catch(() => {});
    setComparedTracts([]);
  };

  // CSV Export matching prototype line 2147
  const handleExportCSV = () => {
    if (filteredTracts.length === 0) return;

    const headers = [
      'geoid',
      'tract',
      'county',
      'population',
      'svi',
      'tier',
      'poverty_pct',
      'uninsured_pct',
      'diabetes_pct',
      'access_score',
      'data_status'
    ];

    const rowsData = filteredTracts.map(t => [
      `"${t._id || (t as any).id}"`,
      `"${t.name}"`,
      `"${countyLabel(currentCounty)}"`,
      t.population || (t as any).pop || 0,
      getV(t, 'svi').toFixed(3),
      `"${TIER_LABEL[t.tier] || ''}"`,
      getV(t, 'poverty').toFixed(1),
      getV(t, 'uninsured').toFixed(1),
      getV(t, 'diabetes').toFixed(1),
      getV(t, 'access').toFixed(0),
      '"synthetic demo"'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rowsData.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `tracts-${currentCountyId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setToastMessage(`Exported ${filteredTracts.length} tracts to tracts-${currentCountyId}.csv`);
  };

  // Open finding modal matching prototype lines 1784-1794
  const handleOpenFindingModal = (t: CensusTract) => {
    setFindingTract(t);
    const svi = getV(t, 'svi').toFixed(2);
    const tier = (TIER_LABEL[t.tier] || 'Moderate').toLowerCase();
    const uninsured = getV(t, 'uninsured').toFixed(1);
    const diabetes = getV(t, 'diabetes').toFixed(1);
    setFindingNote(
      `High-need tract: vulnerability ${svi} (${tier} tier) with ${uninsured}% uninsured and ${diabetes}% diabetes prevalence. Candidate for targeted outreach.`
    );
    setFindingModalOpen(true);
  };

  // Submit finding to assessment matching prototype lines 1796-1804
  const handleSubmitFinding = async () => {
    if (!findingTract || !findingNote.trim()) return;
    setSubmittingFinding(true);

    try {
      let finalAssessmentId = selectedAssessmentId;
      if (finalAssessmentId === '__new') {
        const createRes = await fetch('/api/assessments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Needs assessment: ${countyLabel(currentCounty)}`,
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

      const res = await fetch('/api/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: finalAssessmentId,
          tractId: findingTract._id || (findingTract as any).id,
          note: findingNote
        })
      });

      if (res.ok) {
        await markWorkflowMilestone('finding');
        setToastMessage(`Finding added to ${finalAssessmentId}`);
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

  // Life expectancy gap calculation for comparison panel insight box (prototype line 2139)
  const lifeExpInsight = useMemo(() => {
    if (comparedTracts.length < 2) return null;
    const sorted = [...comparedTracts].sort((a, b) => getV(b, 'svi') - getV(a, 'svi'));
    const hi = sorted[0];
    const lo = [...comparedTracts].sort((a, b) => getV(a, 'svi') - getV(b, 'svi'))[0];
    const hiLe = getV(hi, 'lifeExp') || 75.2;
    const loLe = getV(lo, 'lifeExp') || 81.6;
    const gap = Math.abs(loLe - hiLe);
    return {
      hiName: hi.name.replace('Census ', ''),
      loName: lo.name.replace('Census ', ''),
      gap: gap.toFixed(1)
    };
  }, [comparedTracts]);

  const getCountyName = (t: any): string => {
    if (t.county && t.county.name) return t.county.name;
    return currentCounty?.name || 'County';
  };

  return (
    <>
      {/* Toast Notification in #toasts */}
      {toastMessage && (
        <div id="toasts">
          <div className="toast" role="status">
            <span className="ic">
              <Icon name="check" />
            </span>
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Page Header matching prototype lines 2071-2072 */}
      <div className="page-head">
        <div>
          <h1>Census tract explorer</h1>
          <p>
            Search, filter and compare tracts. Selecting a tract updates the map, the details panel and the comparison set.
          </p>
        </div>
        <div className="head-actions">
          <span className="pill demo">
            <span className="dot" />Demo environment
          </span>
          <button className="btn" id="ct-exp" onClick={handleExportCSV}>
            <Icon name="download" />
            <span>Export CSV</span>
          </button>
          <Link
            href={`/health-map?county=${currentCountyId}${selectedTractId ? `&tract=${selectedTractId}` : ''}`}
            className="btn primary"
            id="ct-map"
          >
            <Icon name="map" />
            <span>View on health map</span>
          </Link>
        </div>
      </div>

      {/* Main Grid matching prototype lines 2073-2088 */}
      <div className="grid g-12">
        {/* Left Column: Panel c-8 */}
        <section className="panel c-8">
          <div className="row" style={{ marginBottom: '14px', gap: '10px' }}>
            <label className="field" style={{ minWidth: '220px', flex: 1 }}>
              County
              <select
                className="input"
                id="ct-county"
                value={currentCountyId}
                onChange={e => {
                  const cid = e.target.value;
                  setCurrentCountyId(cid);
                  setSelectedTractId(null);
                  setActiveJurisdiction(cid);
                }}
              >
                {countyOptions.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {countyLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1, minWidth: '200px' }}>
              Search tracts
              <input
                className="input"
                id="ct-q"
                placeholder="Tract number or GEOID"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </label>
            <div className="field">
              <span>Vulnerability tier</span>
              <div className="chips" id="ct-tier">
                {TIER_LABEL.map((l, i) => (
                  <button
                    key={i}
                    className={`chip ${selectedTiers.has(i) ? 'on' : ''}`}
                    data-t={i}
                    onClick={() => toggleTierFilter(i)}
                  >
                    <i className="tier" style={{ background: TIER_COLOR[i] }} />
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: '470px', overflow: 'auto' }}>
            <table className="tbl" id="ct-tbl">
              <thead>
                <tr>
                  <th style={{ width: '34px' }}>
                    <span className="sr-only" style={{ position: 'absolute', left: '-9999px' }}>
                      Compare
                    </span>
                  </th>
                  {cols.map(([k, l]) => (
                    <th
                      key={k}
                      className={`sort ${k === 'name' ? '' : 'r'} ${sortKey === k ? 'sorted' : ''}`}
                      data-k={k}
                      onClick={() => handleSort(k)}
                    >
                      {l}
                      <span className="arr">
                        {sortKey === k ? (sortDirection > 0 ? '↑' : '↓') : '↕'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTracts.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty">
                        <b>No tracts match these filters</b>
                        Clear the tier filter or search to see all {tracts.length} tracts.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTracts.map(t => {
                    const tid = t._id || (t as any).id;
                    const isSel = tid === (selectedTract?._id || (selectedTract as any)?.id);
                    const isCmp = compareIds.includes(tid);
                    const isFlg = flaggedIds.includes(tid);
                    return (
                      <tr
                        key={tid}
                        className={`clickable ${isSel ? 'sel' : ''}`}
                        data-id={tid}
                        onClick={() => handleSelectTract(tid)}
                      >
                        <td onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Compare ${t.name}`}
                            checked={isCmp}
                            onChange={() => handleToggleCompare(tid)}
                            style={{ accentColor: 'var(--cyan)' }}
                          />
                        </td>
                        <td>
                          <b>{t.name.replace('Census ', '')}</b>
                          {isFlg && (
                            <>
                              {' '}
                              <span className="pill bad" style={{ padding: '1px 7px' }}>
                                <Icon name="flag" style={{ width: 11, height: 11 }} />
                                Flagged
                              </span>
                            </>
                          )}
                          <div className="note">{tid}</div>
                        </td>
                        <td className="r num">{fmtInt(t.population || (t as any).pop)}</td>
                        <td className="r">
                          <span className="num">
                            <i className="tier" style={{ background: TIER_COLOR[t.tier] }} />
                            {getV(t, 'svi').toFixed(2)}
                          </span>
                        </td>
                        {(['poverty', 'uninsured', 'diabetes'] as const).map(k => (
                          <td key={k} className="r">
                            <div className="bar-cell">
                              <span className="num">{getV(t, k).toFixed(1)}%</span>
                              <i style={{ width: `${(getV(t, k) / mx(k)) * 30}px` }} />
                            </div>
                          </td>
                        ))}
                        <td className="r num">{getV(t, 'access').toFixed(0)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="row between mt">
            <span className="note" id="ct-count">
              {filteredTracts.length} of {tracts.length} tracts in {countyLabel(currentCounty)}
            </span>
            <span className="note">Tick the box on a row to add it to the comparison (up to 4).</span>
          </div>
        </section>

        {/* Right Column: c-4 stack matching prototype lines 2083-2086 */}
        <div className="c-4 stack" style={{ gap: '18px' }}>
          {/* Map Panel */}
          <section className="panel" style={{ padding: 0, overflow: 'hidden', height: '300px', position: 'relative' }}>
            <div id="ct-map-el" style={{ position: 'absolute', inset: 0 }}>
              <CensusTractMap
                countyFips={currentCountyId}
                tracts={tracts}
                selectedTractId={selectedTract?._id || (selectedTract as any)?.id}
                compareTractIds={compareIds}
                onSelectTract={(t: any) => handleSelectTract(t._id || t.id)}
                onCountySelect={(cid: string) => {
                  if (cid !== currentCountyId) {
                    setCurrentCountyId(cid);
                    setSelectedTractId(null);
                    setActiveJurisdiction(cid);
                  }
                }}
                height={300}
                showLegend={false}
              />
            </div>
            <div
              className="map-float legend"
              id="ct-leg"
              style={{ left: '10px', bottom: '10px', minWidth: '180px', padding: '8px 10px' }}
            >
              <div className="ttl">
                <span>Tract vulnerability</span>
              </div>
              <div className="ramp">
                {VULN_RAMP.map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </div>
              <div className="ends">
                <span>0.04</span>
                <span>Tiers</span>
                <span>0.98</span>
              </div>
            </div>
          </section>

          {/* Detail Panel matching prototype lines 2114-2132 */}
          <section className="panel" id="ct-detail">
            {!selectedTract ? (
              <div className="empty">
                <b>Select a tract</b>Click a row or a tract on the map to see its indicators.
              </div>
            ) : (
              <>
                <div className="panel-h" style={{ marginBottom: '8px' }}>
                  <div>
                    <h3>{selectedTract.name}</h3>
                    <div className="sub">
                      GEOID {selectedTract._id || (selectedTract as any).id}. {fmtInt(selectedTract.population || (selectedTract as any).pop)} residents
                    </div>
                  </div>
                  <span className="pill" style={{ color: TIER_COLOR[selectedTract.tier] }}>
                    <span className="dot" />
                    {TIER_LABEL[selectedTract.tier]}
                  </span>
                </div>
                <table className="tbl" style={{ fontSize: '12.5px' }}>
                  <thead>
                    <tr>
                      <th>Indicator</th>
                      <th className="r">Tract</th>
                      <th className="r">County</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsD.map(([k, l]) => {
                      const tv = getV(selectedTract, k);
                      const cv = getV(currentCounty, k);
                      const m = METRICS_DEF[k] || { bad: 'high', f: (v: number) => String(v) };
                      const worse = m.bad === 'low' ? tv < cv : tv > cv;
                      return (
                        <tr key={k}>
                          <td>{l}</td>
                          <td className="r num" style={{ color: worse ? 'var(--rose)' : 'var(--teal)' }}>
                            {m.f(tv)}
                          </td>
                          <td className="r num muted">{m.f(cv)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="row mt" style={{ flexWrap: 'nowrap' }}>
                  <button
                    className="btn sm"
                    style={{ flex: 1 }}
                    id="cd-cmp"
                    onClick={() => handleToggleCompare(selectedTract._id || (selectedTract as any).id)}
                  >
                    <Icon name="compare" />
                    <span>
                      {compareIds.includes(selectedTract._id || (selectedTract as any).id)
                        ? 'Remove from compare'
                        : 'Compare'}
                    </span>
                  </button>
                  <button
                    className={`btn sm ${flaggedIds.includes(selectedTract._id || (selectedTract as any).id) ? 'danger' : ''}`}
                    style={{ flex: 1 }}
                    id="cd-flag"
                    onClick={() => handleToggleFlag(selectedTract)}
                  >
                    <Icon name="flag" />
                    <span>
                      {flaggedIds.includes(selectedTract._id || (selectedTract as any).id)
                        ? 'Flagged'
                        : 'Flag underserved'}
                    </span>
                  </button>
                </div>
                <button
                  className="btn primary mt-s"
                  style={{ width: '100%' }}
                  id="cd-find"
                  onClick={() => handleOpenFindingModal(selectedTract)}
                >
                  <Icon name="clipboard" />
                  <span>Add finding to assessment</span>
                </button>
              </>
            )}
          </section>
        </div>

        {/* Comparison Panel c-12 matching prototype lines 2133-2142 */}
        <section className="panel c-12" id="ct-cmp">
          {comparedTracts.length < 2 ? (
            <>
              <div className="panel-h">
                <div>
                  <h3>Tract comparison</h3>
                  <div className="sub">Select at least two tracts to compare them side by side</div>
                </div>
              </div>
              <div className="empty">
                <b>{comparedTracts.length ? '1 tract selected' : 'No tracts selected'}</b>
                Tick the box next to tracts in the table, or use Compare on the health map. Tracts from different counties can be compared.
              </div>
            </>
          ) : (
            <>
              <div className="panel-h">
                <div>
                  <h3>Tract comparison</h3>
                  <div className="sub">{comparedTracts.length} tracts. Values in percent</div>
                </div>
                <button className="btn sm" id="cmp-clear" onClick={handleClearCompare}>
                  <Icon name="x" />
                  <span>Clear comparison</span>
                </button>
              </div>
              <div className="grid g-12">
                <div className="c-8">
                  <div id="cmp-chart">
                    <GroupedBarChart
                      categories={['Poverty', 'Uninsured', 'No vehicle', 'Diabetes', 'Asthma', 'Unemployment']}
                      series={comparedTracts.map((t, i) => ({
                        name: t.name.replace('Census ', ''),
                        color: comparePalette[i % comparePalette.length],
                        values: ['poverty', 'uninsured', 'noVehicle', 'diabetes', 'asthma', 'unemployment'].map(k =>
                          getV(t, k)
                        )
                      }))}
                      height={250}
                      format={x => `${x.toFixed(0)}%`}
                    />
                  </div>
                  <div className="legend-row">
                    {comparedTracts.map((t, i) => (
                      <span key={t._id || (t as any).id}>
                        <i style={{ background: comparePalette[i % comparePalette.length] }} />
                        {t.name.replace('Census ', '')}, {getCountyName(t)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="c-4">
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Tract</th>
                          <th className="r">Vulnerability</th>
                          <th className="r">Life exp.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparedTracts.map((t, i) => (
                          <tr key={t._id || (t as any).id}>
                            <td>
                              <i
                                className="tier"
                                style={{ background: comparePalette[i % comparePalette.length] }}
                              />
                              {t.name.replace('Census Tract ', '')}
                            </td>
                            <td className="r num">{getV(t, 'svi').toFixed(2)}</td>
                            <td className="r num">{getV(t, 'lifeExp').toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {lifeExpInsight && (
                    <div className="insight mt">
                      <span className="ic">
                        <Icon name="spark" />
                      </span>
                      <p>
                        {lifeExpInsight.hiName} carries the highest vulnerability, with a life expectancy gap of{' '}
                        <b>{lifeExpInsight.gap} years</b> against {lifeExpInsight.loName}.
                        <small>Calculated from synthetic demo values</small>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Add Finding Modal matching prototype lines 1788-1795 */}
      {findingModalOpen && findingTract && (
        <div id="modal-root" className="open">
          <div className="modal-scrim" onClick={() => setFindingModalOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true" style={{ width: '480px', maxWidth: '90vw' }}>
            <div className="modal-h">
              <div>
                <h2>Add finding to an assessment</h2>
                <p>
                  {findingTract.name}, {countyLabel(currentCounty)}. GEOID {findingTract._id || (findingTract as any).id}
                </p>
              </div>
              <button className="icon-btn" data-close aria-label="Close" onClick={() => setFindingModalOpen(false)}>
                <Icon name="x" />
              </button>
            </div>

            <div className="grid g-12">
              <div className="c-6 c-lg-6">
                <div className="kv">
                  <dt>Vulnerability</dt>
                  <dd>
                    {getV(findingTract, 'svi').toFixed(2)} ({TIER_LABEL[findingTract.tier] || ''})
                  </dd>
                  <dt>Poverty</dt>
                  <dd>{getV(findingTract, 'poverty').toFixed(1)}%</dd>
                  <dt>Uninsured</dt>
                  <dd>{getV(findingTract, 'uninsured').toFixed(1)}%</dd>
                  <dt>Diabetes</dt>
                  <dd>{getV(findingTract, 'diabetes').toFixed(1)}%</dd>
                  <dt>Access score</dt>
                  <dd>{getV(findingTract, 'access').toFixed(0)}/100</dd>
                </div>
              </div>
              <div className="c-6 c-lg-6 stack">
                <label className="field">
                  Assessment
                  <select
                    className="input"
                    id="fa-a"
                    value={selectedAssessmentId}
                    onChange={e => setSelectedAssessmentId(e.target.value)}
                  >
                    {assessmentsList
                      .filter(a => a.status !== 'Completed')
                      .map(a => (
                        <option key={a._id} value={a._id}>
                          {a.title} ({a.status})
                        </option>
                      ))}
                    <option value="__new">Create a new draft assessment</option>
                  </select>
                </label>
                <label className="field">
                  Finding
                  <textarea
                    className="input"
                    id="fa-n"
                    rows={4}
                    value={findingNote}
                    onChange={e => setFindingNote(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="modal-f">
              <span className="note">Values are synthetic demo data captured at the time of the finding.</span>
              <button
                className="btn primary"
                id="fa-go"
                onClick={handleSubmitFinding}
                disabled={submittingFinding}
              >
                <Icon name="plus" />
                <span>{submittingFinding ? 'Saving...' : 'Add finding'}</span>
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
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading census tract explorer...</div>}>
      <CensusTractsContent />
    </Suspense>
  );
}
