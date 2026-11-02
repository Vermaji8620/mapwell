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
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  const isLoginPage = pathname === '/login';

  useEffect(() => {
    if (!loading && !user && !isLoginPage) {
      router.replace('/login');
    }
  }, [loading, user, isLoginPage, router]);

  // If on login page, render clean page without dashboard shell
  if (isLoginPage) {
    return <main className="min-h-screen w-full bg-[var(--bg,#0a1324)]">{children}</main>;
  }

  // Show loading indicator while session state is being verified
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg,#0a1324)] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
          <div className="text-[13px] font-semibold text-[var(--muted,#94a3b8)]">
            Authenticating MapWell session...
          </div>
        </div>
      </div>
    );
  }

  // If not authenticated and not on login page, show transition screen while redirecting
  if (!user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg,#0a1324)] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
          <div className="text-[13px] text-[var(--muted,#94a3b8)]">Redirecting to sign in...</div>
        </div>
      </div>
    );
  }

  // User is authenticated: render complete MapWell analytics shell
  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[var(--bg)]">
      <Backdrop />
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="flex-1 flex flex-col min-w-0 h-full relative z-10 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 relative z-0 focus:outline-none">
          {children}
        </main>
      </div>
      {/* Full-viewport Workflow Drawer mounted at root level, free from header container traps */}
      <WorkflowDrawer />
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
