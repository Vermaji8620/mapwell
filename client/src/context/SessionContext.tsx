'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserSession, Jurisdiction, CountyFips, TractGeoid } from '@/types';
import { getCountyRepository } from '@/utils/countyRepository';

interface SessionContextType {
  session: UserSession | null;
  jurisdictions: Jurisdiction[];
  activeCounty: Jurisdiction | null;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  setActiveJurisdiction: (fips: CountyFips) => Promise<void>;
  toggleFlagTract: (geoid: TractGeoid) => Promise<void>;
  toggleCompareTract: (geoid: TractGeoid) => Promise<void>;
  clearCompareTracts: () => Promise<void>;
  markWorkflowMilestone: (milestoneId: string) => Promise<void>;
  resetWorkflow: () => Promise<void>;
  workflowDrawerOpen: boolean;
  setWorkflowDrawerOpen: (open: boolean) => void;
  trendYears: number;
  setTrendYears: (years: number) => void;
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('mapwell-theme');
        if (stored === 'dark' || stored === 'light') return stored;
      } catch {}
    }
    return 'light';
  });
  const [trendYears, setTrendYearsState] = useState<number>(10);
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState<boolean>(false);
  const [repo, setRepo] = useState<any>(null);

  useEffect(() => {
    getCountyRepository().then(r => setRepo(r)).catch(() => {});
  }, []);

  // Load session and jurisdictions on mount
  const refreshSession = async () => {
    try {
      const [sessionRes, jurRes] = await Promise.all([
        fetch('/api/session').then(r => r.ok ? r.json() : null),
        fetch('/api/jurisdictions').then(r => r.ok ? r.json() : { data: [] })
      ]);

      if (sessionRes) {
        setSession(sessionRes);
        let effectiveTheme: 'light' | 'dark' = 'light';
        if (typeof window !== 'undefined') {
          try {
            const saved = localStorage.getItem('mapwell-theme');
            if (saved === 'dark' || saved === 'light') {
              effectiveTheme = saved;
            } else if (sessionRes.theme === 'dark' || sessionRes.theme === 'light') {
              effectiveTheme = sessionRes.theme;
              localStorage.setItem('mapwell-theme', sessionRes.theme);
            }
          } catch {}
        }
        setThemeState(effectiveTheme);
        setTrendYearsState(sessionRes.trendWindowYears || 10);
        document.documentElement.setAttribute('data-theme', effectiveTheme);

        if (sessionRes.theme !== effectiveTheme) {
          fetch('/api/session', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: effectiveTheme })
          }).catch(() => {});
        }
      }
      if (jurRes?.data) {
        setJurisdictions(jurRes.data);
      }
    } catch (err) {
      console.error('[Session Error]: Failed to fetch session/jurisdictions', err);
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  const setTheme = async (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('mapwell-theme', newTheme);
      } catch {}
    }
    try {
      await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: newTheme })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const setTrendYears = async (years: number) => {
    setTrendYearsState(years);
    try {
      await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trendWindowYears: years })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const setActiveJurisdiction = async (fips: CountyFips) => {
    // Optimistic update so UI and page reload transition trigger instantaneously
    setSession(prev => prev ? { ...prev, activeJurisdiction: fips } : ({ activeJurisdiction: fips } as any));
    try {
      const res = await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeJurisdiction: fips })
      });
      if (res.ok) {
        const updated = await res.json();
        setSession(prev => ({ ...(prev || {}), ...updated, activeJurisdiction: fips }));
        await markWorkflowMilestone('region');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleFlagTract = async (geoid: TractGeoid) => {
    try {
      const current = session?.flaggedTracts || [];
      const updated = current.includes(geoid)
        ? current.filter(id => id !== geoid)
        : [...current, geoid];

      // Update both session and tract directly in DB
      await Promise.all([
        fetch('/api/session', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flaggedTracts: updated })
        }),
        fetch(`/api/tracts/${geoid}/flag`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flagged: !current.includes(geoid) })
        })
      ]);

      setSession(prev => prev ? { ...prev, flaggedTracts: updated } : null);
      await markWorkflowMilestone('flag');
    } catch (e) {
      console.error(e);
    }
  };

  const toggleCompareTract = async (geoid: TractGeoid) => {
    try {
      const current = session?.compareTracts || [];
      let updated: TractGeoid[];
      if (current.includes(geoid)) {
        updated = current.filter(id => id !== geoid);
      } else {
        updated = current.length >= 4 ? [...current.slice(1), geoid] : [...current, geoid];
      }

      // Optimistic update so checkboxes and comparison tray respond immediately
      setSession(prev => prev ? { ...prev, compareTracts: updated } : null);

      const res = await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compareTracts: updated })
      });
      if (res.ok) {
        const updatedSession = await res.json();
        setSession(updatedSession);
        if (updated.length >= 2) {
          await markWorkflowMilestone('compare');
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const clearCompareTracts = async () => {
    try {
      setSession(prev => prev ? { ...prev, compareTracts: [] } : null);
      const res = await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compareTracts: [] })
      });
      if (res.ok) {
        const updatedSession = await res.json();
        setSession(updatedSession);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const markWorkflowMilestone = async (milestoneId: string) => {
    try {
      const current = session?.workflowMilestones || {};
      if (current[milestoneId]) return;

      const updated = { ...current, [milestoneId]: true };
      const res = await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowMilestones: updated })
      });
      if (res.ok) {
        const updatedSession = await res.json();
        setSession(updatedSession);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const resetWorkflow = async () => {
    try {
      const res = await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowMilestones: {}, compareTracts: [], flaggedTracts: [] })
      });
      if (res.ok) {
        const updatedSession = await res.json();
        setSession(updatedSession);
        setWorkflowDrawerOpen(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const activeCounty = React.useMemo(() => {
    const fips = session?.activeJurisdiction;
    if (fips && repo?.countyById?.has(fips)) {
      const c = repo.countyById.get(fips);
      return {
        _id: c.id,
        id: c.id,
        name: c.name,
        stateFips: c.st,
        stateName: c.stateName,
        stateAbbr: c.stateAbbr,
        region: c.region,
        population: c.pop,
        svi: c.svi,
        indicators: c.indicators,
        totalTracts: c.totalTracts || Math.round((c.pop || 80000) / 4000)
      } as any;
    }

    if (fips) {
      const dbMatch = jurisdictions.find((j: any) => j._id === fips || j.id === fips);
      if (dbMatch) return dbMatch;
    }

    // Default to King County (53033) if available in repo
    if (repo?.countyById?.has('53033')) {
      const c = repo.countyById.get('53033');
      return {
        _id: c.id,
        id: c.id,
        name: c.name,
        stateFips: c.st,
        stateName: c.stateName,
        stateAbbr: c.stateAbbr,
        region: c.region,
        population: c.pop,
        svi: c.svi,
        indicators: c.indicators,
        totalTracts: c.totalTracts || 398
      } as any;
    }

    // Default static King County while repository loads
    if (!jurisdictions.length || session?.activeJurisdiction === '53033') {
      return {
        _id: '53033',
        id: '53033',
        name: 'King County',
        stateFips: '53',
        stateName: 'Washington',
        stateAbbr: 'WA',
        region: 'West',
        population: 2260000,
        svi: 0.38,
        totalTracts: 398
      } as any;
    }

    return jurisdictions[0] || null;
  }, [session?.activeJurisdiction, repo, jurisdictions]);

  return (
    <SessionContext.Provider
      value={{
        session,
        jurisdictions,
        activeCounty,
        theme,
        setTheme,
        setActiveJurisdiction,
        toggleFlagTract,
        toggleCompareTract,
        clearCompareTracts,
        markWorkflowMilestone,
        resetWorkflow,
        workflowDrawerOpen,
        setWorkflowDrawerOpen,
        trendYears,
        setTrendYears,
        refreshSession
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
