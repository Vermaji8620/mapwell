'use client';

import React, { useEffect } from 'react';
import { useSession } from '@/context/SessionContext';
import { WORKFLOW_STEPS } from '@/config/metrics';
import { Icon } from './Icons';
import Link from 'next/link';

export function WorkflowDrawer() {
  const { session, workflowDrawerOpen, setWorkflowDrawerOpen, markWorkflowMilestone, resetWorkflow } = useSession();

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && workflowDrawerOpen) {
        setWorkflowDrawerOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workflowDrawerOpen, setWorkflowDrawerOpen]);

  const milestones = session?.workflowMilestones || {};
  const completedCount = Object.keys(milestones).filter((k) => milestones[k]).length;
  const nextPendingIdx = WORKFLOW_STEPS.findIndex((step) => !milestones[step.id]);

  return (
    <>
      {workflowDrawerOpen && (
        <div
          onClick={() => setWorkflowDrawerOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 139,
            background: 'rgba(11,20,56,0.35)',
            backdropFilter: 'blur(3px)'
          }}
          aria-hidden="true"
        />
      )}
      <div
        id="drawer"
        className={workflowDrawerOpen ? 'open' : ''}
        role="dialog"
        aria-label="Guided workflow"
      >
        <div className="dh">
          <div>
            <h3>Guided Analysis Workflow</h3>
            <p>From a region on the map to an exported report. Steps complete as you work.</p>
            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  flex: 1,
                  height: '6px',
                  background: 'var(--surface-2)',
                  borderRadius: '3px',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: 'var(--teal)',
                    width: `${(completedCount / WORKFLOW_STEPS.length) * 100}%`,
                    transition: 'width 0.4s ease'
                  }}
                />
              </div>
              <span className="num" style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--cyan)' }}>
                {completedCount} / {WORKFLOW_STEPS.length}
              </span>
            </div>
          </div>
          <button
            className="icon-btn"
            aria-label="Close drawer"
            onClick={() => setWorkflowDrawerOpen(false)}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="db">
          {WORKFLOW_STEPS.map((step, idx) => {
            const isDone = !!milestones[step.id];
            const isCur = idx === nextPendingIdx;

            return (
              <div
                key={step.id}
                className={`wf-step ${isDone ? 'done' : isCur ? 'cur' : ''}`}
              >
                <span className="n">{isDone ? <Icon name="check" size={14} /> : idx + 1}</span>
                <div className="t">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b>{step.title}</b>
                    {!isDone && (
                      <Link
                        href={step.route}
                        onClick={() => {
                          markWorkflowMilestone(step.id);
                          setWorkflowDrawerOpen(false);
                        }}
                        className="btn sm"
                        style={{ padding: '2px 8px', fontSize: '11px', height: '24px' }}
                      >
                        <span>Go</span>
                      </Link>
                    )}
                  </div>
                  <small>{step.desc}</small>
                </div>
              </div>
            );
          })}

          <div style={{ paddingTop: '16px', marginTop: '16px', borderTop: '1px solid var(--line)' }}>
            <button
              onClick={resetWorkflow}
              className="btn sm"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <Icon name="refresh" size={14} />
              <span>Reset workflow and demo data</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
