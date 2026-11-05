'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import gsap from 'gsap';
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

  // Global page transition / reload counter for all pages
  const [navCount, setNavCount] = useState(0);

  useEffect(() => {
    const handleNavRefresh = () => {
      setNavCount((prev) => prev + 1);
    };
    window.addEventListener('mapwell:navigate', handleNavRefresh);
    window.addEventListener('mapwell:refresh-overview', handleNavRefresh);
    return () => {
      window.removeEventListener('mapwell:navigate', handleNavRefresh);
      window.removeEventListener('mapwell:refresh-overview', handleNavRefresh);
    };
  }, []);

  // Authentic MapWell GSAP page entrance animation matching prototype lines 1692-1701
  useEffect(() => {
    if (isLoginPage || loading || !user) return;
    const view = document.getElementById('view');
    if (!view) return;

    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });

    const blocks = view.querySelectorAll<HTMLElement>(
      ':scope > .page-head, :scope > div > .page-head, :scope > .panel, :scope > .tabs, :scope > .toolbar, :scope > .strip > *, :scope > .grid > *, :scope > .dgrid > *, :scope > div > .strip > *, :scope > div > .grid > *, :scope > div > .dgrid > *'
    );
    if (blocks.length > 0) {
      const list = Array.from(blocks).slice(0, 24);
      tl.fromTo(
        list,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.7, stagger: 0.04, ease: 'power3.out', clearProps: 'opacity,transform' },
        0.04
      );
    }

    const floats = view.querySelectorAll<HTMLElement>('.hm .map-float, .map-float');
    if (floats.length > 0) {
      tl.fromTo(
        Array.from(floats),
        { opacity: 0, x: (_: any, el: HTMLElement) => (el.getBoundingClientRect().left < window.innerWidth / 2 ? -18 : 18) },
        { opacity: 1, x: 0, duration: 0.8, stagger: 0.05, clearProps: 'opacity,transform' },
        0.15
      );
    }

    return () => {
      tl.kill();
    };
  }, [pathname, navCount, isLoginPage, loading, user]);

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
          <main
            id="view"
            key={`${pathname}-${navCount}`}
            className={isFlush ? 'flush' : ''}
            tabIndex={-1}
          >
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
