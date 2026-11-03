'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Backdrop } from '@/components/Backdrop';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { WorkflowDrawer } from '@/components/WorkflowDrawer';
import { SessionProvider } from '@/context/SessionContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';

function InnerShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  const isLoginPage = pathname === '/login';
  const isFlush = pathname === '/health-map';

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Auth redirect
  useEffect(() => {
    if (!loading && !user && !isLoginPage) {
      router.replace('/login');
    }
  }, [loading, user, isLoginPage, router]);

  // If on login page, render clean login view
  if (isLoginPage) {
    return <main style={{ minHeight: '100vh', width: '100%' }}>{children}</main>;
  }

  // Show loading indicator while session state is being verified
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          width: '100vw',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--text)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: '3px solid rgba(0, 144, 194, 0.2)',
              borderTopColor: 'var(--cyan)',
              animation: 'lgspin 0.8s linear infinite'
            }}
          />
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)' }}>
            Loading MapWell workspace...
          </div>
        </div>
      </div>
    );
  }

  // If not authenticated and redirecting
  if (!user) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          width: '100vw',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--text)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: '3px solid rgba(0, 144, 194, 0.2)',
              borderTopColor: 'var(--cyan)',
              animation: 'lgspin 0.8s linear infinite'
            }}
          />
          <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>Redirecting to sign in...</div>
        </div>
      </div>
    );
  }

  return (
    <div
      id="app"
      className={`${collapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}
    >
      <Backdrop />
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />
      <div id="scrim-side" onClick={() => setMobileMenuOpen(false)} />
      <div id="main">
        <Topbar onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <div id="view-wrap">
          <div id="scanline" />
          <main id="view" className={isFlush ? 'flush' : ''} tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <WorkflowDrawer />
      <div id="modal-root" />
      <div id="toasts" aria-live="polite" />
      <div id="tooltip" role="tooltip" />
    </div>
  );
}

export function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SessionProvider>
        <InnerShell>{children}</InnerShell>
      </SessionProvider>
    </AuthProvider>
  );
}
