'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useSession } from '@/context/SessionContext';
import {
  MapPin,
  Search,
  Calendar,
  Sun,
  Moon,
  ChevronDown
} from 'lucide-react';
import Link from 'next/link';

export function Topbar() {
  const {
    session,
    jurisdictions,
    activeCounty,
    setActiveJurisdiction,
    theme,
    setTheme,
    trendYears,
    setTrendYears,
    setWorkflowDrawerOpen
  } = useSession();

  const [jurOpen, setJurOpen] = useState(false);
  const [jurSearch, setJurSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResultsOpen, setSearchResultsOpen] = useState(false);

  const jurRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (jurRef.current && !jurRef.current.contains(e.target as Node)) {
        setJurOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const completedStepsCount = Object.keys(session?.workflowMilestones || {}).filter(
    k => session?.workflowMilestones?.[k]
  ).length;

  const filteredJurisdictions = jurisdictions.filter((j) =>
    `${j.name} ${j.stateName} ${j.stateAbbr}`.toLowerCase().includes(jurSearch.toLowerCase())
  );

  return (
    <header className="h-[72px] flex-shrink-0 flex items-center justify-between gap-4 px-6 border-b border-[var(--line)] bg-[var(--surface)] backdrop-blur-xl relative z-20">
      {/* Jurisdiction Selector */}
      <div className="relative" ref={jurRef}>
        <button
          onClick={() => setJurOpen(!jurOpen)}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--line-strong)] transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[var(--cyan)] to-[var(--violet)] flex items-center justify-center text-white flex-shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="flex flex-col text-left leading-tight">
            <span className="text-[10px] font-bold text-[var(--faint)] uppercase">Jurisdiction</span>
            <span className="text-[13px] font-bold text-[var(--text)] truncate max-w-[170px]">
              {activeCounty?.name || 'King County'}, {activeCounty?.stateAbbr || 'WA'}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-[var(--faint)]" />
        </button>

        {jurOpen && (
          <div className="absolute top-[52px] left-0 w-72 rounded-2xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95">
            <div className="p-2">
              <span className="block text-[12px] font-bold text-[var(--text)]">Active Jurisdiction</span>
              <span className="block text-[11px] text-[var(--faint)]">Sets analysis defaults across all 10 screens</span>
            </div>
            <div className="px-2 pb-2">
              <input
                type="text"
                placeholder="Search counties or states..."
                value={jurSearch}
                onChange={(e) => setJurSearch(e.target.value)}
                className="w-full h-8 px-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[12px] outline-none focus:border-[var(--cyan)]"
                autoFocus
              />
            </div>
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {filteredJurisdictions.map((j) => (
                <button
                  key={j._id}
                  onClick={() => {
                    setActiveJurisdiction(j._id);
                    setJurOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-[12.5px] transition-colors ${
                    j._id === activeCounty?._id
                      ? 'bg-[var(--glow)] text-[var(--cyan)] font-bold'
                      : 'hover:bg-[var(--surface-2)] text-[var(--text)]'
                  }`}
                >
                  <span>{j.name}, {j.stateAbbr}</span>
                  <span className="text-[11px] text-[var(--faint)] num">
                    {j.population ? `${(j.population / 1000).toFixed(0)}k` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Global Search Bar */}
      <div className="flex-1 max-w-md relative hidden sm:block">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-[var(--faint)] absolute left-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search counties, 11-digit tracts or screens..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchResultsOpen(e.target.value.length >= 2);
            }}
            onBlur={() => setTimeout(() => setSearchResultsOpen(false), 200)}
            className="w-full h-10 pl-9 pr-8 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[13px] text-[var(--text)] outline-none focus:border-[var(--cyan)] focus:ring-2 focus:ring-[var(--glow)] transition-all"
          />
          <kbd className="absolute right-3 text-[10px] font-bold text-[var(--faint)] px-1.5 py-0.5 rounded border border-[var(--line)] bg-[var(--surface-solid)]">
            /
          </kbd>
        </div>

        {/* Global search quick dropdown */}
        {searchResultsOpen && (
          <div className="absolute top-12 left-0 right-0 rounded-2xl bg-[var(--surface-solid)] border border-[var(--line-strong)] shadow-2xl p-2 z-50">
            <div className="p-2 text-[11px] font-bold text-[var(--faint)] uppercase">Quick Navigation</div>
            <Link
              href="/health-map"
              className="flex items-center justify-between p-2 rounded-lg text-[13px] hover:bg-[var(--surface-2)] text-[var(--text)]"
            >
              <span>Interactive Health Map</span>
              <span className="text-[11px] text-[var(--cyan)]">Screen</span>
            </Link>
            <Link
              href="/census-tracts"
              className="flex items-center justify-between p-2 rounded-lg text-[13px] hover:bg-[var(--surface-2)] text-[var(--text)]"
            >
              <span>Census Tracts Explorer</span>
              <span className="text-[11px] text-[var(--cyan)]">Screen</span>
            </Link>
            <Link
              href="/health-disparities"
              className="flex items-center justify-between p-2 rounded-lg text-[13px] hover:bg-[var(--surface-2)] text-[var(--text)]"
            >
              <span>Health Disparity Analysis</span>
              <span className="text-[11px] text-[var(--cyan)]">Screen</span>
            </Link>
          </div>
        )}
      </div>

      {/* Action Controls & Analyst Profile */}
      <div className="flex items-center gap-3">
        {/* Trend Window Selector */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[12px] font-semibold text-[var(--muted)]">
          <Calendar className="w-3.5 h-3.5 text-[var(--faint)]" />
          <select
            value={trendYears}
            onChange={(e) => setTrendYears(Number(e.target.value))}
            className="bg-transparent outline-none cursor-pointer text-[var(--text)] font-bold"
          >
            <option value={10}>10 Years (2016 - 2026)</option>
            <option value={5}>5 Years (2021 - 2026)</option>
            <option value={3}>3 Years (2023 - 2026)</option>
          </select>
        </div>

        {/* Guided Workflow Chip */}
        <button
          onClick={() => setWorkflowDrawerOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--cyan)] transition-colors text-[12px] font-bold text-[var(--cyan)]"
        >
          <div className="w-4 h-4 rounded-full border-2 border-[var(--teal)] flex items-center justify-center text-[9px]">
            {completedStepsCount}
          </div>
          <span>Workflow {completedStepsCount}/10</span>
        </button>

        {/* Dark/Light Theme Toggle */}
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          aria-label="Toggle theme"
          className="w-9 h-9 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] transition-colors"
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>

        {/* Public Health Analyst Role Tag */}
        <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-[var(--line)]">
          <div className="w-8 h-8 rounded-full bg-[var(--glow)] border border-[var(--cyan)] flex items-center justify-center font-bold text-[11px] text-[var(--cyan)]">
            PA
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[12px] font-bold text-[var(--text)]">Public Health Analyst</span>
            <span className="text-[10px] text-[var(--faint)]">County Health Dept</span>
          </div>
        </div>
      </div>
    </header>
  );
}
