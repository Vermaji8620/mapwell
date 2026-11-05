'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { getCountyRepository, STATE_META } from '@/utils/countyRepository';
import gsap from 'gsap';
import { animateViewExit, animateViewEntrance } from '@/utils/transitions';

interface TopbarProps {
  onOpenMobileMenu: () => void;
}

const RANGES: Record<number, string> = {
  10: '2016 – 2025',
  5: '2021 – 2025',
  3: '2023 – 2025'
};

const ROUTE_PAGES: Array<{ r: string; t: string }> = [
  { r: '/', t: 'Community Health Dashboard' },
  { r: '/health-map', t: 'Interactive Health Map' },
  { r: '/census-tracts', t: 'Census Tract Explorer' },
  { r: '/health-disparities', t: 'Health Disparity Analysis' },
  { r: '/social-determinants', t: 'Social Determinants of Health' },
  { r: '/disease-incidence', t: 'Disease Incidence' },
  { r: '/program-utilization', t: 'Program Utilization' },
  { r: '/assessments', t: 'Community Health Needs Assessments' },
  { r: '/reports', t: 'Reports & Exports' },
  { r: '/data-management', t: 'Data Management' }
];

const NOTIFICATIONS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-1 8.5z" />
      </svg>
    ),
    title: 'ACS 5-year tract estimates synchronized',
    sub: 'Census Bureau API, today 06:12',
    route: 'data-management'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 2 20h20z" />
        <path d="M12 10v4M12 17.5v.5" />
      </svg>
    ),
    title: 'Program enrollment extract failed',
    sub: 'Credentials expired for the state registry',
    route: 'data-management'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V3h6v1M9 11h6M9 15h4" />
      </svg>
    ),
    title: 'Assessment A-2041 moved to review',
    sub: 'Community Health Team',
    route: 'assessments'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h6" />
      </svg>
    ),
    title: 'Q3 community vulnerability brief published',
    sub: 'Reports & exports',
    route: 'reports'
  }
];

function countyLabel(c: any): string {
  if (!c) return '';
  const rawName = c.name || '';
  const cleanName = rawName.replace(/\s+(County|Parish|Borough)$/i, '');
  const st = c.st || c.stateFips || (c.id ? String(c.id).padStart(5, '0').slice(0, 2) : '');
  const designation = st === '22' ? 'Parish' : st === '02' ? 'Borough' : 'County';
  const abbr = c.stateAbbr || c.state?.abbr || (c.stateName ? STATE_META[st]?.[0] || c.stateName.slice(0, 2).toUpperCase() : '');
  return `${cleanName} ${designation}, ${abbr}`;
}

function fmtK(v: number): string {
  if (!v) return '0';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k';
  return Math.round(v).toString();
}

function peersOf(c: any, all: any[], n = 6) {
  if (!c || !all.length) return [];
  const cSvi = c.svi ?? 0.5;
  const cPop = c.pop || c.population || 80000;
  const cSt = c.st || c.stateFips || (c.id ? String(c.id).padStart(5, '0').slice(0, 2) : '');
  const cId = c.id || c._id;

  return all
    .filter((x: any) => (x.id || x._id) !== cId && (x.st || x.stateFips) !== cSt)
    .map((x: any) => {
      const xSvi = x.svi ?? 0.5;
      const xPop = x.pop || x.population || 80000;
      const d = Math.abs(xSvi - cSvi) * 3 + Math.abs(Math.log((xPop || 1) / (cPop || 1)));
      return { x, d };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((o) => o.x);
}

type ActiveDropdown = 'jur' | 'date' | 'bell' | 'role' | null;

export function Topbar({ onOpenMobileMenu }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const {
    activeCounty,
    setActiveJurisdiction,
    jurisdictions,
    session,
    trendYears = 10,
    setTrendYears,
    setWorkflowDrawerOpen,
    theme,
    setTheme
  } = useSession();

  // Active dropdown state & position
  const [activeDropdown, setActiveDropdown] = useState<ActiveDropdown>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Jurisdiction search input state
  const [jurFilter, setJurFilter] = useState('');

  // Global search input state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSearchIdx, setSelectedSearchIdx] = useState(0);
  const [tractHits, setTractHits] = useState<any[]>([]);

  // Notifications badge state
  const [hasBadge, setHasBadge] = useState(true);

  // County repository
  const [allCounties, setAllCounties] = useState<any[]>([]);

  useEffect(() => {
    getCountyRepository()
      .then((repo) => {
        if (repo && repo.counties) {
          setAllCounties(repo.counties);
        }
      })
      .catch(() => {});
  }, []);

  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Open/toggle a dropdown anchored to a specific button
  const openDropdown = (type: ActiveDropdown, anchor: HTMLElement, width: number) => {
    if (activeDropdown === type) {
      setActiveDropdown(null);
      return;
    }
    const r = anchor.getBoundingClientRect();
    let left: number;
    if (type === 'role') {
      left = r.right - width;
      if (left + width > window.innerWidth - 10) {
        left = window.innerWidth - width - 10;
      }
      left = Math.max(10, left);
    } else {
      left = r.left;
      if (left + width > window.innerWidth - 10) {
        left = window.innerWidth - width - 10;
      }
      left = Math.max(10, left);
    }
    const top = r.bottom + 8;
    setDropdownPos({ top, left });
    setActiveDropdown(type);
  };

  // Animate dropdown entrance with GSAP matching prototype lines 1757
  useEffect(() => {
    if (activeDropdown && dropdownRef.current) {
      gsap.fromTo(
        dropdownRef.current,
        { opacity: 0, y: -6, clipPath: 'inset(0% 0% 100% 0%)' },
        { opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.45, ease: 'expo.out', clearProps: 'clipPath' }
      );
    }
  }, [activeDropdown]);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        target.closest('.dropdown') ||
        target.closest('#jur-btn') ||
        target.closest('#date-btn') ||
        target.closest('#bell') ||
        target.closest('#role-btn')
      ) {
        return;
      }
      setActiveDropdown(null);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setActiveDropdown(null);
        setSearchOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Update dropdown position on resize or scroll
  useEffect(() => {
    if (!activeDropdown) return;
    const updatePos = () => {
      let anchorId = '';
      let width = 320;
      if (activeDropdown === 'jur') {
        anchorId = 'jur-btn';
        width = 320;
      } else if (activeDropdown === 'date') {
        anchorId = 'date-btn';
        width = 220;
      } else if (activeDropdown === 'bell') {
        anchorId = 'bell';
        width = 340;
      } else if (activeDropdown === 'role') {
        anchorId = 'role-btn';
        width = 280;
      }
      const anchor = document.getElementById(anchorId);
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        let left: number;
        if (activeDropdown === 'role') {
          left = r.right - width;
          if (left + width > window.innerWidth - 10) {
            left = window.innerWidth - width - 10;
          }
          left = Math.max(10, left);
        } else {
          left = r.left;
          if (left + width > window.innerWidth - 10) {
            left = window.innerWidth - width - 10;
          }
          left = Math.max(10, left);
        }
        setDropdownPos({ top: r.bottom + 8, left });
      }
    };
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [activeDropdown]);

  // Global search outside-click dismissal
  useEffect(() => {
    function handleClickOutsideSearch(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutsideSearch);
    return () => document.removeEventListener('mousedown', handleClickOutsideSearch);
  }, []);

  // Keyboard shortcut '/' to focus search globally (when not typing in other inputs)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered counties for jurisdiction selector (peer counties when empty, search results when typed)
  const jurHits = useMemo(() => {
    const q = jurFilter.toLowerCase().trim();
    const sourceList = allCounties.length > 0 ? allCounties : jurisdictions;
    if (!q) {
      if (!activeCounty) return sourceList.slice(0, 7);
      return [activeCounty, ...peersOf(activeCounty, sourceList, 6)];
    }
    return sourceList
      .filter((c: any) => {
        const text = `${c.name} ${c.stateName || ''} ${c.stateAbbr || ''} ${c.state || ''}`.toLowerCase();
        return text.includes(q);
      })
      .slice(0, 12);
  }, [jurFilter, allCounties, jurisdictions, activeCounty]);

  // Fetch tract hits when query is numeric with 6+ digits
  useEffect(() => {
    const q = searchQuery.trim();
    if (/^\d{6,}/.test(q)) {
      const countyFips = q.slice(0, 5);
      fetch(`/api/tracts?county=${countyFips}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          const raw = Array.isArray(data) ? data : data.data || [];
          const matched = raw
            .filter((t: any) => (t.id || t._id || t.geoid || '').startsWith(q))
            .slice(0, 4);
          setTractHits(matched);
        })
        .catch(() => setTractHits([]));
    } else {
      setTractHits([]);
    }
  }, [searchQuery]);

  // Global search multi-entity results matching prototype line 2813-2823
  const searchResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (q.length < 2) return [];

    const pages = ROUTE_PAGES.filter((p) => p.t.toLowerCase().includes(q)).map((p) => ({
      kind: 'page' as const,
      r: p.r,
      t: p.t
    }));

    const sourceList = allCounties.length > 0 ? allCounties : jurisdictions;
    const cs = sourceList
      .filter((c: any) => {
        const text = `${c.name} ${c.stateName || c.state?.name || ''} ${c.stateAbbr || c.state?.abbr || ''}`.toLowerCase();
        return text.includes(q);
      })
      .slice(0, 6)
      .map((c: any) => ({
        kind: 'county' as const,
        c
      }));

    const tr = tractHits.map((t: any) => ({
      kind: 'tract' as const,
      t
    }));

    return [...pages, ...cs, ...tr];
  }, [searchQuery, allCounties, jurisdictions, tractHits]);

  // Pick a search result item
  const pickSearchResult = (item: any) => {
    if (!item) return;
    setSearchQuery('');
    setSearchOpen(false);
    searchInputRef.current?.blur();

    if (item.kind === 'page') {
      window.dispatchEvent(new CustomEvent('mapwell:navigate', { detail: { href: item.r } }));
    } else if (item.kind === 'county') {
      const cid = item.c.id || item.c._id;
      setActiveJurisdiction(cid);
      window.dispatchEvent(new CustomEvent('mapwell:navigate', { detail: { href: '/health-map' } }));
    } else if (item.kind === 'tract') {
      const cid = item.t.countyId || item.t.county?.id || item.t.id?.slice(0, 5);
      if (cid) setActiveJurisdiction(cid);
      window.dispatchEvent(new CustomEvent('mapwell:navigate', { detail: { href: '/census-tracts' } }));
    }
  };

  // Completed workflow milestones count
  const wfCount = useMemo(() => {
    if (!session) return 2;
    const wf = (session as any).workflow || session.workflowMilestones;
    if (!wf) return 2;
    return Object.values(wf).filter(Boolean).length;
  }, [session]);

  const wfPct = Math.round((wfCount / 10) * 100);

  // Toggle theme matching prototype line 1069126: exit (200ms) -> flip theme -> staggered entrance (700ms)
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const view = document.getElementById('view');

    const applyNextTheme = () => {
      try {
        localStorage.setItem('mapwell-theme', next);
      } catch {}
      document.documentElement.setAttribute('data-theme', next);
      setTheme(next);
    };

    if (!view) {
      applyNextTheme();
      return;
    }

    // Phase 1: 200ms exit fade & upward lift
    animateViewExit(view, () => {
      // Phase 2: swap theme tokens
      applyNextTheme();

      // Phase 3: 700ms staggered entrance bloom with new theme colors
      requestAnimationFrame(() => {
        animateViewEntrance(view);
      });
    });
  };

  const activeCountyLabel = activeCounty ? countyLabel(activeCounty) : 'King County, WA';
  const initials = user?.avatar || 'PA';

  return (
    <>
      <header id="topbar">
        {/* 1. Mobile Menu Button matching prototype line 880 */}
        <button
          className="icon-btn menu-btn"
          id="menu-btn"
          aria-label="Open navigation"
          onClick={onOpenMobileMenu}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        {/* 2. Jurisdiction Button matching prototype line 881 */}
        <button
          className="jur-btn"
          id="jur-btn"
          aria-label="Change jurisdiction"
          onClick={(e) => openDropdown('jur', e.currentTarget, 320)}
        >
          <span className="pin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </span>
          <span className="lbl">
            <small>Jurisdiction</small>
            <b id="jur-name">{activeCountyLabel}</b>
          </span>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ color: 'var(--faint)' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* 3. Global Search Input matching prototype line 882 */}
        <div className="search" ref={searchRef}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchInputRef}
            id="g-search"
            placeholder="Search counties, tracts or screens…"
            autoComplete="off"
            aria-label="Search"
            value={searchQuery}
            onChange={(e) => {
              const val = e.target.value;
              setSearchQuery(val);
              setSearchOpen(val.trim().length >= 2);
              setSelectedSearchIdx(0);
            }}
            onFocus={() => {
              if (searchQuery.trim().length >= 2) {
                setSearchOpen(true);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedSearchIdx((prev) => Math.min(prev + 1, Math.max(0, searchResults.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedSearchIdx((prev) => Math.max(prev - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (searchResults[selectedSearchIdx]) {
                  pickSearchResult(searchResults[selectedSearchIdx]);
                }
              } else if (e.key === 'Escape') {
                setSearchOpen(false);
              }
            }}
          />
          <span className="kbd">/</span>
          <div
            className={`search-results ${searchOpen ? 'open' : ''}`}
            id="g-results"
            role="listbox"
          >
            {searchResults.length > 0 ? (
              searchResults.map((x, i) => (
                <div
                  key={i}
                  className={`sr-item ${i === selectedSearchIdx ? 'hl' : ''}`}
                  data-i={i}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSearchResult(x);
                  }}
                  onMouseEnter={() => setSelectedSearchIdx(i)}
                >
                  {x.kind === 'page' ? (
                    <>
                      <span>{x.t}</span>
                      <small>Screen</small>
                    </>
                  ) : x.kind === 'county' ? (
                    <>
                      <span>{countyLabel(x.c)}</span>
                      <small>Open on map</small>
                    </>
                  ) : (
                    <>
                      <span>{x.t.name}</span>
                      <small>{x.t.id}</small>
                    </>
                  )}
                </div>
              ))
            ) : (
              <div className="sr-item">
                <small>No screens, counties or tracts match</small>
              </div>
            )}
          </div>
        </div>

        {/* 4. Top Spacer matching prototype line 883 */}
        <div className="top-spacer" />

        {/* 5. Date Trend Window Selector matching prototype line 884 */}
        <button
          className="date-btn hide-m"
          id="date-btn"
          aria-haspopup="listbox"
          onClick={(e) => openDropdown('date', e.currentTarget, 220)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
          <span className="t" id="date-lbl">
            {RANGES[trendYears] || '2016 – 2025'}
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ color: 'var(--muted)' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* 6. Guided Workflow Chip matching prototype line 885 */}
        <button
          className="wf-chip"
          id="wf-chip"
          aria-label="Open guided workflow"
          onClick={() => setWorkflowDrawerOpen(true)}
        >
          <svg className="ring-svg" width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="12.25" fill="none" stroke="var(--surface-2)" strokeWidth="3.5" />
            <circle
              className="ring-fg"
              data-pct={wfCount * 10}
              cx="14"
              cy="14"
              r="12.25"
              fill="none"
              stroke="var(--teal)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray={76.969}
              strokeDashoffset={76.969 * (1 - (wfCount * 10) / 100)}
              transform="rotate(-90 14 14)"
              style={{
                transition: 'stroke-dashoffset 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
                filter: 'drop-shadow(0 0 4px var(--teal))'
              }}
            />
          </svg>
          <span className="t">Workflow {wfCount}/10</span>
        </button>

        {/* 7. Theme Toggle Button matching prototype line 886 */}
        <button
          className="icon-btn"
          id="theme-btn"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
            </svg>
          )}
        </button>

        {/* 8. Notification Bell matching prototype line 887 */}
        <button
          className="icon-btn hide-m"
          id="bell"
          aria-label="Notifications"
          onClick={(e) => {
            setHasBadge(false);
            openDropdown('bell', e.currentTarget, 340);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />
          </svg>
          {hasBadge && <span className="badge" />}
        </button>

        {/* 9. User Role Badge matching prototype line 888 */}
        <div
          className="role"
          id="role-btn"
          role="button"
          tabIndex={0}
          aria-label="Account menu"
          style={{ cursor: 'pointer' }}
          onClick={(e) => openDropdown('role', e.currentTarget, 280)}
        >
          <span className="avatar mono" id="role-av" aria-hidden="true">
            {initials}
          </span>
          <span className="t">
            <b id="role-name">{user?.roleName || 'Public Health Analyst'}</b>
            <small id="role-org">{user?.organization || 'County Health Department'}</small>
          </span>
        </div>
      </header>

      {/* Global Clamped Dropdowns Container */}
      {activeDropdown === 'jur' && (
        <div
          ref={dropdownRef}
          className="dropdown dropdown-anim"
          style={{
            position: 'fixed',
            top: `${dropdownPos.top}px`,
            left: `${dropdownPos.left}px`,
            width: '320px',
            zIndex: 100
          }}
        >
          <div style={{ padding: '6px 6px 10px' }}>
            <b style={{ fontSize: '13px', display: 'block' }}>Active jurisdiction</b>
            <div className="note" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
              Sets the default county for every screen
            </div>
          </div>
          <input
            className="input"
            id="jp-q"
            placeholder="Search counties"
            style={{
              width: '100%',
              marginBottom: '6px',
              borderColor: 'var(--cyan)',
              boxShadow: '0 0 0 3px var(--glow)'
            }}
            value={jurFilter}
            onChange={(e) => setJurFilter(e.target.value)}
            autoFocus
          />
          <div id="jp-r" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {!jurFilter && (
              <div className="note" style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--muted)' }}>
                Current and peer counties
              </div>
            )}
            {jurHits.map((c: any) => {
              const cid = c.id || c._id;
              const isSelected = activeCounty?._id === cid || (activeCounty as any)?.id === cid;
              return (
                <div
                  key={cid}
                  className={`sr-item ${isSelected ? 'hl' : ''}`}
                  data-c={cid}
                  onClick={() => {
                    setActiveJurisdiction(cid);
                    setActiveDropdown(null);
                    setJurFilter('');
                    window.dispatchEvent(new CustomEvent('mapwell:navigate'));
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{countyLabel(c)}</span>
                  <small style={{ color: 'var(--faint)', fontSize: '12px' }}>
                    {fmtK(c.pop || c.population || 0)}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeDropdown === 'date' && (
        <div
          ref={dropdownRef}
          className="dropdown dropdown-anim"
          style={{
            position: 'fixed',
            top: `${dropdownPos.top}px`,
            left: `${dropdownPos.left}px`,
            width: '220px',
            zIndex: 100
          }}
        >
          <div style={{ padding: '6px 8px 8px' }}>
            <b style={{ fontSize: '13px', display: 'block' }}>Trend window</b>
            <div className="note" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
              Applies to dashboard trend charts
            </div>
          </div>
          {[10, 5, 3].map((y) => (
            <div
              key={y}
              className={`sr-item ${y === trendYears ? 'hl' : ''}`}
              data-r={y}
              onClick={() => {
                setTrendYears(y);
                setActiveDropdown(null);
                window.dispatchEvent(new CustomEvent('mapwell:navigate'));
              }}
            >
              <span>{RANGES[y]}</span>
              <small>{y} years</small>
            </div>
          ))}
        </div>
      )}

      {activeDropdown === 'bell' && (
        <div
          ref={dropdownRef}
          className="dropdown dropdown-anim"
          style={{
            position: 'fixed',
            top: `${dropdownPos.top}px`,
            left: `${dropdownPos.left}px`,
            width: '340px',
            boxSizing: 'border-box',
            padding: '8px',
            zIndex: 100
          }}
        >
          <div style={{ padding: '6px 8px 8px' }}>
            <b style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Notifications</b>
          </div>
          <div className="list" style={{ padding: '0 8px', width: '100%', boxSizing: 'border-box' }}>
            {NOTIFICATIONS.map((item, idx) => (
              <div
                key={idx}
                className="li"
                style={{ cursor: 'pointer' }}
                data-go={item.route}
                onClick={() => {
                  setActiveDropdown(null);
                  const target = `/${item.route}`;
                  window.dispatchEvent(new CustomEvent('mapwell:navigate', { detail: { href: target } }));
                }}
              >
                <span className="ic">{item.icon}</span>
                <div className="b" style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ whiteSpace: 'normal', wordBreak: 'normal', lineHeight: 1.35 }}>{item.title}</b>
                  <small style={{ display: 'block', color: 'var(--faint)', fontSize: '12px', marginTop: '2px' }}>
                    {item.sub}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeDropdown === 'role' && (
        <div
          ref={dropdownRef}
          className="dropdown dropdown-anim"
          style={{
            position: 'fixed',
            top: `${dropdownPos.top}px`,
            left: `${dropdownPos.left}px`,
            width: '280px',
            zIndex: 100,
            padding: '8px',
            boxSizing: 'border-box',
            transformOrigin: 'top right'
          }}
        >
          <div style={{ padding: '8px 10px 10px' }}>
            <b style={{ fontSize: '13px', display: 'block', color: 'var(--text)' }} id="dd-role">
              {user?.roleName || 'Public Health Analyst'}
            </b>
            <div className="note" id="dd-org" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
              {user?.organization || 'County Health Department'}
            </div>
          </div>
          <div
            className="sr-item"
            id="dd-wf"
            onClick={() => {
              setActiveDropdown(null);
              setWorkflowDrawerOpen(true);
            }}
          >
            <span>Guided workflow</span>
            <small>{wfCount}/10</small>
          </div>
          <div
            className="sr-item"
            id="dd-out"
            onClick={() => {
              setActiveDropdown(null);
              logout();
            }}
          >
            <span>Sign out</span>
            <small>Return to sign-in</small>
          </div>
        </div>
      )}
    </>
  );
}
