'use client';

import React, { useState } from 'react';
import { Backdrop } from '@/components/Backdrop';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { WorkflowDrawer } from '@/components/WorkflowDrawer';
import { SessionProvider } from '@/context/SessionContext';

export function ShellLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <SessionProvider>
      <div className="relative flex h-screen w-screen overflow-hidden bg-[var(--bg)]">
        <Backdrop />
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
        <div className="flex-1 flex flex-col min-w-0 h-full relative z-10 overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 relative focus:outline-none">
            {children}
          </main>
        </div>
        {/* Full-viewport Workflow Drawer mounted at root level, free from header container traps */}
        <WorkflowDrawer />
      </div>
    </SessionProvider>
  );
}
