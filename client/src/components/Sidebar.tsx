'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Map as MapIcon,
  Grid,
  Scale,
  Activity,
  HeartPulse,
  Users,
  ClipboardList,
  FileText,
  Database,
  ChevronLeft,
  X
} from 'lucide-react';

const NAV_GROUPS = [
  {
    group: 'Analytics',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Health Map', href: '/health-map', icon: MapIcon },
      { name: 'Census Tracts', href: '/census-tracts', icon: Grid },
      { name: 'Health Disparities', href: '/health-disparities', icon: Scale },
      { name: 'Social Determinants', href: '/social-determinants', icon: Activity },
      { name: 'Disease Incidence', href: '/disease-incidence', icon: HeartPulse },
      { name: 'Program Utilization', href: '/program-utilization', icon: Users },
    ]
  },
  {
    group: 'Projects & Admin',
    items: [
      { name: 'Assessments', href: '/assessments', icon: ClipboardList },
      { name: 'Reports & Exports', href: '/reports', icon: FileText },
      { name: 'Data Management', href: '/data-management', icon: Database },
    ]
  }
];

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (val: boolean) => void;
  mobileMenuOpen?: boolean;
  setMobileMenuOpen?: (val: boolean) => void;
}

export function Sidebar({
  collapsed,
  setCollapsed,
  mobileMenuOpen = false,
  setMobileMenuOpen
}: SidebarProps) {
  const pathname = usePathname();

  const renderNavItems = (isMobile = false) => (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.group}>
          {(!collapsed || isMobile) && (
            <div className="text-[11px] font-bold text-[var(--faint)] uppercase tracking-wider px-3 mb-2">
              {group.group}
            </div>
          )}
          <div className="space-y-1">
            {group.items.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    if (isMobile && setMobileMenuOpen) {
                      setMobileMenuOpen(false);
                    }
                  }}
                  title={collapsed && !isMobile ? item.name : undefined}
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-[13.5px] transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-[var(--glow)] to-transparent text-[var(--text)] font-semibold border border-[var(--line-strong)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-2 bottom-2 w-1 bg-[var(--cyan)] rounded-r-full shadow-[0_0_8px_var(--cyan)]" />
                  )}
                  <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-[var(--cyan)]' : 'text-[var(--muted)]'}`} />
                  {(!collapsed || isMobile) && <span className="truncate">{item.name}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* 1. Desktop Persistent Sidebar */}
      <aside
        className={`relative z-30 hidden lg:flex flex-col border-r border-[var(--line)] bg-[var(--surface)] backdrop-blur-xl transition-all duration-300 flex-shrink-0 ${
          collapsed ? 'w-[76px]' : 'w-[252px]'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-5 h-[72px] border-b border-[var(--line)] flex-shrink-0">
          <div className="w-[34px] h-[34px] flex-shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-tr from-[var(--cyan)] to-[var(--violet)] shadow-sm">
            <MapIcon className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="flex flex-col whitespace-nowrap overflow-hidden">
              <span className="font-display text-[19px] font-bold tracking-tight text-[var(--text)]">
                Map<span className="text-[var(--cyan)]">Well</span>
              </span>
              <span className="text-[10px] tracking-wider text-[var(--faint)] font-bold uppercase">
                Community Health
              </span>
            </div>
          )}
        </div>

        {/* Navigation Items */}
        {renderNavItems(false)}

        {/* Footer Demo Card */}
        {!collapsed && (
          <div className="p-3 border-t border-[var(--line)]">
            <div className="flex gap-2.5 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] text-[12px] text-[var(--muted)]">
              <span className="text-[var(--amber)] font-bold">●</span>
              <div>
                <strong className="block text-[var(--text)] font-semibold">Live CDC/ACS Data</strong>
                <span>King County, Cook County & US Census.</span>
              </div>
            </div>
          </div>
        )}

        {/* Collapse Toggle Button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-6 w-6 h-6 rounded-full border border-[var(--line-strong)] bg-[var(--surface-solid)] shadow-md flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] transition-transform"
        >
          <ChevronLeft className={`w-3.5 h-3.5 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
        </button>
      </aside>

      {/* 2. Mobile & Tablet Off-Canvas Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Backdrop overlay */}
          <div
            onClick={() => setMobileMenuOpen?.(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            aria-hidden="true"
          />

          {/* Slide-in Menu Panel */}
          <div className="relative w-[280px] max-w-[85vw] h-full bg-[var(--surface-solid,#0c1527)] border-r border-[var(--line-strong,#1e3048)] flex flex-col shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-5 h-[68px] border-b border-[var(--line)] flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-gradient-to-tr from-[var(--cyan)] to-[var(--violet)]">
                  <MapIcon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <span className="text-[17px] font-bold text-white tracking-tight">
                    Map<span className="text-[var(--cyan)]">Well</span>
                  </span>
                  <span className="block text-[9.5px] font-bold text-[var(--faint)] uppercase tracking-wider">
                    Community Health
                  </span>
                </div>
              </div>

              <button
                onClick={() => setMobileMenuOpen?.(false)}
                aria-label="Close menu"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-white hover:bg-[var(--surface-2)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Links */}
            {renderNavItems(true)}

            {/* Mobile Footer */}
            <div className="p-3 border-t border-[var(--line)]">
              <div className="p-2.5 rounded-xl bg-[var(--surface-2)] text-[11px] text-[var(--muted)]">
                <strong className="block text-white font-semibold mb-0.5">Community Health Intel</strong>
                <span>All 10 modules unlocked & synchronized</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
