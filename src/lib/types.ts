export interface PipelineConfig {
  gravity: number;
  friction: number;
  urdfXml?: string;
}

/* ── Success criteria (parsed from natural language) ───────────── */

export interface SuccessCriteria {
  base_drift_max: number | null;
  joint_separation_max: number | null;
  min_avg_height: number | null;
  end_effector_reach_max: number | null;
  settle_time_max: number | null;
  nan_check: number | null;
}

export const EMPTY_CRITERIA: SuccessCriteria = {
  base_drift_max: null,
  joint_separation_max: null,
  min_avg_height: null,
  end_effector_reach_max: null,
  settle_time_max: null,
  nan_check: null,
};

/* ── Variable sweep types ──────────────────────────────────────── */

export type SweepParam = "gravity" | "link_mass" | "joint_damping" | "timestep";

export interface SweepConfig {
  param: SweepParam;
  min: number;
  max: number;
}

/* ── Batch simulation types ─────────────────────────────────────── */

export interface SimBodyConfig {
  type: "fixed" | "dynamic";
  position: [number, number, number];
  halfExtents: [number, number, number];
  restitution: number;
  friction: number;
}

export interface SimRunConfig {
  gravity: number;
  friction: number;
  steps: number;
  criteria: SuccessCriteria | null;
  bodies: SimBodyConfig[];
  sweepOverride?: {
    param: SweepParam;
    value: number;
  };
}

export interface SimWorkerInput {
  type: "run";
  runIndex: number;
  batchId: string;
  randomSeed: number;
  config: SimRunConfig;
}

export interface SimWorkerOutput {
  type: "result" | "error";
  runIndex: number;
  success?: boolean;
  minComHeight?: number;
  steps?: number;
  finalState?: Array<{
    position: [number, number, number];
    velocity: [number, number, number];
  }>;
  error?: string;
}
