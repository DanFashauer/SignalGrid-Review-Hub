import { useState, useEffect, useCallback } from "react";
import type { IntegrationStatus } from "@/data/integrationData";
import type { MilestoneStatus } from "@/data/activationData";

const STORAGE_KEY = "signalgrid-workspace-v1";

export interface OutreachBatchState {
  sendDate: string;
  responsesCounted: number;
  qualifiedConversations: number;
  status: "planned" | "sent" | "complete";
  notes: string;
}

export interface WorkspaceState {
  integrationStatuses: Record<string, IntegrationStatus>;
  integrationNotes: Record<string, string>;
  milestoneStatuses: Record<string, MilestoneStatus>;
  outreachBatches: Record<string, OutreachBatchState>;
  lastUpdated: string;
}

function loadState(): WorkspaceState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState(state: WorkspaceState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

const INTEGRATION_CYCLE: IntegrationStatus[] = [
  "not-started",
  "in-progress",
  "sandbox-validated",
  "demo-ready",
];

const MILESTONE_CYCLE: MilestoneStatus[] = [
  "not-started",
  "in-progress",
  "complete",
  "blocked",
];

export function useWorkspaceState(
  defaultIntegrationStatuses: Record<string, IntegrationStatus>,
  defaultMilestoneStatuses: Record<string, MilestoneStatus>,
  defaultBatches: Record<string, OutreachBatchState>
) {
  const [state, setState] = useState<WorkspaceState>(() => {
    const saved = loadState();
    return (
      saved ?? {
        integrationStatuses: { ...defaultIntegrationStatuses },
        integrationNotes: {},
        milestoneStatuses: { ...defaultMilestoneStatuses },
        outreachBatches: { ...defaultBatches },
        lastUpdated: new Date().toISOString(),
      }
    );
  });

  useEffect(() => {
    saveState(state);
  }, [state]);

  const cycleIntegrationStatus = useCallback((id: string) => {
    setState((prev) => {
      const current = prev.integrationStatuses[id] ?? "not-started";
      const idx = INTEGRATION_CYCLE.indexOf(current);
      const next = INTEGRATION_CYCLE[(idx + 1) % INTEGRATION_CYCLE.length];
      return {
        ...prev,
        integrationStatuses: { ...prev.integrationStatuses, [id]: next },
        lastUpdated: new Date().toISOString(),
      };
    });
  }, []);

  const setIntegrationStatus = useCallback((id: string, status: IntegrationStatus) => {
    setState((prev) => ({
      ...prev,
      integrationStatuses: { ...prev.integrationStatuses, [id]: status },
      lastUpdated: new Date().toISOString(),
    }));
  }, []);

  const setIntegrationNote = useCallback((id: string, note: string) => {
    setState((prev) => ({
      ...prev,
      integrationNotes: { ...prev.integrationNotes, [id]: note },
      lastUpdated: new Date().toISOString(),
    }));
  }, []);

  const cycleMilestoneStatus = useCallback((id: string) => {
    setState((prev) => {
      const current = prev.milestoneStatuses[id] ?? "not-started";
      const idx = MILESTONE_CYCLE.indexOf(current);
      const next = MILESTONE_CYCLE[(idx + 1) % MILESTONE_CYCLE.length];
      return {
        ...prev,
        milestoneStatuses: { ...prev.milestoneStatuses, [id]: next },
        lastUpdated: new Date().toISOString(),
      };
    });
  }, []);

  const setMilestoneStatus = useCallback((id: string, status: MilestoneStatus) => {
    setState((prev) => ({
      ...prev,
      milestoneStatuses: { ...prev.milestoneStatuses, [id]: status },
      lastUpdated: new Date().toISOString(),
    }));
  }, []);

  const updateOutreachBatch = useCallback(
    (id: string, patch: Partial<OutreachBatchState>) => {
      setState((prev) => ({
        ...prev,
        outreachBatches: {
          ...prev.outreachBatches,
          [id]: { ...(prev.outreachBatches[id] ?? defaultBatches[id]), ...patch },
        },
        lastUpdated: new Date().toISOString(),
      }));
    },
    [defaultBatches]
  );

  const resetAll = useCallback(() => {
    const fresh: WorkspaceState = {
      integrationStatuses: { ...defaultIntegrationStatuses },
      integrationNotes: {},
      milestoneStatuses: { ...defaultMilestoneStatuses },
      outreachBatches: { ...defaultBatches },
      lastUpdated: new Date().toISOString(),
    };
    setState(fresh);
  }, [defaultIntegrationStatuses, defaultMilestoneStatuses, defaultBatches]);

  return {
    state,
    cycleIntegrationStatus,
    setIntegrationStatus,
    setIntegrationNote,
    cycleMilestoneStatus,
    setMilestoneStatus,
    updateOutreachBatch,
    resetAll,
  };
}
