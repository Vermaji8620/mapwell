'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icons';

export const ROUTES = [
  {
    group: 'Overview',
    items: [{ href: '/', label: 'Overview', icon: 'dashboard' }]
  },
  {
    group: 'Explore',
    items: [
      { href: '/health-map', label: 'Health map', icon: 'map' },
      { href: '/census-tracts', label: 'Census tracts', icon: 'grid' }
    ]
  },
  {
    group: 'Analyze',
    items: [
      { href: '/health-disparities', label: 'Health disparities', icon: 'scale' },
      { href: '/social-determinants', label: 'Social determinants', icon: 'home' },
      { href: '/disease-incidence', label: 'Disease incidence', icon: 'activity' },
      { href: '/program-utilization', label: 'Program utilization', icon: 'users' }
    ]
  },
  {
    group: 'Act',
    items: [
      { href: '/assessments', label: 'Needs assessments', icon: 'clipboard' },
      { href: '/reports', label: 'Reports & exports', icon: 'file' }
    ]
  },
  {
    group: 'Administer',
    items: [
      { href: '/data-management', label: 'Data management', icon: 'database' }
    ]
  }
];

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (fn: (prev: boolean) => boolean) => void;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, setCollapsed, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [indicatorTop, setIndicatorTop] = useState<number | null>(null);

  // Position the floating indicator behind the active route item
  useEffect(() => {
    if (!navRef.current) return;
    const activeLink = navRef.current.querySelector<HTMLAnchorElement>(`a[data-active="true"]`);
    if (activeLink) {
      setIndicatorTop(activeLink.offsetTop);
    }
  }, [pathname, collapsed]);

  return (
    <aside id="sidebar" aria-label="Main navigation">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
          <defs>
            <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#38E1FF" />
              <stop offset="1" stopColor="#9A85FF" />
            </linearGradient>
          </defs>
          <path
            d="M20 3c-8 0-14 6-14 13.6C6 26 20 37 20 37s14-11 14-20.4C34 9 28 3 20 3z"
            fill="none"
            stroke="url(#bm)"
            strokeWidth="2.4"
          />
          <path
            d="M12.5 17.5c2-4.5 5-6 7.5-6s5.6 1.6 7.5 6"
            fill="none"
            stroke="url(#bm)"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity=".75"
          />
          <path
            d="M15.5 20.5c1.3-2.6 2.8-3.4 4.5-3.4s3.2.8 4.5 3.4"
            fill="none"
            stroke="url(#bm)"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity=".55"
          />
          <circle cx="20" cy="23.5" r="2.2" fill="#38E1FF" />
        </svg>
        <span>
          <span className="brand-name">
            Map<b>Well</b>
          </span>
          <span className="brand-sub">COMMUNITY HEALTH MAPPING</span>
        </span>
      </div>

      <nav className="nav" id="nav" ref={navRef} style={{ position: 'relative' }}>
        {indicatorTop !== null && (
          <div
            id="nav-indicator"
            style={{
              top: `${indicatorTop}px`,
              transition: 'top 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          />
        )}
        {ROUTES.map((group) => (
          <React.Fragment key={group.group}>
            <div className="nav-group-label">{group.group}</div>
            {group.items.map((item) => {
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname === item.href || pathname.startsWith(item.href + '/');

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  data-active={isActive}
                  title={item.label}
                  onClick={() => {
                    onCloseMobile();
                    // Only dispatch reload if already on the active page
                    if (isActive) {
                      window.dispatchEvent(new CustomEvent('mapwell:navigate'));
                    }
                  }}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      <div className="side-foot">
        <div className="demo-card">
          <span style={{ color: 'var(--amber)', flex: 'none' }}>●</span>
          <span className="txt">
            <strong>Demo environment</strong>Real county boundaries. Indicators and tracts are synthetic.
          </span>
        </div>
      </div>

      <button
        className="collapse-btn"
        id="collapse"
        aria-label="Collapse sidebar"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="m15 6-6 6 6 6" />
        </svg>
      </button>
    </aside>
  );
}
