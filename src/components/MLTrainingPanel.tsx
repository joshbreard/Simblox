"use client";

import { useState, useEffect, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";

/* ── Types ─────────────────────────────────────────────────────────── */

interface ProjectModel {
  id: string;
  project_id: string;
  name: string;
  description: string;
  pytorch_script: string | null;
  model_weights: unknown;
  created_at: string;
  last_trained_at: string | null;
}

interface TrainingBatch {
  id: string;
  model_id: string;
  batch_id: string;
  added_at: string;
  trained: boolean;
  run_count: number | null;
  batch_summary: string | null;
}

interface AvailableBatch {
  batch_id: string;
  run_count: number;
  pass_count: number;
  fail_count: number;
  sweep_variable: string | null;
}

const BATCH_SCHEMA_SUMMARY = `Table: batch_runs
Features: gravity (float), friction (float), sweep_value (float nullable), steps_run (int)
Targets: success (bool 0/1), min_com_height (float)
final_state: array of {position:[x,y,z], velocity:[x,y,z]} per rigid body
sweep_variable: string name of swept parameter (nullable)`;

/* ── Helpers ───────────────────────────────────────────────────────── */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function MLTrainingPanel({
  projectId,
}: {
  projectId: string;
}) {
  /* ── State ─────────────────────────────── */
  const [view, setView] = useState<"list" | "detail">("list");
  const [models, setModels] = useState<ProjectModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<ProjectModel | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Add model form
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  // Detail view
  const [scriptVisible, setScriptVisible] = useState(false);
  const [regenerating, setRegenning] = useState(false);
  const [trainingBatches, setTrainingBatches] = useState<TrainingBatch[]>([]);
  const [availableBatches, setAvailableBatches] = useState<AvailableBatch[]>([]);
  const [showBatchSelector, setShowBatchSelector] = useState(false);
  const [training, setTraining] = useState(false);
  const [trainLog, setTrainLog] = useState("");
  const [trainSuccess, setTrainSuccess] = useState<boolean | null>(null);

  /* ── Fetch models ──────────────────────── */
  const fetchModels = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb
      .from("project_models")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (data) setModels(data as ProjectModel[]);
  }, [projectId]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  /* ── Fetch available batches ───────────── */
  const fetchAvailableBatches = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb
      .from("batch_runs")
      .select("batch_id, success, sweep_variable")
      .eq("project_id", projectId);
    if (!data) return;

    const map = new Map<string, AvailableBatch>();
    for (const row of data) {
      const b = map.get(row.batch_id);
      if (b) {
        b.run_count++;
        if (row.success) b.pass_count++;
        else b.fail_count++;
        if (!b.sweep_variable && row.sweep_variable)
          b.sweep_variable = row.sweep_variable;
      } else {
        map.set(row.batch_id, {
          batch_id: row.batch_id,
          run_count: 1,
          pass_count: row.success ? 1 : 0,
          fail_count: row.success ? 0 : 1,
          sweep_variable: row.sweep_variable,
        });
      }
    }
    setAvailableBatches(Array.from(map.values()));
  }, [projectId]);

  /* ── Fetch training batches for model ──── */
  const fetchTrainingBatches = useCallback(async (modelId: string) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb
      .from("model_training_batches")
      .select("*")
      .eq("model_id", modelId)
      .order("added_at", { ascending: false });
    if (data) setTrainingBatches(data as TrainingBatch[]);
  }, []);

  /* ── Enter detail view ─────────────────── */
  const selectModel = useCallback(
    (model: ProjectModel) => {
      setSelectedModel(model);
      setView("detail");
      setScriptVisible(false);
      setTrainLog("");
      setTrainSuccess(null);
      fetchTrainingBatches(model.id);
      fetchAvailableBatches();
    },
    [fetchTrainingBatches, fetchAvailableBatches]
  );

  /* ── Add model ─────────────────────────── */
  const handleAddModel = useCallback(async () => {
    if (!newName.trim() || !newDesc.trim() || generating) return;
    setGenerating(true);
    setGenError("");

    const modelId = crypto.randomUUID();

    try {
      const res = await fetch("/api/generate-pytorch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: newDesc,
          project_id: projectId,
          model_id: modelId,
          batch_schema_summary: BATCH_SCHEMA_SUMMARY,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? "Failed to generate script");
        setGenerating(false);
        return;
      }

      const sb = getSupabase();
      if (!sb) {
        setGenError("Supabase not available");
        setGenerating(false);
        return;
      }

      const { error } = await sb.from("project_models").insert({
        id: modelId,
        project_id: projectId,
        name: newName,
        description: newDesc,
        pytorch_script: data.script,
      });

      if (error) {
        setGenError(error.message);
        setGenerating(false);
        return;
      }

      setShowAddModal(false);
      setNewName("");
      setNewDesc("");
      setGenerating(false);
      await fetchModels();

      // Auto-select the new model
      const newModel: ProjectModel = {
        id: modelId,
        project_id: projectId,
        name: newName,
        description: newDesc,
        pytorch_script: data.script,
        model_weights: null,
        created_at: new Date().toISOString(),
        last_trained_at: null,
      };
      selectModel(newModel);
    } catch (err) {
      setGenError(String(err));
      setGenerating(false);
    }
  }, [newName, newDesc, generating, projectId, fetchModels, selectModel]);

  /* ── Regenerate script ─────────────────── */
  const handleRegenerate = useCallback(async () => {
    if (!selectedModel || regenerating) return;
    setRegenning(true);

    try {
      const res = await fetch("/api/generate-pytorch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: selectedModel.description,
          project_id: projectId,
          model_id: selectedModel.id,
          batch_schema_summary: BATCH_SCHEMA_SUMMARY,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const sb = getSupabase();
        if (sb) {
          await sb
            .from("project_models")
            .update({ pytorch_script: data.script })
            .eq("id", selectedModel.id);
        }
        setSelectedModel({ ...selectedModel, pytorch_script: data.script });
      }
    } finally {
      setRegenning(false);
    }
  }, [selectedModel, regenerating, projectId]);

  /* ── Download script ───────────────────── */
  const downloadScript = useCallback(() => {
    if (!selectedModel?.pytorch_script) return;
    const blob = new Blob([selectedModel.pytorch_script], {
      type: "text/x-python",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "train_model.py";
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedModel]);

  /* ── Add batch to model ────────────────── */
  const addBatch = useCallback(
    async (batch: AvailableBatch) => {
      if (!selectedModel) return;
      const sb = getSupabase();
      if (!sb) return;

      const summary = `${batch.run_count} runs · ${batch.pass_count} pass / ${batch.fail_count} fail${batch.sweep_variable ? ` · sweep: ${batch.sweep_variable}` : ""}`;

      await sb.from("model_training_batches").insert({
        model_id: selectedModel.id,
        batch_id: batch.batch_id,
        run_count: batch.run_count,
        batch_summary: summary,
        trained: false,
      });

      setShowBatchSelector(false);
      fetchTrainingBatches(selectedModel.id);
    },
    [selectedModel, fetchTrainingBatches]
  );

  /* ── Remove batch from model ───────────── */
  const removeBatch = useCallback(
    async (batchRowId: string) => {
      if (!selectedModel) return;
      const sb = getSupabase();
      if (!sb) return;
      await sb.from("model_training_batches").delete().eq("id", batchRowId);
      fetchTrainingBatches(selectedModel.id);
    },
    [selectedModel, fetchTrainingBatches]
  );

  /* ── Train model ───────────────────────── */
  const pendingBatches = trainingBatches.filter((b) => !b.trained);

  const handleTrain = useCallback(async () => {
    if (!selectedModel?.pytorch_script || training || pendingBatches.length === 0) return;
    setTraining(true);
    setTrainLog("");
    setTrainSuccess(null);

    try {
      const sb = getSupabase();
      if (!sb) return;

      const pendingBatchIds = pendingBatches.map((b) => b.batch_id);
      const { data: rows } = await sb
        .from("batch_runs")
        .select("*")
        .eq("project_id", projectId)
        .in("batch_id", pendingBatchIds);

      if (!rows || rows.length === 0) {
        setTrainLog("No batch run data found.");
        setTrainSuccess(false);
        setTraining(false);
        return;
      }

      const res = await fetch("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: selectedModel.id,
          pytorch_script: selectedModel.pytorch_script,
          batch_rows: rows,
        }),
      });
      const data = await res.json();
      setTrainLog(data.log || data.error || "No output");
      setTrainSuccess(data.success === true);

      if (data.success) {
        // Mark batches as trained
        for (const b of pendingBatches) {
          await sb
            .from("model_training_batches")
            .update({ trained: true })
            .eq("id", b.id);
        }
        setSelectedModel({
          ...selectedModel,
          last_trained_at: new Date().toISOString(),
        });
        fetchTrainingBatches(selectedModel.id);
      }
    } catch (err) {
      setTrainLog(String(err));
      setTrainSuccess(false);
    } finally {
      setTraining(false);
    }
  }, [selectedModel, training, pendingBatches, projectId, fetchTrainingBatches]);

  /* ── Batches not yet added to this model ─ */
  const addedBatchIds = new Set(trainingBatches.map((b) => b.batch_id));
  const unaddedBatches = availableBatches.filter(
    (b) => !addedBatchIds.has(b.batch_id)
  );

  /* ══════════════════════════════════════════════════════════════════ */
  /*  RENDER                                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: "monospace",
        fontSize: 13,
        color: "#ccc",
        background: "#111118",
        overflow: "hidden",
      }}
    >
      {/* ── LIST VIEW ──────────────────────────────────────────────── */}
      {view === "list" && (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              borderBottom: "1px solid #333",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
              ML Models
            </span>
            <button
              onClick={() => {
                setShowAddModal(true);
                setGenError("");
              }}
              style={{
                background: "#2196f3",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Add Model
            </button>
          </div>

          {/* Model cards */}
          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {models.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: "#555",
                  fontSize: 12,
                  marginTop: 40,
                }}
              >
                No models yet. Add your first model.
              </div>
            )}
            {models.map((m) => (
              <div
                key={m.id}
                onClick={() => selectModel(m)}
                style={{
                  background: "#1a1a2e",
                  border: "1px solid #333",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                  {m.name}
                </div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
                  {m.description.length > 80
                    ? m.description.slice(0, 80) + "…"
                    : m.description}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: m.last_trained_at ? "#4caf50" : "#555",
                  }}
                >
                  {m.last_trained_at
                    ? `Trained ${relativeTime(m.last_trained_at)}`
                    : "Untrained"}
                </div>
              </div>
            ))}
          </div>

          {/* Add Model Modal */}
          {showAddModal && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.85)",
                zIndex: 100,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>
                Add Model
              </div>
              <label style={{ fontSize: 11, color: "#888", marginBottom: 4, display: "block" }}>
                Model Name
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{
                  background: "#111",
                  color: "#fff",
                  border: "1px solid #444",
                  borderRadius: 4,
                  padding: "4px 6px",
                  fontFamily: "monospace",
                  fontSize: 13,
                  marginBottom: 10,
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
              <label style={{ fontSize: 11, color: "#888", marginBottom: 4, display: "block" }}>
                Describe your model
              </label>
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="e.g. Predict whether a simulation run will pass or fail based on gravity, friction, and sweep parameters. Use a binary classifier."
                rows={5}
                style={{
                  background: "#111",
                  color: "#fff",
                  border: "1px solid #444",
                  borderRadius: 4,
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  fontSize: 12,
                  resize: "vertical",
                  marginBottom: 10,
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
              {genError && (
                <div style={{ color: "#f44336", fontSize: 11, marginBottom: 8 }}>
                  {genError}
                </div>
              )}
              <button
                onClick={handleAddModel}
                disabled={generating || !newName.trim() || !newDesc.trim()}
                style={{
                  background: generating ? "#333" : "#2196f3",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  padding: "8px 12px",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: generating ? "default" : "pointer",
                  width: "100%",
                  marginBottom: 6,
                }}
              >
                {generating ? "Generating…" : "Generate Script & Save"}
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                disabled={generating}
                style={{
                  background: "#333",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  padding: "8px 12px",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── DETAIL VIEW ────────────────────────────────────────────── */}
      {view === "detail" && selectedModel && (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderBottom: "1px solid #333",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => {
                setView("list");
                setSelectedModel(null);
                fetchModels();
              }}
              style={{
                background: "none",
                border: "none",
                color: "#2196f3",
                fontSize: 16,
                cursor: "pointer",
                padding: 0,
              }}
            >
              ←
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
              {selectedModel.name}
            </span>
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {/* ── Script Section ──────────────────── */}
            <div
              style={{
                background: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: 8,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: scriptVisible ? 8 : 0,
                }}
              >
                <span style={{ fontSize: 11, color: "#888" }}>PyTorch Script</span>
                <button
                  onClick={() => setScriptVisible(!scriptVisible)}
                  style={{
                    background: "#333",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 10,
                    cursor: "pointer",
                  }}
                >
                  {scriptVisible ? "Hide" : "Show"}
                </button>
              </div>
              {scriptVisible && (
                <>
                  <pre
                    style={{
                      background: "#0a0a0a",
                      borderRadius: 4,
                      padding: 8,
                      maxHeight: 200,
                      overflowY: "auto",
                      fontSize: 11,
                      color: "#4caf50",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      margin: 0,
                    }}
                  >
                    {selectedModel.pytorch_script || "No script generated."}
                  </pre>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button
                      onClick={downloadScript}
                      style={{
                        flex: 1,
                        background: "#333",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        padding: "5px 8px",
                        fontSize: 11,
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Download script.py
                    </button>
                    <button
                      onClick={handleRegenerate}
                      disabled={regenerating}
                      style={{
                        flex: 1,
                        background: regenerating ? "#333" : "#2196f3",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        padding: "5px 8px",
                        fontSize: 11,
                        cursor: regenerating ? "default" : "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {regenerating ? "Regenerating…" : "Regenerate Script"}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ── Batch Data Section ─────────────── */}
            <div
              style={{
                background: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: 8,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#fff",
                  marginBottom: 8,
                }}
              >
                Training Batches
              </div>

              {/* Available batches summary */}
              {availableBatches.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
                    Available in project:
                  </div>
                  {availableBatches.map((b) => (
                    <div
                      key={b.batch_id}
                      style={{
                        fontSize: 11,
                        color: "#666",
                        padding: "2px 0",
                      }}
                    >
                      {b.batch_id.slice(0, 8)} — {b.run_count} runs · {b.pass_count} pass / {b.fail_count} fail
                      {b.sweep_variable ? ` · sweep: ${b.sweep_variable}` : ""}
                    </div>
                  ))}
                </div>
              )}

              {/* Added batches */}
              {trainingBatches.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
                    Added to model:
                  </div>
                  {trainingBatches.map((b) => (
                    <div
                      key={b.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "4px 6px",
                        background: "#111",
                        borderRadius: 4,
                        marginBottom: 4,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 11, color: "#ccc" }}>
                          {b.batch_id.slice(0, 8)}
                        </span>
                        {b.run_count != null && (
                          <span style={{ fontSize: 10, color: "#666", marginLeft: 6 }}>
                            {b.run_count} runs
                          </span>
                        )}
                        {b.batch_summary && (
                          <span style={{ fontSize: 10, color: "#555", marginLeft: 6 }}>
                            {b.batch_summary}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          color: b.trained ? "#4caf50" : "#ff9800",
                          marginRight: 6,
                          fontWeight: 600,
                        }}
                      >
                        {b.trained ? "Trained" : "Pending"}
                      </span>
                      <button
                        onClick={() => removeBatch(b.id)}
                        style={{
                          background: "#333",
                          color: "#ccc",
                          border: "none",
                          borderRadius: 3,
                          padding: "2px 6px",
                          fontSize: 10,
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Batch button + selector */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setShowBatchSelector(!showBatchSelector)}
                  disabled={unaddedBatches.length === 0}
                  style={{
                    background: unaddedBatches.length === 0 ? "#333" : "#2196f3",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: unaddedBatches.length === 0 ? "default" : "pointer",
                    width: "100%",
                  }}
                >
                  + Add Batch
                </button>
                {showBatchSelector && unaddedBatches.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "#1a1a2e",
                      border: "1px solid #444",
                      borderRadius: 4,
                      marginTop: 4,
                      zIndex: 20,
                      maxHeight: 150,
                      overflowY: "auto",
                    }}
                  >
                    {unaddedBatches.map((b) => (
                      <div
                        key={b.batch_id}
                        onClick={() => addBatch(b)}
                        style={{
                          padding: "6px 8px",
                          fontSize: 11,
                          color: "#ccc",
                          cursor: "pointer",
                          borderBottom: "1px solid #333",
                        }}
                      >
                        {b.batch_id.slice(0, 8)} — {b.run_count} runs · {b.pass_count} pass / {b.fail_count} fail
                        {b.sweep_variable ? ` · sweep: ${b.sweep_variable}` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Train Section ──────────────────── */}
            <div
              style={{
                background: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
                Pending batches: {pendingBatches.length}
              </div>

              <button
                onClick={handleTrain}
                disabled={pendingBatches.length === 0 || training}
                style={{
                  width: "100%",
                  background:
                    pendingBatches.length === 0 || training ? "#333" : "#4caf50",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  padding: "8px 12px",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor:
                    pendingBatches.length === 0 || training
                      ? "default"
                      : "pointer",
                  marginBottom: training || trainLog ? 8 : 0,
                }}
              >
                {training ? "Training…" : "Train Model"}
              </button>

              {/* Training progress indicator */}
              {training && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                    fontSize: 12,
                    color: "#2196f3",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#2196f3",
                      animation: "mlpulse 1s ease-in-out infinite",
                    }}
                  />
                  Training…
                  <style>{`@keyframes mlpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
                </div>
              )}

              {/* Train log output */}
              {trainLog && (
                <pre
                  style={{
                    background: "#0a0a0a",
                    borderRadius: 4,
                    padding: 8,
                    maxHeight: 200,
                    overflowY: "auto",
                    fontSize: 11,
                    color: trainSuccess === false ? "#f44336" : "#4caf50",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    margin: 0,
                  }}
                >
                  {trainLog}
                </pre>
              )}

              {/* Last trained badge */}
              {selectedModel.last_trained_at && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "#4caf50",
                  }}
                >
                  Last trained: {relativeTime(selectedModel.last_trained_at)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
