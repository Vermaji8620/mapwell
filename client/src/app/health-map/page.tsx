'use client';

import React, { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/context/SessionContext';
import { HealthMapCanvas } from '@/components/HealthMapCanvas';

function HealthMapContent() {
  const searchParams = useSearchParams();
  const urlCounty = searchParams.get('county');
  const urlTract = searchParams.get('tract');
  const urlLayer = searchParams.get('layer');
  const urlMetric = searchParams.get('metric');

  const {
    activeCounty,
    setActiveJurisdiction,
    session,
    toggleFlagTract,
    toggleCompareTract,
    markWorkflowMilestone
  } = useSession();

  // Workflow milestone 'map' matching prototype line 1939: wf('map');
  useEffect(() => {
    markWorkflowMilestone('map');
  }, [markWorkflowMilestone]);

  // Auto-collapse sidebar on mount if screen > 860px, restore on leave (prototype lines 1940-1941, 2059)
  useEffect(() => {
    const app = document.getElementById('app');
    const wasCollapsed = app?.classList.contains('collapsed');
    if (window.innerWidth > 860 && !wasCollapsed) {
      app?.classList.add('collapsed');
    }
    return () => {
      if (!wasCollapsed) {
        app?.classList.remove('collapsed');
      }
    };
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <HealthMapCanvas
        initialCountyId={urlCounty || undefined}
        initialTractId={urlTract || undefined}
        initialLayerId={urlLayer || 'disease'}
        initialMetric={urlMetric || 'incidence'}
        jurisdictionCountyId={activeCounty?._id || undefined}
        onCountySelect={(county) => {
          setActiveJurisdiction(county.id);
          markWorkflowMilestone('region');
        }}
        onTractSelect={() => {
          markWorkflowMilestone('tract');
        }}
        onLayerSelect={() => {
          markWorkflowMilestone('layer');
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
