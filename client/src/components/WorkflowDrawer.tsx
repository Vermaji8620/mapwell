'use client';

import React, { useEffect } from 'react';
import { useSession } from '@/context/SessionContext';
import { WORKFLOW_STEPS } from '@/config/metrics';
import { Check, X, RotateCcw, ArrowRight } from 'lucide-react';
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

  if (!workflowDrawerOpen) return null;

  const milestones = session?.workflowMilestones || {};
  const completedCount = Object.keys(milestones).filter(k => milestones[k]).length;
  const nextPendingIdx = WORKFLOW_STEPS.findIndex(step => !milestones[step.id]);

  return (
    <div className="fixed inset-0 z-[150] flex justify-end">
      {/* Dimmed backdrop scrim */}
      <div
        onClick={() => setWorkflowDrawerOpen(false)}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        aria-hidden="true"
      />

      {/* Drawer Container (100% viewport height, fixed at right, cannot be cut off) */}
      <div
        role="dialog"
        aria-label="Guided workflow"
        className="relative w-full max-w-[420px] h-screen max-h-screen bg-[var(--surface-solid)] border-l border-[var(--line-strong)] shadow-2xl flex flex-col z-[151] animate-in slide-in-from-right duration-300"
      >
        {/* Drawer Header (Fixed at top) */}
        <div className="p-4 sm:p-6 border-b border-[var(--line)] flex items-start justify-between gap-3 flex-shrink-0 bg-[var(--surface-solid)]">
          <div>
            <h3 className="text-lg font-bold text-[var(--text)] tracking-tight">
              Guided Analysis Workflow
            </h3>
            <p className="text-[12px] text-[var(--muted)] mt-1">
              From a region on the map to an exported report. Steps complete as you work.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--teal)] to-[var(--cyan)] transition-all duration-500 rounded-full"
                  style={{ width: `${(completedCount / WORKFLOW_STEPS.length) * 100}%` }}
                />
              </div>
              <span className="text-[11px] font-bold text-[var(--cyan)] num">
                {completedCount} / {WORKFLOW_STEPS.length}
              </span>
            </div>
          </div>
          <button
            onClick={() => setWorkflowDrawerOpen(false)}
            aria-label="Close workflow drawer"
            className="w-8 h-8 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)] transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Workflow Steps */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-3.5">
          {WORKFLOW_STEPS.map((step, idx) => {
            const isDone = !!milestones[step.id];
            const isNext = idx === nextPendingIdx;

            return (
              <div
                key={step.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  isDone
                    ? 'border-[var(--teal)]/40 bg-[var(--teal)]/5'
                    : isNext
                    ? 'border-[var(--cyan)] bg-[var(--cyan)]/5 shadow-sm ring-1 ring-[var(--cyan)]/20'
                    : 'border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--line-strong)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0">
                    {isDone ? (
                      <div className="w-5 h-5 rounded-full bg-[var(--teal)] text-white flex items-center justify-center shadow-xs">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : (
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold ${
                          isNext
                            ? 'border-[var(--cyan)] bg-[var(--cyan)] text-white'
                            : 'border-[var(--faint)] text-[var(--muted)]'
                        }`}
                      >
                        {idx + 1}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[13px] font-bold truncate ${isDone ? 'text-[var(--text)]' : 'text-[var(--text)]'}`}>
                        {step.title}
                      </span>
                      {!isDone && (
                        <Link
                          href={step.route}
                          onClick={() => {
                            markWorkflowMilestone(step.id);
                            setWorkflowDrawerOpen(false);
                          }}
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md flex items-center gap-1 transition-all ${
                            isNext
                              ? 'bg-[var(--cyan)] text-white hover:opacity-90 shadow-xs'
                              : 'bg-[var(--surface-solid)] border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface)]'
                          }`}
                        >
                          <span>Go</span>
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                    <p className="text-[11.5px] text-[var(--muted)] mt-1 leading-snug">
                      {step.desc}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Reset Workflow button */}
          <div className="pt-4 border-t border-[var(--line)]">
            <button
              onClick={resetWorkflow}
              className="w-full py-2.5 px-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:bg-[var(--surface-solid)] text-[12px] font-bold text-[var(--muted)] hover:text-[var(--text)] flex items-center justify-center gap-2 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset workflow and demo data</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
