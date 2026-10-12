import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Cpu,
  ShieldCheck,
  AlertTriangle,
  CircleDot,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
} from 'lucide-react';
import {
  getCoordinator,
  getCapabilityRegistry,
  getResourceManager,
  getMissionMemory,
  type EngineStatus,
  type RuntimeConnectionStatus,
  type MissionState,
  type CapabilityRecord,
  type ResourceInfo,
  type MissionHistoryEntry,
  type MissionReport,
  type VerificationStatus,
} from '@/core';

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

type StatusKind = 'good' | 'bad' | 'warn' | 'unknown';

function statusColor(kind: StatusKind): string {
  switch (kind) {
    case 'good':
      return 'text-emerald-400';
    case 'bad':
      return 'text-red-400';
    case 'warn':
      return 'text-amber-400';
    case 'unknown':
      return 'text-slate-500';
  }
}

function statusIcon(kind: StatusKind, size = 16) {
  switch (kind) {
    case 'good':
      return <CheckCircle2 size={size} className={statusColor(kind)} />;
    case 'bad':
      return <XCircle size={size} className={statusColor(kind)} />;
    case 'warn':
      return <AlertTriangle size={size} className={statusColor(kind)} />;
    case 'unknown':
      return <HelpCircle size={size} className={statusColor(kind)} />;
  }
}

function engineStatusKind(s: EngineStatus): StatusKind {
  switch (s) {
    case 'READY':
    case 'RUNNING':
      return 'good';
    case 'DEGRADED':
      return 'warn';
    case 'BLOCKED':
      return 'bad';
    default:
      return 'unknown';
  }
}

function runtimeKind(s: RuntimeConnectionStatus): StatusKind {
  switch (s) {
    case 'CONNECTED':
      return 'good';
    case 'DISCONNECTED':
      return 'bad';
    default:
      return 'unknown';
  }
}

function missionStateKind(s: MissionState): StatusKind {
  switch (s) {
    case 'COMPLETED':
      return 'good';
    case 'FAILED':
    case 'CANCELLED':
      return 'bad';
    case 'IDLE':
      return 'unknown';
    default:
      return 'warn';
  }
}

function verificationKind(s: VerificationStatus): StatusKind {
  switch (s) {
    case 'VERIFIED':
      return 'good';
    case 'FAILED':
      return 'bad';
    default:
      return 'unknown';
  }
}

function capabilityKind(rec: CapabilityRecord): StatusKind {
  switch (rec.status) {
    case 'AVAILABLE':
      return 'good';
    case 'UNAVAILABLE':
      return 'bad';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Hook for polling coordinator state
// ---------------------------------------------------------------------------

interface EngineSnapshot {
  engineStatus: EngineStatus;
  runtimeStatus: RuntimeConnectionStatus;
  missionState: MissionState;
  plannerAvailable: boolean;
  actionExecutionAvailable: boolean;
  verificationStatus: VerificationStatus;
  resourceInfo: ResourceInfo;
  capabilities: readonly CapabilityRecord[];
  recentMissions: readonly MissionHistoryEntry[];
  lastReport: MissionReport | null;
  lastFailure: { reason: string; detail: string; atPhase: string } | null;
}

function useEngineSnapshot(): EngineSnapshot {
  const coord = getCoordinator();
  const caps = getCapabilityRegistry();
  const res = getResourceManager();
  const mem = getMissionMemory();

  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => captureSnapshot());

  const capture = useCallback(() => {
    setSnapshot(captureSnapshot());
  }, []);

  useEffect(() => {
    capture();
    const interval = setInterval(capture, 2000);
    return () => clearInterval(interval);
  }, [capture]);

  function captureSnapshot(): EngineSnapshot {
    const recent = mem.getRecentMissions(5);
    const failure = coord.getLastFailure();
    return {
      engineStatus: coord.getEngineStatus(),
      runtimeStatus: coord.getRuntimeConnectionStatus(),
      missionState: coord.getMissionState(),
      plannerAvailable: coord.isPlannerAvailable(),
      actionExecutionAvailable: coord.isActionExecutionAvailable(),
      verificationStatus: coord.getVerificationStatus(),
      resourceInfo: coord.getResourceInfo(),
      capabilities: caps.getAll(),
      recentMissions: recent,
      lastReport: coord.getLastReport(),
      lastFailure: failure
        ? { reason: failure.reason, detail: failure.detail, atPhase: failure.atPhase }
        : null,
    };
  }

  return snapshot;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CoreEngineStatus() {
  const snap = useEngineSnapshot();

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Activity size={22} className="text-sky-400" />
        <h2 className="text-lg font-semibold text-slate-200">AGENT Core Engine</h2>
        <span className="text-xs text-slate-500 ml-auto">
          Frontend loaded — engine initialized
        </span>
      </div>

      {/* Core status grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <StatusCard
          label="Engine Status"
          value={snap.engineStatus}
          icon={statusIcon(engineStatusKind(snap.engineStatus))}
          kind={engineStatusKind(snap.engineStatus)}
        />
        <StatusCard
          label="Runtime Connection"
          value={snap.runtimeStatus}
          icon={statusIcon(runtimeKind(snap.runtimeStatus))}
          kind={runtimeKind(snap.runtimeStatus)}
        />
        <StatusCard
          label="Mission State"
          value={snap.missionState}
          icon={statusIcon(missionStateKind(snap.missionState))}
          kind={missionStateKind(snap.missionState)}
        />
        <StatusCard
          label="Planner Available"
          value={snap.plannerAvailable ? 'YES' : 'NO'}
          icon={statusIcon(snap.plannerAvailable ? 'good' : 'unknown')}
          kind={snap.plannerAvailable ? 'good' : 'unknown'}
        />
        <StatusCard
          label="Action Execution"
          value={snap.actionExecutionAvailable ? 'READY' : 'UNAVAILABLE'}
          icon={statusIcon(snap.actionExecutionAvailable ? 'good' : 'bad')}
          kind={snap.actionExecutionAvailable ? 'good' : 'bad'}
        />
        <StatusCard
          label="Verification Status"
          value={snap.verificationStatus}
          icon={statusIcon(verificationKind(snap.verificationStatus))}
          kind={verificationKind(snap.verificationStatus)}
        />
      </div>

      {/* Distinct condition indicators */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
          <ShieldCheck size={15} className="text-slate-400" />
          Condition Distinction
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
          <ConditionRow label="Frontend loaded" active kind="good" />
          <ConditionRow
            label="Core Engine code initialized"
            active
            kind="good"
          />
          <ConditionRow
            label="Runtime connected"
            active={snap.runtimeStatus === 'CONNECTED'}
            kind={snap.runtimeStatus === 'CONNECTED' ? 'good' : 'bad'}
          />
          <ConditionRow
            label="Local AI available"
            active={snap.resourceInfo.modelAvailable === true}
            kind={snap.resourceInfo.modelAvailable === true ? 'good' : 'unknown'}
          />
          <ConditionRow
            label="Mission authorized"
            active={snap.missionState === 'ACT' || snap.missionState === 'VERIFY' || snap.missionState === 'COMPLETED'}
            kind={
              snap.missionState === 'COMPLETED'
                ? 'good'
                : snap.missionState === 'ACT' || snap.missionState === 'VERIFY'
                ? 'warn'
                : 'unknown'
            }
          />
          <ConditionRow
            label="Mission verified complete"
            active={snap.verificationStatus === 'VERIFIED' && snap.missionState === 'COMPLETED'}
            kind={snap.verificationStatus === 'VERIFIED' && snap.missionState === 'COMPLETED' ? 'good' : 'unknown'}
          />
        </div>
      </div>

      {/* Resource info */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
          <Cpu size={15} className="text-slate-400" />
          Resource Information
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <ResourceItem
            label="Available RAM"
            value={snap.resourceInfo.availableRamMB != null ? `${snap.resourceInfo.availableRamMB} MB` : 'UNKNOWN'}
          />
          <ResourceItem
            label="CPU Usage"
            value={snap.resourceInfo.cpuUtilizationPercent != null ? `${snap.resourceInfo.cpuUtilizationPercent}%` : 'UNKNOWN'}
          />
          <ResourceItem
            label="Model Available"
            value={
              snap.resourceInfo.modelAvailable === true
                ? 'YES'
                : snap.resourceInfo.modelAvailable === false
                ? 'NO'
                : 'UNKNOWN'
            }
          />
          <ResourceItem
            label="Model ID"
            value={snap.resourceInfo.modelId ?? 'UNKNOWN'}
          />
          <ResourceItem
            label="Model Loading"
            value={snap.resourceInfo.modelLoadingState ?? 'unknown'}
          />
        </div>
        {(snap.resourceInfo.availableRamMB == null &&
          snap.resourceInfo.cpuUtilizationPercent == null &&
          snap.resourceInfo.modelAvailable == null) && (
          <p className="text-xs text-slate-600 mt-3">
            No trusted runtime measurements available. Resource fields remain UNKNOWN until a connected runtime reports them.
          </p>
        )}
      </div>

      {/* Capability registry */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
          <CircleDot size={15} className="text-slate-400" />
          Capability Registry
        </h3>
        <div className="space-y-1.5">
          {snap.capabilities.map((cap) => (
            <div
              key={cap.id}
              className="flex items-center justify-between text-xs py-1 border-b border-slate-800/50 last:border-0"
            >
              <span className="text-slate-400 font-mono">{cap.id}</span>
              <div className="flex items-center gap-2">
                <span className={statusColor(capabilityKind(cap))}>{cap.status}</span>
                {statusIcon(capabilityKind(cap), 14)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent missions */}
      {snap.recentMissions.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
            <Clock size={15} className="text-slate-400" />
            Recent Missions
          </h3>
          <div className="space-y-1.5">
            {snap.recentMissions.map((m) => (
              <div
                key={m.missionId}
                className="flex items-center justify-between text-xs py-1 border-b border-slate-800/50 last:border-0"
              >
                <span className="text-slate-400 font-mono">{m.missionId}</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">{m.actionCount} actions</span>
                  <span className={statusColor(m.outcome === 'SUCCESS' ? 'good' : m.outcome === 'CANCELLED' ? 'warn' : 'bad')}>
                    {m.outcome}
                  </span>
                  <span className="text-slate-500">{m.verification}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last mission report */}
      {snap.lastReport && (
        <div
          className={`rounded-lg p-4 border ${
            snap.lastReport.outcome === 'SUCCESS'
              ? 'bg-emerald-950/30 border-emerald-900/50'
              : 'bg-red-950/30 border-red-900/50'
          }`}
        >
          <h3 className="text-sm font-medium text-slate-300 mb-2">
            Last Mission Report
          </h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><span className="text-slate-500">Mission:</span> {snap.lastReport.missionId}</p>
            <p><span className="text-slate-500">Outcome:</span> {snap.lastReport.outcome}</p>
            <p><span className="text-slate-500">State:</span> {snap.lastReport.state}</p>
            <p><span className="text-slate-500">Verification:</span> {snap.lastReport.verification}</p>
            <p><span className="text-slate-500">Actions:</span> {snap.lastReport.actionsExecuted}</p>
            {snap.lastReport.failureReason && (
              <p><span className="text-slate-500">Failure:</span> {snap.lastReport.failureReason}</p>
            )}
            <p><span className="text-slate-500">Summary:</span> {snap.lastReport.summary}</p>
          </div>
        </div>
      )}

      {/* Last failure */}
      {snap.lastFailure && (
        <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-red-300 mb-2 flex items-center gap-2">
            <AlertTriangle size={15} />
            Last Failure
          </h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><span className="text-slate-500">Reason:</span> {snap.lastFailure.reason}</p>
            <p><span className="text-slate-500">Phase:</span> {snap.lastFailure.atPhase}</p>
            <p><span className="text-slate-500">Detail:</span> {snap.lastFailure.detail}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusCard({
  label,
  value,
  icon,
  kind,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  kind: StatusKind;
}) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-500">{label}</span>
        {icon}
      </div>
      <p className={`text-sm font-semibold ${statusColor(kind)}`}>{value}</p>
    </div>
  );
}

function ConditionRow({
  label,
  active,
  kind,
}: {
  label: string;
  active: boolean;
  kind: StatusKind;
}) {
  return (
    <div className="flex items-center gap-2">
      {statusIcon(kind, 14)}
      <span className={active ? 'text-slate-300' : 'text-slate-600'}>
        {label}
      </span>
    </div>
  );
}

function ResourceItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-500 mb-0.5">{label}</p>
      <p className="text-slate-300 font-mono">{value}</p>
    </div>
  );
}
