'use client';

import React, { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import gsap from 'gsap';
import { Backdrop } from '@/components/Backdrop';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { WorkflowDrawer } from '@/components/WorkflowDrawer';
import { SessionProvider } from '@/context/SessionContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { animateViewExit, animateViewEntrance } from '@/utils/transitions';

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
  const isTransitioningRef = useRef(false);
  const animatedKeyRef = useRef<string>('');

  // Centralized two-phase transition trigger matching prototype function go / swap / enter
  const triggerTwoPhaseTransition = (targetHref?: string) => {
    if (isLoginPage || loading || !user) {
      if (targetHref && targetHref !== pathname) {
        router.push(targetHref);
      }
      return;
    }

    const view = document.getElementById('view');
    if (!view) {
      if (targetHref && targetHref !== pathname) {
        router.push(targetHref);
      }
      setNavCount((prev) => prev + 1);
      return;
    }

    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;

    // Phase 1 (Exit with Delay): 200ms upward lift and fade out (opacity: 0, y: -8)
    animateViewExit(view, () => {
      // Phase 2 (Content Swap): update route state & reset scroll position
      view.scrollTop = 0;
      if (targetHref) {
        router.push(targetHref);
        // If navigating to the same base pathname (e.g. with query params or re-click),
        // increment navCount so the key changes and the view re-renders with entrance
        if (targetHref.split('?')[0] === pathname) {
          setNavCount((prev) => prev + 1);
        }
      } else {
        setNavCount((prev) => prev + 1);
      }
    });
  };

  useEffect(() => {
    const handleNavEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ href?: string }>;
      triggerTwoPhaseTransition(customEvent.detail?.href);
    };

    window.addEventListener('mapwell:navigate', handleNavEvent);
    window.addEventListener('mapwell:refresh-overview', handleNavEvent);
    return () => {
      window.removeEventListener('mapwell:navigate', handleNavEvent);
      window.removeEventListener('mapwell:refresh-overview', handleNavEvent);
    };
  }, [pathname, isLoginPage, loading, user, router]);

  // Phase 3 (Staggered Bloom): Animate blocks into view on mount or route/navCount change
  useEffect(() => {
    if (isLoginPage || loading || !user) return;
    const view = document.getElementById('view');
    if (!view) return;

    const navKey = `${pathname}-${navCount}`;
    if (animatedKeyRef.current === navKey) return;
    animatedKeyRef.current = navKey;

    const tl = animateViewEntrance(view);
    isTransitioningRef.current = false;

    return () => {
      tl?.kill();
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
    <>
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
      </div>
      <div id="modal-root" />
      <div id="toasts" aria-live="polite" />
      <div id="tooltip" role="tooltip" />
    </>
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
