'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useAuth } from '@/context/AuthContext';
import { Icon } from './Icons';
import { useRouter, usePathname } from 'next/navigation';
import { getCountyRepository, STATE_META } from '@/utils/countyRepository';

interface TopbarProps {
  onOpenMobileMenu: () => void;
}

const RANGES: Record<number, string> = {
  3: '2023 – 2025',
  5: '2021 – 2025',
  10: '2016 – 2025'
};

const NOTIFICATIONS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-1 8.5z" />
      </svg>
    ),
    title: 'ACS 5-year tract estimates synchronized',
    sub: 'Census Bureau API, today 06:12',
    route: 'data-management'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
  const name = (c.name || '').replace(/\s+(County|Parish|Borough)$/i, '');
  const st = c.st || c.stateFips || (c.id ? String(c.id).padStart(5, '0').slice(0, 2) : '');
  const designation = st === '22' ? 'Parish' : st === '02' ? 'Borough' : 'County';
  const abbr = c.stateAbbr || c.state?.abbr || (c.stateName ? c.stateName.slice(0, 2).toUpperCase() : '');
  return `${name} ${designation}, ${abbr}`;
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

export function Topbar({ onOpenMobileMenu }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const {
    activeCounty,
    setActiveJurisdiction,
    jurisdictions,
    session,
    trendYears,
    setTrendYears,
    setWorkflowDrawerOpen,
    theme,
    setTheme
  } = useSession();

  // Dropdown states
  const [jurOpen, setJurOpen] = useState(false);
  const [jurFilter, setJurFilter] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSearchIdx, setSelectedSearchIdx] = useState(0);
  const [roleOpen, setRoleOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [hasBadge, setHasBadge] = useState(true);
  const [bellPos, setBellPos] = useState<{ top: number; left: number } | null>(null);
  const [allCounties, setAllCounties] = useState<any[]>([]);

  useEffect(() => {
    getCountyRepository().then((repo) => {
      if (repo && repo.counties) {
        setAllCounties(repo.counties);
      }
    }).catch(() => {});
  }, []);

  const jurRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const bellButtonRef = useRef<HTMLButtonElement>(null);
  const bellDropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close popups on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (jurRef.current && !jurRef.current.contains(target)) setJurOpen(false);
      if (dateRef.current && !dateRef.current.contains(target)) setDateOpen(false);
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
      if (roleRef.current && !roleRef.current.contains(target)) setRoleOpen(false);
      if (
        bellButtonRef.current &&
        !bellButtonRef.current.contains(target) &&
        (!bellDropdownRef.current || !bellDropdownRef.current.contains(target))
      ) {
        setBellOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update bell dropdown position on resize or scroll
  useEffect(() => {
    const updatePos = () => {
      if (bellOpen && bellButtonRef.current) {
        const r = bellButtonRef.current.getBoundingClientRect();
        const w = 320;
        let left = r.left;
        if (left + w > window.innerWidth - 10) {
          left = window.innerWidth - w - 10;
        }
        setBellPos({ top: r.bottom + 8, left: Math.max(10, left) });
      }
    };
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [bellOpen]);

  const toggleBell = () => {
    if (!bellOpen && bellButtonRef.current) {
      const r = bellButtonRef.current.getBoundingClientRect();
      const w = 320;
      let left = r.left;
      if (left + w > window.innerWidth - 10) {
        left = window.innerWidth - w - 10;
      }
      setBellPos({ top: r.bottom + 8, left: Math.max(10, left) });
    }
    setHasBadge(false);
    setBellOpen((prev) => !prev);
  };

  // Keyboard shortcut '/' to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered counties for jurisdiction selector (matches local prototype peersOf + search)
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

  // Global search items (screens and counties) with instant suggestions
  const searchResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const results: Array<{ label: string; sub: string; type: 'screen' | 'county'; action: () => void }> = [];

    const screens = [
      { name: 'Overview Dashboard', href: '/' },
      { name: 'Interactive Health Map', href: '/health-map' },
      { name: 'Census Tract Explorer', href: '/census-tracts' },
      { name: 'Health Disparity Analysis', href: '/health-disparities' },
      { name: 'Social Determinants of Health', href: '/social-determinants' },
      { name: 'Disease Incidence', href: '/disease-incidence' },
      { name: 'Program Utilization', href: '/program-utilization' },
      { name: 'Community Needs Assessments', href: '/assessments' },
      { name: 'Reports & Exports', href: '/reports' },
      { name: 'Data Management', href: '/data-management' }
    ];

    if (!q) {
      // Immediate suggestions on focus / selection
      screens.slice(0, 5).forEach((s) => {
        results.push({
          label: s.name,
          sub: 'Screen',
          type: 'screen',
          action: () => {
            setSearchOpen(false);
            setSearchQuery('');
            if (pathname === s.href) {
              window.dispatchEvent(new CustomEvent('mapwell:navigate'));
            } else {
              router.push(s.href);
            }
          }
        });
      });

      const sourceList = allCounties.length > 0 ? allCounties : jurisdictions;
      const suggestedCounties = sourceList.slice(0, 5);
      suggestedCounties.forEach((c: any) => {
        const id = c.id || c._id;
        results.push({
          label: `${c.name}, ${c.stateName || c.state || c.stateAbbr || ''}`,
          sub: `${c.pop ? (c.pop >= 1e6 ? (c.pop / 1e6).toFixed(1) + 'M' : Math.round(c.pop / 1e3) + 'k') + ' residents' : (c.totalTracts || 0) + ' tracts'}`,
          type: 'county',
          action: () => {
            setActiveJurisdiction(id);
            setSearchOpen(false);
          }
        });
      });

      return results;
    }

    screens.forEach((s) => {
      if (s.name.toLowerCase().includes(q)) {
        results.push({
          label: s.name,
          sub: 'Screen',
          type: 'screen',
          action: () => {
            setSearchOpen(false);
            setSearchQuery('');
            if (pathname === s.href) {
              window.dispatchEvent(new CustomEvent('mapwell:navigate'));
            } else {
              router.push(s.href);
            }
          }
        });
      }
    });

    const sourceList = allCounties.length > 0 ? allCounties : jurisdictions;
    sourceList.forEach((c: any) => {
      const match =
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.stateName && c.stateName.toLowerCase().includes(q)) ||
        (c.stateAbbr && c.stateAbbr.toLowerCase().includes(q)) ||
        (c.state && c.state.toLowerCase().includes(q));

      if (match && results.length < 18) {
        const id = c.id || c._id;
        results.push({
          label: `${c.name}, ${c.stateName || c.state || c.stateAbbr || ''}`,
          sub: `${c.pop ? (c.pop >= 1e6 ? (c.pop / 1e6).toFixed(1) + 'M' : Math.round(c.pop / 1e3) + 'k') + ' residents' : (c.totalTracts || 0) + ' tracts'}`,
          type: 'county',
          action: () => {
            setActiveJurisdiction(id);
            setSearchOpen(false);
          }
        });
      }
    });

    return results;
  }, [searchQuery, allCounties, jurisdictions, router, setActiveJurisdiction]);

  // Completed workflow milestones count
  const wfCount = useMemo(() => {
    if (!session) return 2;
    const wf = (session as any).workflow || session.workflowMilestones;
    if (!wf) return 2;
    return Object.values(wf).filter(Boolean).length;
  }, [session]);

  // Workflow progress percentage for circular SVG
  const wfPct = Math.round((wfCount / 10) * 100);
  const circumference = 2 * Math.PI * 11; // r=11 inside 28x28
  const strokeDashoffset = circumference - (wfPct / 100) * circumference;

  // Toggle theme - reloads the entire current page in the new theme
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('mapwell-theme', next);
    } catch {}
    document.documentElement.setAttribute('data-theme', next);
    fetch('/api/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next })
    }).catch(() => {});
    window.location.reload();
  };

  const activeCountyLabel = activeCounty ? countyLabel(activeCounty) : 'King County, WA';

  return (
    <header id="topbar">
      {/* Mobile Menu Button */}
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

      {/* Jurisdiction Picker */}
      <div className="relative" ref={jurRef}>
        <button
          className="jur-btn"
          id="jur-btn"
          aria-label="Change jurisdiction"
          onClick={() => setJurOpen(!jurOpen)}
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

        {jurOpen && (
          <div
            className="dropdown"
            style={{
              position: 'absolute',
              top: '52px',
              left: '0',
              zIndex: 100,
              width: '320px',
              padding: '8px',
              borderRadius: '16px',
              background: 'var(--surface-solid)',
              border: '1px solid var(--line-strong)',
              boxShadow: 'var(--shadow)'
            }}
          >
            <div style={{ padding: '6px 6px 10px' }}>
              <b style={{ fontSize: '13px', display: 'block' }}>Active jurisdiction</b>
              <div className="note" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                Sets the default county for every screen
              </div>
            </div>
            <input
              type="text"
              className="input"
              id="jp-q"
              placeholder="Search counties"
              value={jurFilter}
              onChange={(e) => setJurFilter(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                height: '38px',
                padding: '0 12px',
                borderRadius: '10px',
                border: '1px solid var(--cyan)',
                boxShadow: '0 0 0 3px var(--glow)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                fontSize: '13px',
                fontWeight: 500,
                outline: 'none',
                marginBottom: '6px'
              }}
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
                      setJurOpen(false);
                      setJurFilter('');
                      window.dispatchEvent(new CustomEvent('mapwell:navigate'));
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 10px',
                      borderRadius: '9px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      background: isSelected ? 'var(--surface-2)' : undefined,
                      color: 'var(--text)',
                      transition: 'background 0.15s',
                      userSelect: 'none'
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
      </div>

      {/* Global Search */}
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
            setSearchQuery(e.target.value);
            setSearchOpen(true);
            setSelectedSearchIdx(0);
          }}
          onFocus={() => {
            setSearchOpen(true);
            setSelectedSearchIdx(0);
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
                searchResults[selectedSearchIdx].action();
              } else if (searchResults[0]) {
                searchResults[0].action();
              }
            } else if (e.key === 'Escape') {
              setSearchOpen(false);
            }
          }}
        />
        <span className="kbd">/</span>

        {searchOpen && (
          <div
            className="search-results open dropdown-anim"
            id="g-results"
            role="listbox"
            style={{
              position: 'absolute',
              top: '48px',
              left: 0,
              right: 0,
              background: 'var(--surface-solid)',
              border: '1px solid var(--line-strong)',
              borderRadius: '14px',
              boxShadow: 'var(--shadow)',
              padding: '6px',
              zIndex: 100,
              maxHeight: '340px',
              overflowY: 'auto'
            }}
          >
            {searchResults.length > 0 ? (
              searchResults.map((item, idx) => (
                <div
                  key={idx}
                  className={`sr-item ${idx === selectedSearchIdx ? 'hl' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    item.action();
                  }}
                  onClick={item.action}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '9px 12px',
                    borderRadius: '9px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    background: idx === selectedSearchIdx ? 'var(--surface-2)' : undefined,
                    color: 'var(--text)',
                    userSelect: 'none'
                  }}
                  onMouseEnter={() => setSelectedSearchIdx(idx)}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <small
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: item.type === 'screen' ? 'var(--cyan)' : 'var(--muted)'
                    }}
                  >
                    {item.sub}
                  </small>
                </div>
              ))
            ) : (
              <div className="sr-item" style={{ padding: '9px 12px' }}>
                <small style={{ color: 'var(--faint)' }}>No screens, counties or tracts match</small>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="top-spacer" />

      {/* Date Range Selector */}
      <div className="relative hide-m" ref={dateRef}>
        <button
          className="date-btn"
          id="date-btn"
          aria-haspopup="listbox"
          onClick={() => setDateOpen(!dateOpen)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
          <span className="t" id="date-lbl">
            {RANGES[trendYears] || `${trendYears} Yrs`}
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

        {dateOpen && (
          <div
            className="dropdown"
            style={{
              position: 'absolute',
              top: '48px',
              right: 0,
              width: '210px',
              borderRadius: '14px',
              background: 'var(--surface-solid)',
              border: '1px solid var(--line-strong)',
              boxShadow: 'var(--shadow)',
              padding: '6px',
              zIndex: 100
            }}
          >
            <div style={{ padding: '6px 10px 4px', fontSize: '11px', fontWeight: 600, color: 'var(--faint)' }}>
              Trend analysis window
            </div>
            {[10, 5, 3].map((y) => (
              <button
                key={y}
                onClick={() => {
                  setTrendYears(y);
                  setDateOpen(false);
                  window.dispatchEvent(new CustomEvent('mapwell:navigate'));
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: 0,
                  background: trendYears === y ? 'var(--surface-2)' : 'none',
                  fontSize: '12.5px',
                  fontWeight: trendYears === y ? 600 : 500,
                  cursor: 'pointer',
                  color: 'var(--text)'
                }}
              >
                <span>{y} years</span>
                <span style={{ fontSize: '11px', color: 'var(--faint)' }}>{RANGES[y]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Guided Workflow Chip - exact local prototype ring design */}
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
            cx="14"
            cy="14"
            r="12.25"
            fill="none"
            stroke="var(--teal)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={76.969}
            strokeDashoffset={76.969 - (wfPct / 100) * 76.969}
            transform="rotate(-90 14 14)"
            style={{
              transition: 'stroke-dashoffset 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
              filter: 'drop-shadow(0 0 4px var(--teal))'
            }}
          />
        </svg>
        <span className="t">Workflow {wfCount}/10</span>
      </button>

      {/* Theme Toggle Button */}
      <button
        className="icon-btn"
        id="theme-btn"
        aria-label="Toggle theme"
        onClick={toggleTheme}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
      </button>

      {/* Notification Bell */}
      <div className="relative hide-m">
        <button
          ref={bellButtonRef}
          className="icon-btn"
          id="bell"
          aria-label="Notifications"
          onClick={toggleBell}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />
          </svg>
          {hasBadge && <span className="badge" />}
        </button>

        {bellOpen && bellPos && (
          <div
            ref={bellDropdownRef}
            className="dropdown dropdown-anim"
            style={{
              position: 'fixed',
              top: `${bellPos.top}px`,
              left: `${bellPos.left}px`,
              zIndex: 100,
              width: '320px',
              padding: '8px',
              borderRadius: '16px',
              background: 'var(--surface-solid)',
              border: '1px solid var(--line-strong)',
              boxShadow: 'var(--shadow)'
            }}
          >
            <div style={{ padding: '6px 8px 8px' }}>
              <b style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Notifications</b>
            </div>
            <div className="list" style={{ padding: '0 8px', width: '100%', display: 'flex', flexDirection: 'column' }}>
              {NOTIFICATIONS.map((item, idx) => (
                <div
                  key={idx}
                  className="li"
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center',
                    padding: '11px 0',
                    borderBottom: idx === NOTIFICATIONS.length - 1 ? '0' : '1px solid var(--line)',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => {
                    setBellOpen(false);
                    const target = `/${item.route}`;
                    if (pathname === target) {
                      window.dispatchEvent(new CustomEvent('mapwell:navigate'));
                    } else {
                      router.push(target);
                    }
                  }}
                >
                  <span
                    className="ic"
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      flex: 'none',
                      display: 'grid',
                      placeItems: 'center',
                      background: '#E6F3FF',
                      border: '0',
                      color: 'var(--cyan)'
                    }}
                  >
                    {item.icon}
                  </span>
                  <div className="b" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <b style={{ whiteSpace: 'normal', fontSize: '13px', fontWeight: 700, lineHeight: '1.35', color: 'var(--text)' }}>
                      {item.title}
                    </b>
                    <small style={{ color: 'var(--faint)', fontSize: '12px', marginTop: '2px' }}>
                      {item.sub}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Role & Account Dropdown */}
      <div className="relative" ref={roleRef}>
        <button
          className="role"
          id="role-btn"
          aria-label="Account menu"
          onClick={() => setRoleOpen(!roleOpen)}
        >
          <span className="avatar mono" id="role-av" aria-hidden="true">
            {user?.avatar || 'PA'}
          </span>
          <span className="t">
            <b id="role-name">{user?.roleName || 'Public Health Analyst'}</b>
            <small id="role-org">{user?.organization || 'County Health Department'}</small>
          </span>
        </button>

        {roleOpen && (
          <div
            className="dropdown"
            style={{
              position: 'absolute',
              top: '52px',
              right: 0,
              width: '260px',
              borderRadius: '16px',
              background: 'var(--surface-solid)',
              border: '1px solid var(--line-strong)',
              boxShadow: 'var(--shadow)',
              padding: '12px',
              zIndex: 100
            }}
          >
            <div style={{ paddingBottom: '8px', marginBottom: '8px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                {user?.roleName || 'Public Health Analyst'}
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--cyan)', marginTop: '2px' }}>
                {user?.email || 'analyst@health.gov'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                {user?.organization || 'County Health Department'}
              </div>
            </div>

            <button
              onClick={() => {
                setRoleOpen(false);
                logout();
              }}
              className="btn sm"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                color: 'var(--rose)',
                borderColor: 'var(--rose)'
              }}
            >
              <Icon name="x" size={14} />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
