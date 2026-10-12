/**
 * useMissionCommand — React hook that routes user commands
 * through the CoreCoordinator's mission lifecycle.
 *
 * This is the single bridge between the UI and the Core Engine.
 * No command can bypass the coordinator.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getCoordinator,
  getMissionMemory,
  type MissionReport,
  type MissionRequest,
  type MissionState,
  type HumanControlSignal,
} from '@/core';

interface MissionCommandState {
  missionState: MissionState;
  isExecuting: boolean;
  lastReport: MissionReport | null;
  controlSignal: HumanControlSignal;
  error: string | null;
}

function createMissionRequest(prompt: string): MissionRequest {
  return {
    id: `mission-${Date.now()}`,
    prompt,
    scope: {
      level: 'read_only',
      allowedCapabilities: ['read_only_observation'],
      targetDescription: prompt.slice(0, 120),
    },
    createdAt: Date.now(),
    maxActions: 20,
    maxDurationMs: 120000,
  };
}

export function useMissionCommand(): {
  state: MissionCommandState;
  submitCommand: (prompt: string) => Promise<void>;
  cancel: () => Promise<void>;
  setControlSignal: (signal: HumanControlSignal) => void;
} {
  const coord = getCoordinator();
  const mem = getMissionMemory();

  const [state, setState] = useState<MissionCommandState>(() => ({
    missionState: coord.getMissionState(),
    isExecuting: false,
    lastReport: coord.getLastReport(),
    controlSignal: coord.getControlSignal(),
    error: null,
  }));

  // Poll coordinator state so the UI reflects the real mission lifecycle.
  useEffect(() => {
    const update = () => {
      setState((prev) => ({
        ...prev,
        missionState: coord.getMissionState(),
        controlSignal: coord.getControlSignal(),
        lastReport: coord.getLastReport(),
      }));
    };
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [coord]);

  const submitCommand = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      setState((prev) => ({
        ...prev,
        isExecuting: true,
        error: null,
      }));

      const request = createMissionRequest(trimmed);

      try {
        const report = await coord.executeMission(request);
        setState((prev) => ({
          ...prev,
          isExecuting: false,
          lastReport: report,
          missionState: coord.getMissionState(),
          error:
            report.outcome !== 'SUCCESS'
              ? `Mission ${report.outcome}: ${report.failureReason ?? report.summary}`
              : null,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isExecuting: false,
          missionState: coord.getMissionState(),
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [coord],
  );

  const cancel = useCallback(async () => {
    await coord.cancelMission();
    setState((prev) => ({
      ...prev,
      missionState: coord.getMissionState(),
      isExecuting: false,
      error: 'Mission cancelled by operator',
    }));
  }, [coord]);

  const setControlSignal = useCallback(
    (signal: HumanControlSignal) => {
      coord.setControlSignal(signal);
      setState((prev) => ({ ...prev, controlSignal: signal }));
    },
    [coord],
  );

  // Keep memory reference for the status panel's recent-missions list
  void mem;

  return { state, submitCommand, cancel, setControlSignal };
}
