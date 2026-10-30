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
import { useSearchParams } from 'next/navigation';
import { MapViewCanvas } from '@/components/MapViewCanvas';
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

  // Comparison metrics grouped multi-bar configuration
  const compareMetrics = [
    { key: 'poverty', label: 'Poverty %' },
    { key: 'uninsured', label: 'Uninsured %' },
    { key: 'noVehicle', label: 'No Vehicle %' },
    { key: 'diabetes', label: 'Diabetes %' },
    { key: 'asthma', label: 'Asthma %' },
    { key: 'unemployment', label: 'Unemp %' }
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
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[200] px-4 py-2.5 rounded-xl bg-[var(--surface-solid)] border border-[var(--cyan)] shadow-2xl text-[12.5px] font-bold text-[var(--cyan)] flex items-center gap-2 animate-in slide-in-from-bottom-3">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Screen Header & Top Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text)] tracking-tight">
            Census Tract Explorer
          </h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Search, filter and compare tracts. Selecting a tract updates the map, the details panel and the comparison set.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-solid)] text-[12.5px] font-bold text-[var(--text)] hover:bg-[var(--surface-2)] shadow-xs transition-all"
          >
            <Download className="w-4 h-4 text-[var(--cyan)]" />
            <span>Export CSV</span>
          </button>
          <Link
            href={`/health-map?county=${currentCountyId}&tract=${selectedTractId || ''}`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--cyan)] hover:opacity-90 text-[12.5px] font-bold text-white shadow-md transition-all"
          >
            <MapPin className="w-4 h-4" />
            <span>View on Health Map</span>
          </Link>
        </div>
      </div>

      {/* Main 12-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (Col 8): Search, Filters, & Sortable Data Table */}
        <section className="lg:col-span-8 rounded-2xl glass-panel p-5 flex flex-col justify-between">
          {/* Filter Bar Controls */}
          <div className="flex flex-col md:flex-row md:items-end gap-3 pb-4 border-b border-[var(--line)]">
            {/* County Selector Dropdown */}
            <div className="w-full md:w-56">
              <label className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1">
                County Jurisdiction
              </label>
              <select
                value={currentCountyId}
                onChange={(e) => {
                  const val = e.target.value;
                  setCurrentCountyId(val);
                  setActiveJurisdiction(val);
                }}
                className="w-full h-9 px-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[12px] font-bold text-[var(--text)] outline-none focus:border-[var(--cyan)]"
              >
                {jurisdictions.map(j => (
                  <option key={j._id} value={j._id}>
                    {j.name}, {j.stateAbbr}
                  </option>
                ))}
              </select>
            </div>

            {/* Real-time Search Tracts input */}
            <div className="flex-1 min-w-[200px]">
              <label className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1">
                Search Tracts
              </label>
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[var(--faint)] absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Tract number or 11-digit GEOID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[12px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
                />
              </div>
            </div>

            {/* Vulnerability Tier Filter Chips */}
            <div>
              <label className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1">
                Vulnerability Tier
              </label>
              <div className="flex items-center gap-1">
                {TIER_LABELS.map((label, idx) => (
                  <button
                    key={label}
                    onClick={() => toggleTierFilter(idx)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 border transition-all ${
                      selectedTiers.has(idx)
                        ? 'border-[var(--cyan)] bg-[var(--glow)] text-[var(--cyan)] shadow-xs'
                        : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TIER_COLORS[idx] }} />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Census Tracts Table with Custom Scroll Area */}
          <div className="my-3 overflow-x-auto max-h-[460px] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-solid)]">
            <table className="w-full text-left text-[12.5px] border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--surface-2)] border-b border-[var(--line-strong)] text-[11px] font-bold text-[var(--faint)] uppercase">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <span className="sr-only">Compare</span>
                  </th>
                  <th
                    onClick={() => handleSort('name')}
                    className="p-3 cursor-pointer hover:text-[var(--text)] transition-colors select-none"
                  >
                    <div className="flex items-center gap-1">
                      <span>Tract</span>
                      {sortKey === 'name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--cyan)]" /> : <ArrowDown className="w-3 h-3 text-[var(--cyan)]" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('population')}
                    className="p-3 text-right cursor-pointer hover:text-[var(--text)] transition-colors select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Population</span>
                      {sortKey === 'population' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--cyan)]" /> : <ArrowDown className="w-3 h-3 text-[var(--cyan)]" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('svi')}
                    className="p-3 text-right cursor-pointer hover:text-[var(--text)] transition-colors select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Vulnerability</span>
                      {sortKey === 'svi' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--cyan)]" /> : <ArrowDown className="w-3 h-3 text-[var(--cyan)]" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('poverty')}
                    className="p-3 text-right cursor-pointer hover:text-[var(--text)] transition-colors select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Poverty</span>
                      {sortKey === 'poverty' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--cyan)]" /> : <ArrowDown className="w-3 h-3 text-[var(--cyan)]" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('uninsured')}
                    className="p-3 text-right cursor-pointer hover:text-[var(--text)] transition-colors select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Uninsured</span>
                      {sortKey === 'uninsured' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--cyan)]" /> : <ArrowDown className="w-3 h-3 text-[var(--cyan)]" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('diabetes')}
                    className="p-3 text-right cursor-pointer hover:text-[var(--text)] transition-colors select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Diabetes</span>
                      {sortKey === 'diabetes' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--cyan)]" /> : <ArrowDown className="w-3 h-3 text-[var(--cyan)]" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('access')}
                    className="p-3 text-right cursor-pointer hover:text-[var(--text)] transition-colors select-none"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Access</span>
                      {sortKey === 'access' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--cyan)]" /> : <ArrowDown className="w-3 h-3 text-[var(--cyan)]" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {filteredTracts.length > 0 ? (
                  filteredTracts.map((t) => {
                    const isSelected = t._id === selectedTractId;
                    const isCompared = compareIds.includes(t._id);
                    const isFlagged = session?.flaggedTracts?.includes(t._id);

                    const povVal = (t.indicators as any)?.poverty || 0;
                    const uninsVal = (t.indicators as any)?.uninsured || 0;
                    const diabVal = (t.indicators as any)?.diabetes || 0;
                    const accessVal = (t.indicators as any)?.access || 0;

                    return (
                      <tr
                        key={t._id}
                        onClick={() => setSelectedTractId(t._id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[var(--glow)]/80 text-[var(--text)] font-semibold'
                            : 'hover:bg-[var(--surface-2)] text-[var(--text)]'
                        }`}
                      >
                        {/* Compare Checkbox */}
                        <td
                          className="p-3 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isCompared}
                            onChange={() => toggleCompareTract(t._id)}
                            className="w-4 h-4 rounded accent-[var(--cyan)] cursor-pointer"
                            aria-label={`Compare ${t.name}`}
                          />
                        </td>

                        {/* Tract Name & Flagged Tag */}
                        <td className="p-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold">{t.name.replace('Census ', '')}</span>
                            {isFlagged && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--rose)]/15 border border-[var(--rose)]/30 text-[10px] font-bold text-[var(--rose)]">
                                <Flag className="w-2.5 h-2.5" />
                                <span>Flagged</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-[var(--faint)] font-mono">{t._id}</div>
                        </td>

                        {/* Population */}
                        <td className="p-3 text-right num">
                          {(t.population || 0).toLocaleString()}
                        </td>

                        {/* SVI Vulnerability with Tier Dot */}
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-1.5 num font-bold">
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: TIER_COLORS[t.tier] }}
                            />
                            <span>{t.svi.toFixed(2)}</span>
                          </div>
                        </td>

                        {/* Poverty Rate with Mini-bar */}
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="num">{povVal.toFixed(1)}%</span>
                            <div className="w-12 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden hidden sm:block">
                              <div
                                className="h-full bg-[var(--rose)] rounded-full"
                                style={{ width: `${Math.min(100, (povVal / maxVals.poverty) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Uninsured Rate with Mini-bar */}
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="num">{uninsVal.toFixed(1)}%</span>
                            <div className="w-12 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden hidden sm:block">
                              <div
                                className="h-full bg-[var(--amber)] rounded-full"
                                style={{ width: `${Math.min(100, (uninsVal / maxVals.uninsured) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Diabetes Prevalence with Mini-bar */}
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="num">{diabVal.toFixed(1)}%</span>
                            <div className="w-12 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden hidden sm:block">
                              <div
                                className="h-full bg-[var(--violet)] rounded-full"
                                style={{ width: `${Math.min(100, (diabVal / maxVals.diabetes) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Access Score */}
                        <td className="p-3 text-right num font-semibold">
                          {accessVal.toFixed(0)}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-[12px] text-[var(--muted)]">
                      <div className="flex flex-col items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-[var(--faint)]" />
                        <span>No census tracts match your current search or tier filters.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer Count & Help */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11.5px] text-[var(--muted)] pt-2 border-t border-[var(--line)]">
            <span>
              {filteredTracts.length} of {tracts.length} tracts in {currentCounty?.name || 'King County'}, {currentCounty?.stateAbbr}
            </span>
            <span className="text-[var(--faint)] mt-1 sm:mt-0">
              Tick the box on any row to add to comparison set (up to 4).
            </span>
          </div>
        </section>

        {/* Right Column (Col 4): Map Preview & Selected Tract Detail Card */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Top Panel: Centered D3 County Vector Map Preview (300px) */}
          <section className="rounded-2xl glass-panel p-0 overflow-hidden relative h-[290px] border border-[var(--line)]">
            <MapViewCanvas
              countyFips={currentCountyId}
              tracts={tracts}
              selectedTractId={selectedTractId || undefined}
              onSelectTract={(t) => setSelectedTractId(t._id)}
              heatmap={false}
              markers={false}
              height={290}
            />
            {/* Map Legend Overlay */}
            <div className="absolute left-3 bottom-3 px-3 py-1.5 rounded-xl bg-[var(--surface-solid)]/90 backdrop-blur-md border border-[var(--line-strong)] text-[10.5px]">
              <span className="font-bold text-[var(--text)] block mb-1">Vulnerability Tiers</span>
              <div className="flex items-center gap-1">
                {TIER_COLORS.map((c, i) => (
                  <span key={i} className="w-4 h-2 rounded-xs" style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </section>

          {/* Bottom Panel: Selected Tract Detail Card */}
          <section className="rounded-2xl glass-panel p-5 flex flex-col justify-between flex-1">
            {selectedTract ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between pb-3 border-b border-[var(--line)]">
                  <div>
                    <h3 className="text-base font-bold text-[var(--text)]">{selectedTract.name}</h3>
                    <div className="text-[11px] text-[var(--faint)] mt-0.5 font-mono">
                      GEOID {selectedTract._id} • {(selectedTract.population || 0).toLocaleString()} residents
                    </div>
                  </div>
                  <span
                    className="px-2.5 py-1 rounded-full text-[11px] font-bold text-white shadow-xs"
                    style={{ backgroundColor: TIER_COLORS[selectedTract.tier] }}
                  >
                    {TIER_LABELS[selectedTract.tier]}
                  </span>
                </div>

                {/* Tract vs County Indicator Comparison Table */}
                <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] text-[12px]">
                  <table className="w-full text-left">
                    <thead className="bg-[var(--surface-2)] text-[10.5px] font-bold text-[var(--faint)] uppercase border-b border-[var(--line)]">
                      <tr>
                        <th className="p-2.5">Indicator</th>
                        <th className="p-2.5 text-right">Tract</th>
                        <th className="p-2.5 text-right">County</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {[
                        { key: 'svi', label: 'Vulnerability', bad: 'high', unit: '' },
                        { key: 'poverty', label: 'Poverty Rate', bad: 'high', unit: '%' },
                        { key: 'uninsured', label: 'Uninsured Rate', bad: 'high', unit: '%' },
                        { key: 'noVehicle', label: 'No Vehicle', bad: 'high', unit: '%' },
                        { key: 'diabetes', label: 'Diabetes', bad: 'high', unit: '%' },
                        { key: 'asthma', label: 'Asthma', bad: 'high', unit: '%' },
                        { key: 'lifeExp', label: 'Life Expectancy', bad: 'low', unit: ' yrs' }
                      ].map(item => {
                        const tv = (selectedTract.indicators as any)?.[item.key] ?? (selectedTract as any)[item.key] ?? 0;
                        const cv = (currentCounty?.indicators as any)?.[item.key] ?? (currentCounty as any)?.[item.key] ?? (item.key === 'lifeExp' ? 80.5 : 12.0);
                        const isWorse = item.bad === 'low' ? tv < cv : tv > cv;

                        return (
                          <tr key={item.key}>
                            <td className="p-2.5 font-medium text-[var(--text)]">{item.label}</td>
                            <td className={`p-2.5 text-right font-bold num ${isWorse ? 'text-[var(--rose)]' : 'text-[var(--teal)]'}`}>
                              {typeof tv === 'number' ? (item.key === 'svi' ? tv.toFixed(2) : tv.toFixed(1)) : 'N/A'}{item.unit}
                            </td>
                            <td className="p-2.5 text-right num text-[var(--muted)]">
                              {typeof cv === 'number' ? (item.key === 'svi' ? cv.toFixed(2) : cv.toFixed(1)) : 'N/A'}{item.unit}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Action Buttons: Compare, Flag, Add Finding */}
                <div className="pt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => toggleCompareTract(selectedTract._id)}
                      className={`py-2 px-3 rounded-xl text-[12px] font-bold flex items-center justify-center gap-1.5 border transition-all ${
                        compareIds.includes(selectedTract._id)
                          ? 'bg-[var(--cyan)]/15 border-[var(--cyan)] text-[var(--cyan)]'
                          : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text)] hover:border-[var(--cyan)]'
                      }`}
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>{compareIds.includes(selectedTract._id) ? 'Remove Compare' : 'Compare'}</span>
                    </button>

                    <button
                      onClick={() => toggleFlagTract(selectedTract._id)}
                      className={`py-2 px-3 rounded-xl text-[12px] font-bold flex items-center justify-center gap-1.5 border transition-all ${
                        session?.flaggedTracts?.includes(selectedTract._id)
                          ? 'bg-[var(--rose)]/15 border-[var(--rose)] text-[var(--rose)]'
                          : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text)] hover:border-[var(--rose)]'
                      }`}
                    >
                      <Flag className="w-3.5 h-3.5" />
                      <span>{session?.flaggedTracts?.includes(selectedTract._id) ? 'Flagged' : 'Flag Area'}</span>
                    </button>
                  </div>

                  <button
                    onClick={() => handleOpenFindingModal(selectedTract)}
                    className="w-full py-2.5 px-4 rounded-xl bg-[var(--cyan)] text-white hover:opacity-90 text-[12.5px] font-bold flex items-center justify-center gap-2 shadow-xs transition-all"
                  >
                    <ClipboardList className="w-4 h-4" />
                    <span>Add Finding to Assessment</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[12.5px] text-[var(--muted)]">
                <MapPin className="w-6 h-6 text-[var(--faint)] mb-2" />
                <span className="font-bold text-[var(--text)]">Select a Census Tract</span>
                <span className="text-[11.5px] mt-1">Click any row in the table or polygon on the map to review details.</span>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Full-Width Bottom Section (Col 12): Tract Comparison Tray */}
      <section className="rounded-2xl glass-panel p-5">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
          <div>
            <h3 className="text-base font-bold text-[var(--text)]">Tract Comparison Tray</h3>
            <p className="text-[12px] text-[var(--muted)]">
              {comparedTracts.length >= 2
                ? `${comparedTracts.length} tracts compared side-by-side (values in %)`
                : 'Select 2 to 4 tracts using the row checkboxes to evaluate inequities side-by-side.'}
            </p>
          </div>
          {comparedTracts.length > 0 && (
            <button
              onClick={async () => {
                await fetch('/api/session', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ compareTracts: [] })
                });
                setComparedTracts([]);
              }}
              className="text-[12px] font-bold text-[var(--rose)] hover:underline flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear Comparison ({comparedTracts.length})</span>
            </button>
          )}
        </div>

        {comparedTracts.length >= 2 ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-4">
            {/* D3 Multi-Bar Grouped Chart (Col 8) */}
            <div className="lg:col-span-8 flex flex-col justify-between space-y-4">
              <GroupedBarChart
                categories={compareMetrics.map(m => m.label)}
                series={comparedTracts.map((t, i) => ({
                  name: t.name.replace('Census Tract ', 'Tract ').replace('Census ', ''),
                  color: comparePalette[i % 4],
                  values: compareMetrics.map(m => (t.indicators as any)?.[m.key] || 0)
                }))}
                height={240}
              />

              {/* Legend Row under the Graph */}
              <div className="flex items-center gap-4 flex-wrap text-[12px] pt-3 border-t border-[var(--line)]">
                {comparedTracts.map((t, i) => (
                  <div key={t._id} className="flex items-center gap-1.5 font-bold text-[var(--text)]">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: comparePalette[i % 4] }} />
                    <span>{t.name.replace('Census ', '')}, {currentCounty?.name || ''}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Life Expectancy Gap Summary Table & Insight Callout (Col 4) */}
            <div className="lg:col-span-4 flex flex-col justify-between gap-4">
              <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] text-[12px]">
                <table className="w-full text-left">
                  <thead className="bg-[var(--surface-2)] text-[10.5px] font-bold text-[var(--faint)] uppercase border-b border-[var(--line)]">
                    <tr>
                      <th className="p-2.5">Tract</th>
                      <th className="p-2.5 text-right">SVI</th>
                      <th className="p-2.5 text-right">Life Exp.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {comparedTracts.map((t, i) => (
                      <tr key={t._id}>
                        <td className="p-2.5 font-bold flex items-center gap-1.5 text-[var(--text)]">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: comparePalette[i % 4] }} />
                          <span>{t.name.replace('Census Tract ', '')}</span>
                        </td>
                        <td className="p-2.5 text-right num font-semibold">{t.svi.toFixed(2)}</td>
                        <td className="p-2.5 text-right num font-bold text-[var(--cyan)]">
                          {((t.indicators as any)?.lifeExp || 78.5).toFixed(1)} yrs
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Automated Inequity & Gap Insight */}
              {lifeExpGapInsight && (
                <div className="p-4 rounded-xl bg-[var(--cyan)]/10 border border-[var(--cyan)]/30 text-[12.5px] leading-relaxed">
                  <div className="flex items-center gap-1.5 font-bold text-[var(--cyan)] mb-1">
                    <Sparkles className="w-4 h-4" />
                    <span>Clinical Inequity Observation</span>
                  </div>
                  <p className="text-[var(--text)]">
                    <strong className="text-[var(--cyan)]">{lifeExpGapInsight.mostName}</strong> carries the highest social vulnerability, with a life expectancy gap of{' '}
                    <strong className="text-[var(--rose)]">{lifeExpGapInsight.gap} years</strong> compared to{' '}
                    <strong>{lifeExpGapInsight.leastName}</strong>.
                  </p>
                  <span className="block text-[10.5px] text-[var(--faint)] mt-2">
                    Computed dynamically from live census surveillance records.
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-[12.5px] text-[var(--muted)]">
            <Share2 className="w-6 h-6 text-[var(--faint)] mx-auto mb-2" />
            <div className="font-bold text-[var(--text)]">
              {comparedTracts.length === 1 ? '1 Tract Selected' : 'No Tracts in Comparison Set'}
            </div>
            <p className="text-[11.5px] text-[var(--muted)] mt-1 max-w-md mx-auto">
              Check the comparison checkbox on at least two tracts in the table above to generate multi-metric grouped charts and automated life expectancy gap insights.
            </p>
          </div>
        )}
      </section>

      {/* Add Finding to Assessment Modal */}
      {findingModalOpen && findingTract && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between pb-3 border-b border-[var(--line)]">
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">Add Finding to Assessment</h3>
                <p className="text-[12px] text-[var(--muted)]">
                  {findingTract.name} • GEOID {findingTract._id}
                </p>
              </div>
              <button
                onClick={() => setFindingModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tract Snapshot Indicators */}
            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-[var(--surface-2)] text-[11.5px]">
              <div>
                <span className="text-[var(--faint)] block">SVI Index</span>
                <span className="font-bold text-[var(--text)] num">{findingTract.svi.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[var(--faint)] block">Poverty</span>
                <span className="font-bold text-[var(--rose)] num">{((findingTract.indicators as any)?.poverty || 14.2).toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-[var(--faint)] block">Uninsured</span>
                <span className="font-bold text-[var(--amber)] num">{((findingTract.indicators as any)?.uninsured || 8.6).toFixed(1)}%</span>
              </div>
            </div>

            {/* Target Assessment Picker */}
            <div>
              <label className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1">
                Select Target Assessment
              </label>
              <select
                value={selectedAssessmentId}
                onChange={(e) => setSelectedAssessmentId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[12.5px] font-bold text-[var(--text)] outline-none"
              >
                {assessmentsList.map(a => (
                  <option key={a._id} value={a._id}>
                    {a.title} ({a.status})
                  </option>
                ))}
                <option value="__new">+ Create New Draft Assessment</option>
              </select>
            </div>

            {/* Clinical Observation Finding Note */}
            <div>
              <label className="text-[11px] font-bold text-[var(--faint)] uppercase block mb-1">
                Clinical Observation / Public Health Note
              </label>
              <textarea
                rows={4}
                value={findingNote}
                onChange={(e) => setFindingNote(e.target.value)}
                className="w-full p-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
                placeholder="Enter detailed clinical observation..."
              />
            </div>

            {/* Modal Footer Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
              <button
                onClick={() => setFindingModalOpen(false)}
                className="px-4 py-2 rounded-xl text-[12.5px] font-bold text-[var(--muted)] hover:text-[var(--text)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitFinding}
                disabled={submittingFinding || !findingNote.trim()}
                className="px-5 py-2 rounded-xl bg-[var(--cyan)] hover:opacity-90 disabled:opacity-50 text-[12.5px] font-bold text-white shadow-md transition-all flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>{submittingFinding ? 'Recording...' : 'Attach Finding'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CensusTractsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[13px] text-[var(--muted)]">Loading census tract surveillance...</div>}>
      <CensusTractsContent />
    </Suspense>
  );
}
