/**
 * MissionControl — the command composer and human-control panel.
 *
 * This is the primary UI for submitting commands to the AGENT Core Engine.
 * Every command entered here passes through the CoreCoordinator lifecycle.
 * No command bypasses the coordinator.
 */

import { useState, type FormEvent } from 'react';
import {
  Send,
  Square,
  Pause,
  Play,
  Hand,
  type LucideIcon,
} from 'lucide-react';
import { useMissionCommand } from '@/hooks/useMissionCommand';
import type { HumanControlSignal, MissionState } from '@/core';

const LIFECYCLE_ORDER: readonly MissionState[] = [
  'IDLE',
  'UNDERSTAND',
  'SCOPE_CHECK',
  'OBSERVE',
  'PLAN',
  'AUTHORIZATION_CHECK',
  'ACT',
  'VERIFY',
  'REPORT',
  'COMPLETED',
];

export function MissionControl() {
  const { state, submitCommand, cancel, setControlSignal } = useMissionCommand();
  const [input, setInput] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || state.isExecuting) return;
    const prompt = input;
    setInput('');
    await submitCommand(prompt);
  };

  const handleStop = async () => {
    setControlSignal('STOP');
    await cancel();
  };

  const handlePause = () => {
    setControlSignal('PAUSE');
  };

  const handleResume = () => {
    setControlSignal('RESUME');
    setControlSignal('NONE');
  };

  const handleTakeControl = () => {
    setControlSignal('TAKE_CONTROL');
  };

  const currentIndex = LIFECYCLE_ORDER.indexOf(state.missionState);
  const isTerminal =
    state.missionState === 'COMPLETED' ||
    state.missionState === 'FAILED' ||
    state.missionState === 'CANCELLED';

  return (
    <div className="space-y-4">
      {/* Command input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter a command for AGENT…"
          disabled={state.isExecuting}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || state.isExecuting}
          className="flex items-center gap-2 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
        >
          <Send size={16} />
          Execute
        </button>
      </form>

      {/* Human control buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 mr-2">Human Control:</span>
        <ControlButton
          label="Stop"
          icon={Square}
          onClick={handleStop}
          disabled={!state.isExecuting && state.missionState === 'IDLE'}
          active={state.controlSignal === 'STOP'}
          colorClass="bg-red-900/60 hover:bg-red-800/70 border-red-800 text-red-300"
        />
        <ControlButton
          label="Take Control"
          icon={Hand}
          onClick={handleTakeControl}
          disabled={!state.isExecuting && state.missionState === 'IDLE'}
          active={state.controlSignal === 'TAKE_CONTROL'}
          colorClass="bg-amber-900/60 hover:bg-amber-800/70 border-amber-800 text-amber-300"
        />
        <ControlButton
          label="Pause"
          icon={Pause}
          onClick={handlePause}
          disabled={!state.isExecuting}
          active={state.controlSignal === 'PAUSE'}
          colorClass="bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300"
        />
        <ControlButton
          label="Resume"
          icon={Play}
          onClick={handleResume}
          disabled={state.controlSignal !== 'PAUSE'}
          active={false}
          colorClass="bg-emerald-900/60 hover:bg-emerald-800/70 border-emerald-800 text-emerald-300"
        />
      </div>

      {/* Lifecycle progress */}
      {state.missionState !== 'IDLE' && (
        <div className="flex items-center gap-1 flex-wrap text-xs">
          {LIFECYCLE_ORDER.map((phase, i) => {
            const isCurrent = i === currentIndex;
            const isPast = i < currentIndex;
            return (
              <span key={phase} className="flex items-center gap-1">
                <span
                  className={`px-2 py-0.5 rounded font-mono ${
                    isCurrent
                      ? 'bg-sky-900/60 text-sky-300 border border-sky-700'
                      : isPast
                      ? 'text-slate-600'
                      : 'text-slate-700'
                  }`}
                >
                  {phase}
                </span>
                {i < LIFECYCLE_ORDER.length - 1 && (
                  <span className="text-slate-700">→</span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Last mission report */}
      {state.lastReport && (
        <div
          className={`rounded-lg p-3 border text-xs ${
            state.lastReport.outcome === 'SUCCESS'
              ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-300'
              : 'bg-red-950/30 border-red-900/50 text-red-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono">{state.lastReport.missionId}</span>
            <span className="font-semibold">
              {state.lastReport.outcome}
            </span>
          </div>
          <p className="text-slate-400">{state.lastReport.summary}</p>
          {state.lastReport.failureReason && (
            <p className="text-slate-500 mt-1">
              Reason: {state.lastReport.failureReason}
            </p>
          )}
          <div className="flex gap-4 mt-1 text-slate-500">
            <span>State: {state.lastReport.state}</span>
            <span>Verification: {state.lastReport.verification}</span>
            <span>Actions: {state.lastReport.actionsExecuted}</span>
          </div>
        </div>
      )}

      {/* Error display */}
      {state.error && !state.lastReport && (
        <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 text-xs text-red-300">
          {state.error}
        </div>
      )}

      {/* Status line when terminal */}
      {isTerminal && !state.isExecuting && (
        <div className="text-xs text-slate-500">
          Mission ended in state{' '}
          <span className="font-mono text-slate-400">
            {state.missionState}
          </span>
          . Submit a new command to start another.
        </div>
      )}
    </div>
  );
}

function ControlButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
  colorClass,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled: boolean;
  active: boolean;
  colorClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${colorClass} ${
        active ? 'ring-1 ring-current' : ''
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
