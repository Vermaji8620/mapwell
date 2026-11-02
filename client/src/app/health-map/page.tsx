'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/context/SessionContext';
import { HealthMapCanvas } from '@/components/HealthMapCanvas';

function HealthMapContent() {
  const searchParams = useSearchParams();
  const urlCounty = searchParams.get('county');
  const urlTract = searchParams.get('tract');

  const {
    activeCounty,
    setActiveJurisdiction,
    session,
    toggleFlagTract,
    toggleCompareTract,
    markWorkflowMilestone
  } = useSession();

  return (
    <div className="w-full h-full animate-in fade-in duration-300">
      <HealthMapCanvas
        initialCountyId={urlCounty || undefined}
        initialTractId={urlTract || undefined}
        onCountySelect={(county) => {
          setActiveJurisdiction(county.id);
          markWorkflowMilestone('region');
        }}
        onTractSelect={() => {
          markWorkflowMilestone('tract');
        }}
        compareTractIds={session?.compareTracts || []}
        flaggedTractIds={session?.flaggedTracts || []}
        onToggleCompare={(tid) => toggleCompareTract(tid)}
        onToggleFlag={(tid) => toggleFlagTract(tid)}
      />
    </div>
  );
}

export default function HealthMapPage() {
  return (
    <Suspense fallback={<div className="h-[calc(100vh-100px)] flex items-center justify-center text-[var(--muted)]">Loading Health Map...</div>}>
      <HealthMapContent />
    </Suspense>
  );
}
