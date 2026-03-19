"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  PipelineConfig,
  SimRunConfig,
  SimWorkerOutput,
  SuccessCriteria,
  SweepParam,
} from "@/lib/types";
import { EMPTY_CRITERIA } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import { useCriteriaStore } from "@/lib/criteriaStore";

/* ── Default body layout (mirrors the main scene) ───────────────── */
const DEFAULT_BODIES: SimRunConfig["bodies"] = [
  {
    type: "fixed",
    position: [0, -0.05, 0],
    halfExtents: [10, 0.05, 10],
    restitution: 0.3,
    friction: 0.7,
  },
  {
    type: "dynamic",
    position: [0, 5, 0],
    halfExtents: [0.5, 0.5, 0.5],
    restitution: 0.3,
    friction: 0.7,
  },
];

const CRITERIA_KEYS: (keyof SuccessCriteria)[] = [
  "base_drift_max",
  "joint_separation_max",
  "min_avg_height",
  "end_effector_reach_max",
  "settle_time_max",
  "nan_check",
];

const CRITERIA_LABELS: Record<keyof SuccessCriteria, string> = {
  base_drift_max: "Base Drift Max (m)",
  joint_separation_max: "Joint Sep. Max (m)",
  min_avg_height: "Min Avg Height (m)",
  end_effector_reach_max: "End Eff. Reach Max (m)",
  settle_time_max: "Settle Time Max (s)",
  nan_check: "NaN Check",
};

interface RunResult {
  runIndex: number;
  success: boolean;
  minComHeight: number;
}

export default function BatchRunner({
  config,
  projectId,
}: {
  config: PipelineConfig | null;
  projectId: string;
}) {
  const [numRuns, setNumRuns] = useState(50);
  const [logInterval, setLogInterval] = useState(300);
  const [endOfRunOnly, setEndOfRunOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [results, setResults] = useState<RunResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const workersRef = useRef<Worker[]>([]);

  const {
    nlInput,
    parsedCriteria,
    confirmed,
    parsing,
    parseError,
    setNlInput,
    setParsedCriteria,
    confirmCriteria,
    setParsing,
    setParseError,
    sweepEnabled,
    sweepConfig,
    setSweepEnabled,
    setSweepParam,
    setSweepMin,
    setSweepMax,
  } = useCriteriaStore();

  const SWEEP_OPTIONS: { value: SweepParam; label: string }[] = [
    { value: "gravity", label: "Gravity" },
    { value: "link_mass", label: "Link Mass" },
    { value: "joint_damping", label: "Joint Damping" },
    { value: "timestep", label: "Timestep" },
  ];

  // Terminate workers on unmount
  useEffect(() => {
    return () => {
      workersRef.current.forEach((w) => w.terminate());
    };
  }, []);

  /* ── Parse NL → criteria via API ──────────────────────────────── */
  const handleParse = useCallback(async () => {
    if (!nlInput.trim() || parsing) return;
    setParsing(true);
    try {
      const res = await fetch("/api/parse-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nlInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data.error ?? "Failed to parse");
        return;
      }
      setParsedCriteria(data.criteria as SuccessCriteria);
      setParsing(false);
    } catch (err) {
      setParseError(String(err));
    }
  }, [nlInput, parsing, setParsing, setParsedCriteria, setParseError]);

  /* ── Edit a parsed criteria value ─────────────────────────────── */
  const editCriteriaField = useCallback(
    (key: keyof SuccessCriteria, value: string) => {
      if (!parsedCriteria) return;
      const num = value.trim() === "" ? null : parseFloat(value);
      setParsedCriteria({
        ...parsedCriteria,
        [key]: value.trim() === "" || isNaN(num as number) ? null : num,
      });
    },
    [parsedCriteria, setParsedCriteria],
  );

  /* ── Compute sweep value for a given trial index ────────────── */
  function sweepValueForIndex(index: number, total: number): number {
    if (total <= 1) return sweepConfig.min;
    return sweepConfig.min + (sweepConfig.max - sweepConfig.min) * (index / (total - 1));
  }

  /* ── Batch run ────────────────────────────────────────────────── */
  const startBatch = useCallback(() => {
    if (running) return;

    const batchId = crypto.randomUUID();
    const maxWorkers = navigator.hardwareConcurrency || 4;
    const activeCriteria = confirmed ? parsedCriteria : null;
    const useSweep = sweepEnabled;
    const sweep = sweepConfig;

    const baseConfig: SimRunConfig = {
      gravity: config?.gravity ?? -9.81,
      friction: config?.friction ?? 0.7,
      steps: 500,
      criteria: activeCriteria,
      bodies: DEFAULT_BODIES.map((b) => ({
        ...b,
        friction: config?.friction ?? b.friction,
      })),
    };

    // Pre-compute per-trial sweep values
    const sweepValues: (number | null)[] = [];
    for (let i = 0; i < numRuns; i++) {
      sweepValues.push(useSweep ? sweepValueForIndex(i, numRuns) : null);
    }

    setRunning(true);
    setCompleted(0);
    setTotal(numRuns);
    setResults([]);
    setShowResults(true);

    // Tear down any prior workers
    workersRef.current.forEach((w) => w.terminate());
    workersRef.current = [];

    let completedCount = 0;
    const allResults: RunResult[] = [];
    const queue = Array.from({ length: numRuns }, (_, i) => i);

    function assignWork(worker: Worker): boolean {
      const runIndex = queue.shift();
      if (runIndex === undefined) return false;

      const trialConfig: SimRunConfig = {
        ...baseConfig,
        ...(useSweep && sweepValues[runIndex] !== null
          ? { sweepOverride: { param: sweep.param, value: sweepValues[runIndex]! } }
          : {}),
      };

      worker.postMessage({
        type: "run",
        runIndex,
        batchId,
        randomSeed: (runIndex + 1) * 7919 + (Date.now() % 1_000_000),
        config: trialConfig,
      });
      return true;
    }

    const workerCount = Math.min(maxWorkers, numRuns);

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        new URL("../workers/sim.worker.ts", import.meta.url),
      );

      worker.onmessage = (e: MessageEvent<SimWorkerOutput>) => {
        const data = e.data;

        const result: RunResult = {
          runIndex: data.runIndex,
          success: data.type === "result" && !!data.success,
          minComHeight:
            data.type === "result" ? (data.minComHeight ?? -Infinity) : -Infinity,
        };
        allResults.push(result);

        // Log to Supabase (fire-and-forget)
        if (data.type === "result") {
          const sb = getSupabase();
          if (sb) {
            sb.from("batch_runs")
              .insert({
                project_id: projectId,
                batch_id: batchId,
                run_index: data.runIndex,
                success: data.success,
                min_com_height: data.minComHeight,
                steps_run: data.steps,
                config: baseConfig,
                final_state: data.finalState,
                nl_criteria_input: confirmed ? nlInput : null,
                parsed_criteria: activeCriteria,
                sweep_variable: useSweep ? sweep.param : null,
                sweep_value: sweepValues[data.runIndex] ?? null,
              })
              .then(() => {});
          }
        }

        completedCount++;
        setCompleted(completedCount);
        setResults([...allResults].sort((a, b) => a.runIndex - b.runIndex));

        if (completedCount >= numRuns) {
          setRunning(false);
          workersRef.current.forEach((w) => w.terminate());
          workersRef.current = [];
        } else {
          assignWork(worker);
        }
      };

      worker.onerror = () => {
        completedCount++;
        allResults.push({
          runIndex: -1,
          success: false,
          minComHeight: -Infinity,
        });
        setCompleted(completedCount);
        setResults([...allResults].sort((a, b) => a.runIndex - b.runIndex));

        if (completedCount >= numRuns) {
          setRunning(false);
          workersRef.current.forEach((w) => w.terminate());
          workersRef.current = [];
        }
      };

      workersRef.current.push(worker);
      assignWork(worker);
    }
  }, [running, numRuns, config, confirmed, parsedCriteria, nlInput, sweepEnabled, sweepConfig, projectId]);

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;
  const progress = total > 0 ? completed / total : 0;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        width: 340,
        background: "#1a1a2e",
        border: "1px solid #333",
        borderRadius: 8,
        padding: 12,
        zIndex: 20,
        fontFamily: "monospace",
        fontSize: 13,
        color: "#ccc",
      }}
    >
      {/* Header */}
      <div
        style={{
          fontWeight: 600,
          color: "#fff",
          marginBottom: 8,
          fontSize: 14,
        }}
      >
        Batch Simulation
      </div>

      {/* ── NL Success Criteria Input ─────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <label
          style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}
        >
          Success Criteria (plain English)
        </label>
        <textarea
          value={nlInput}
          onChange={(e) => setNlInput(e.target.value)}
          disabled={running || parsing}
          placeholder='e.g. "The robot must stay above 0.3m, settle within 5 seconds, and not produce NaN values"'
          rows={3}
          style={{
            width: "100%",
            background: "#111",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: 4,
            padding: "6px 8px",
            fontSize: 12,
            fontFamily: "monospace",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        <button
          onClick={handleParse}
          disabled={running || parsing || !nlInput.trim()}
          style={{
            marginTop: 4,
            width: "100%",
            background: parsing ? "#333" : "#2196f3",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "5px 10px",
            cursor: parsing || !nlInput.trim() ? "default" : "pointer",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {parsing ? "Parsing\u2026" : "Parse"}
        </button>
        {parseError && (
          <div style={{ color: "#f44336", fontSize: 11, marginTop: 4 }}>
            {parseError}
          </div>
        )}
      </div>

      {/* ── Variable Sweep ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: sweepEnabled ? 6 : 0,
          }}
        >
          <label style={{ fontSize: 11, color: "#888" }}>Variable</label>
          <select
            value={sweepEnabled ? sweepConfig.param : ""}
            onChange={(e) => {
              if (e.target.value) {
                setSweepEnabled(true);
                setSweepParam(e.target.value as SweepParam);
              } else {
                setSweepEnabled(false);
              }
            }}
            disabled={running}
            style={{
              flex: 1,
              background: "#111",
              color: "#fff",
              border: "1px solid #444",
              borderRadius: 4,
              padding: "3px 6px",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            <option value="">None (no sweep)</option>
            {SWEEP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {sweepEnabled && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 11, color: "#888" }}>Min</label>
            <input
              type="number"
              step="any"
              value={sweepConfig.min}
              onChange={(e) => setSweepMin(parseFloat(e.target.value) || 0)}
              disabled={running}
              style={{
                flex: 1,
                background: "#111",
                color: "#fff",
                border: "1px solid #444",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 12,
                fontFamily: "monospace",
                textAlign: "right",
              }}
            />
            <label style={{ fontSize: 11, color: "#888" }}>Max</label>
            <input
              type="number"
              step="any"
              value={sweepConfig.max}
              onChange={(e) => setSweepMax(parseFloat(e.target.value) || 0)}
              disabled={running}
              style={{
                flex: 1,
                background: "#111",
                color: "#fff",
                border: "1px solid #444",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 12,
                fontFamily: "monospace",
                textAlign: "right",
              }}
            />
          </div>
        )}
      </div>

      {/* ── Log controls (below Parse) ────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 11, color: "#888" }}>Log every</span>
        <input
          type="number"
          min={0}
          value={logInterval}
          onChange={(e) =>
            setLogInterval(Math.max(0, parseInt(e.target.value) || 0))
          }
          disabled={running || endOfRunOnly}
          style={{
            width: 50,
            background: "#111",
            color: endOfRunOnly ? "#555" : "#fff",
            border: "1px solid #444",
            borderRadius: 4,
            padding: "2px 4px",
            fontSize: 12,
            fontFamily: "monospace",
            textAlign: "right",
          }}
        />
        <span style={{ fontSize: 11, color: "#888" }}>steps</span>
        <button
          onClick={() => setEndOfRunOnly((v) => !v)}
          disabled={running}
          style={{
            marginLeft: "auto",
            background: endOfRunOnly ? "#2196f3" : "#333",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "3px 8px",
            fontSize: 10,
            cursor: running ? "default" : "pointer",
            fontWeight: endOfRunOnly ? 600 : 400,
            whiteSpace: "nowrap",
          }}
        >
          End of run only
        </button>
      </div>

      {/* ── Parsed Criteria Confirmation ──────────────────────────── */}
      {parsedCriteria && !confirmed && (
        <div
          style={{
            marginBottom: 8,
            background: "#111",
            borderRadius: 4,
            padding: 8,
            border: "1px solid #444",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#888",
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            Parsed Criteria (edit before confirming)
          </div>
          {CRITERIA_KEYS.map((key) => (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 3,
              }}
            >
              <label style={{ fontSize: 11, color: "#aaa", flex: 1 }}>
                {CRITERIA_LABELS[key]}
              </label>
              <input
                type="text"
                value={parsedCriteria[key] === null ? "" : String(parsedCriteria[key])}
                onChange={(e) => editCriteriaField(key, e.target.value)}
                placeholder="null"
                style={{
                  width: 70,
                  background: "#0a0a0a",
                  color: parsedCriteria[key] !== null ? "#4caf50" : "#555",
                  border: "1px solid #333",
                  borderRadius: 3,
                  padding: "2px 6px",
                  fontSize: 12,
                  fontFamily: "monospace",
                  textAlign: "right",
                }}
              />
            </div>
          ))}
          <button
            onClick={confirmCriteria}
            style={{
              marginTop: 6,
              width: "100%",
              background: "#4caf50",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "5px 10px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Confirm Criteria
          </button>
        </div>
      )}

      {/* ── Confirmed badge ───────────────────────────────────────── */}
      {confirmed && parsedCriteria && (
        <div
          style={{
            marginBottom: 8,
            background: "#0d2818",
            border: "1px solid #2e7d32",
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 11,
            color: "#4caf50",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Criteria active:{" "}
            {CRITERIA_KEYS.filter((k) => parsedCriteria[k] !== null).length} thresholds
          </span>
          <button
            onClick={() => setNlInput(nlInput)}
            style={{
              background: "transparent",
              border: "1px solid #4caf50",
              color: "#4caf50",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            Edit
          </button>
        </div>
      )}

      {/* ── Runs + Start Simulation ───────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <label style={{ fontSize: 12, color: "#888" }}>Runs</label>
        <input
          type="number"
          min={1}
          max={500}
          value={numRuns}
          onChange={(e) =>
            setNumRuns(Math.min(500, Math.max(1, parseInt(e.target.value) || 1)))
          }
          disabled={running}
          style={{
            width: 60,
            background: "#111",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: 4,
            padding: "4px 6px",
            fontSize: 13,
          }}
        />
        <button
          onClick={startBatch}
          disabled={running}
          style={{
            flex: 1,
            background: running ? "#333" : "#4caf50",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "6px 12px",
            cursor: running ? "default" : "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {running ? "Running\u2026" : "Start Simulation"}
        </button>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              height: 6,
              background: "#222",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                background: running ? "#2196f3" : "#4caf50",
                transition: "width 0.15s ease",
                borderRadius: 3,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: "#888",
              marginTop: 4,
            }}
          >
            <span>
              {completed}/{total}
            </span>
            {results.length > 0 && (
              <span>
                <span style={{ color: "#4caf50" }}>{successCount} pass</span>
                {" / "}
                <span style={{ color: "#f44336" }}>{failCount} fail</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Results list */}
      {showResults && results.length > 0 && (
        <div
          style={{
            maxHeight: 180,
            overflowY: "auto",
            background: "#111",
            borderRadius: 4,
            padding: 4,
          }}
        >
          {results.map((r) => (
            <div
              key={r.runIndex}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "2px 6px",
                fontSize: 11,
                color: r.success ? "#4caf50" : "#f44336",
                borderBottom: "1px solid #1a1a2e",
              }}
            >
              <span>Run #{r.runIndex + 1}</span>
              <span>
                {r.success ? "PASS" : "FAIL"} (h:{" "}
                {r.minComHeight > -1000
                  ? r.minComHeight.toFixed(3)
                  : "err"}
                )
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
