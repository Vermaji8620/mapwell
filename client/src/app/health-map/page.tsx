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
    setActiveJurisdiction,
    session,
    toggleFlagTract,
    toggleCompareTract,
    markWorkflowMilestone
  } = useSession();

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
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
    <Suspense
      fallback={
        <div
          style={{
            display: 'flex',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted)'
          }}
        >
          Loading Health Map...
        </div>
      }
    >
      <HealthMapContent />
    </Suspense>
  );
}
