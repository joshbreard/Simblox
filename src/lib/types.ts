export interface PipelineConfig {
  gravity: number;
  friction: number;
  urdfXml?: string;
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
  successThreshold: number;
  bodies: SimBodyConfig[];
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
