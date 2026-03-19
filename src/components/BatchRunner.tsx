"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  PipelineConfig,
  SimRunConfig,
  SimWorkerOutput,
} from "@/lib/types";
import { getSupabase } from "@/lib/supabase";

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

interface RunResult {
  runIndex: number;
  success: boolean;
  minComHeight: number;
}

export default function BatchRunner({
  config,
}: {
  config: PipelineConfig | null;
}) {
  const [numRuns, setNumRuns] = useState(50);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [results, setResults] = useState<RunResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const workersRef = useRef<Worker[]>([]);

  // Terminate workers on unmount
  useEffect(() => {
    return () => {
      workersRef.current.forEach((w) => w.terminate());
    };
  }, []);

  const startBatch = useCallback(() => {
    if (running) return;

    const batchId = crypto.randomUUID();
    const maxWorkers = navigator.hardwareConcurrency || 4;

    const runConfig: SimRunConfig = {
      gravity: config?.gravity ?? -9.81,
      friction: config?.friction ?? 0.7,
      steps: 500,
      successThreshold: 0.5,
      bodies: DEFAULT_BODIES.map((b) => ({
        ...b,
        friction: config?.friction ?? b.friction,
      })),
    };

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
      worker.postMessage({
        type: "run",
        runIndex,
        batchId,
        randomSeed: (runIndex + 1) * 7919 + (Date.now() % 1_000_000),
        config: runConfig,
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
                batch_id: batchId,
                run_index: data.runIndex,
                success: data.success,
                min_com_height: data.minComHeight,
                steps_run: data.steps,
                config: runConfig,
                final_state: data.finalState,
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
  }, [running, numRuns, config]);

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;
  const progress = total > 0 ? completed / total : 0;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        width: 320,
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

      {/* Controls */}
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
          max={1000}
          value={numRuns}
          onChange={(e) =>
            setNumRuns(Math.max(1, parseInt(e.target.value) || 1))
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
          {running ? "Running\u2026" : "Batch Run"}
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
