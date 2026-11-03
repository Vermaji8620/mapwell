'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useAuth } from '@/context/AuthContext';
import { Icon } from './Icons';
import { useRouter } from 'next/navigation';
import { STATE_META } from '@/utils/countyRepository';

interface TopbarProps {
  onOpenMobileMenu: () => void;
}

const RANGES: Record<number, string> = {
  3: '2023 – 2025',
  5: '2021 – 2025',
  10: '2016 – 2025'
};

export function Topbar({ onOpenMobileMenu }: TopbarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const {
    activeCounty,
    setActiveJurisdiction,
    jurisdictions,
    session,
    trendYears,
    setTrendYears,
    setWorkflowDrawerOpen
  } = useSession();

  // Dropdown states
  const [jurOpen, setJurOpen] = useState(false);
  const [jurFilter, setJurFilter] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleOpen, setRoleOpen] = useState(false);

  const jurRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close popups on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (jurRef.current && !jurRef.current.contains(target)) setJurOpen(false);
      if (dateRef.current && !dateRef.current.contains(target)) setDateOpen(false);
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
      if (roleRef.current && !roleRef.current.contains(target)) setRoleOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  // Filtered counties for jurisdiction selector
  const filteredCounties = useMemo(() => {
    const q = jurFilter.toLowerCase().trim();
    if (!q) return jurisdictions.slice(0, 50);
    return jurisdictions
      .filter((c: any) => c.name.toLowerCase().includes(q) || (c.stateAbbr && c.stateAbbr.toLowerCase().includes(q)))
      .slice(0, 50);
  }, [jurisdictions, jurFilter]);

  // Global search items (screens and counties)
  const searchResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];
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

    screens.forEach((s) => {
      if (s.name.toLowerCase().includes(q)) {
        results.push({
          label: s.name,
          sub: 'Screen',
          type: 'screen',
          action: () => {
            router.push(s.href);
            setSearchOpen(false);
          }
        });
      }
    });

    jurisdictions.forEach((c: any) => {
      if (c.name.toLowerCase().includes(q) && results.length < 10) {
        results.push({
          label: `${c.name}, ${c.state || ''}`,
          sub: `${c.totalTracts || 0} census tracts`,
          type: 'county',
          action: () => {
            setActiveJurisdiction(c._id);
            setSearchOpen(false);
          }
        });
      }
    });

    return results;
  }, [searchQuery, jurisdictions, router, setActiveJurisdiction]);

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

  // Toggle theme
  const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('mapwell-theme', next);
    } catch {}
  };

  const activeCountyName = activeCounty ? `${activeCounty.name}, ${activeCounty.stateAbbr || ''}` : 'King County, WA';

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
            <b id="jur-name">{activeCountyName}</b>
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
              padding: '12px',
              borderRadius: '16px',
              background: 'var(--surface-solid)',
              border: '1px solid var(--line-strong)',
              boxShadow: 'var(--shadow)'
            }}
          >
            <div style={{ padding: '4px 6px 10px' }}>
              <b style={{ fontSize: '13px', display: 'block' }}>Active jurisdiction</b>
              <div className="note" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                Sets the default county for every screen
              </div>
            </div>
            <input
              type="text"
              className="in"
              placeholder="Filter counties…"
              value={jurFilter}
              onChange={(e) => setJurFilter(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--line-strong)',
                background: '#fff',
                fontSize: '12.5px',
                outline: 'none',
                marginBottom: '8px'
              }}
            />
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {filteredCounties.map((c: any) => (
                <button
                  key={c._id}
                  onClick={() => {
                    setActiveJurisdiction(c._id);
                    setJurOpen(false);
                  }}
                  className={`dd-item ${activeCounty?._id === c._id ? 'on' : ''}`}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '0',
                    background: activeCounty?._id === c._id ? 'var(--surface-2)' : 'transparent',
                    fontSize: '12.5px',
                    fontWeight: activeCounty?._id === c._id ? 600 : 500,
                    textAlign: 'left',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    marginBottom: '2px'
                  }}
                >
                  <span>
                    {c.name}, {c.state || ''}
                  </span>
                  <span className="pill sm">{c.totalTracts || 0} tracts</span>
                </button>
              ))}
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
          }}
          onFocus={() => setSearchOpen(true)}
        />
        <span className="kbd">/</span>

        {searchOpen && searchResults.length > 0 && (
          <div
            className="search-results show"
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
              maxHeight: '300px',
              overflowY: 'auto'
            }}
          >
            {searchResults.map((item, idx) => (
              <button
                key={idx}
                onClick={item.action}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: 0,
                  background: 'none',
                  fontSize: '13px',
                  fontWeight: 500,
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--text)'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <span>{item.label}</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: item.type === 'screen' ? 'var(--cyan)' : 'var(--muted)'
                  }}
                >
                  {item.sub}
                </span>
              </button>
            ))}
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

      {/* Guided Workflow Chip */}
      <button
        className="wf-chip"
        id="wf-chip"
        aria-label="Open guided workflow"
        onClick={() => setWorkflowDrawerOpen(true)}
      >
        <svg className="ring" viewBox="0 0 28 28" width="28" height="28" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="14" cy="14" r="11" fill="none" stroke="var(--line)" strokeWidth="3" />
          <circle
            cx="14"
            cy="14"
            r="11"
            fill="none"
            stroke="var(--teal)"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </svg>
        <span className="t">
          <b>Workflow</b>
          <small>{wfCount}/10</small>
        </span>
      </button>

      {/* Theme Toggle Button */}
      <button
        className="icon-btn"
        id="theme-btn"
        aria-label="Toggle theme"
        onClick={toggleTheme}
      >
        <Icon name="sun" size={17} />
      </button>

      {/* Notification Bell */}
      <button className="icon-btn hide-m" id="bell" aria-label="Notifications">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />
        </svg>
        <span className="badge" />
      </button>

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
