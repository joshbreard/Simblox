"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

interface ProjectCard {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  run_count: number;
  pass_rate: number;
  last_run: string | null;
}

export default function ProjectSelector() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchProjects = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }

    const { data: projectRows } = await sb
      .from("projects")
      .select("id, name, description, created_at")
      .order("created_at", { ascending: false });

    if (!projectRows || projectRows.length === 0) {
      setProjects([]);
      setLoading(false);
      return;
    }

    const ids = projectRows.map((p) => p.id);
    const { data: runs } = await sb
      .from("batch_runs")
      .select("project_id, success, created_at")
      .in("project_id", ids);

    const cards: ProjectCard[] = projectRows.map((p) => {
      const projectRuns = (runs || []).filter((r) => r.project_id === p.id);
      const passCount = projectRuns.filter((r) => r.success).length;
      const dates = projectRuns
        .map((r) => r.created_at)
        .filter(Boolean)
        .sort();
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        created_at: p.created_at,
        run_count: projectRuns.length,
        pass_rate: projectRuns.length > 0 ? (passCount / projectRuns.length) * 100 : 0,
        last_run: dates.length > 0 ? dates[dates.length - 1] : null,
      };
    });

    setProjects(cards);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);

    let projectId: string | null = null;

    const sb = getSupabase();
    if (!sb) {
      setSubmitting(false);
      return;
    }

    const { data, error } = await sb
      .from("projects")
      .insert({ name: name.trim(), description: description.trim() || null })
      .select("id")
      .single();

    if (error || !data) {
      console.error("Supabase insert error:", error);
      setSubmitting(false);
      return;
    }

    projectId = data.id;

    setName("");
    setDescription("");
    setShowForm(false);
    setSubmitting(false);
    router.push(`/project/${projectId}`);
  }, [name, description, submitting, router]);

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1a1a2e",
        fontFamily: "monospace",
        color: "#ccc",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "60px 20px",
      }}
    >
      <h1
        style={{
          color: "#fff",
          fontSize: 40,
          fontWeight: 700,
          marginBottom: 8,
          letterSpacing: 2,
        }}
      >
        Simblox
      </h1>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 40, marginTop: 0 }}>
        Physics Simulation Projects
      </p>

      <button
        onClick={() => setShowForm((v) => !v)}
        style={{
          background: "#4caf50",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "10px 24px",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 14,
          fontFamily: "monospace",
          marginBottom: 24,
        }}
      >
        {showForm ? "Cancel" : "New Project"}
      </button>

      {showForm && (
        <div
          style={{
            background: "#111118",
            border: "1px solid #333",
            borderRadius: 8,
            padding: 20,
            width: "100%",
            maxWidth: 480,
            marginBottom: 32,
          }}
        >
          <label
            style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}
          >
            Project Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Simulation"
            autoFocus
            style={{
              width: "100%",
              background: "#0a0a14",
              color: "#fff",
              border: "1px solid #444",
              borderRadius: 4,
              padding: "8px 10px",
              fontSize: 14,
              fontFamily: "monospace",
              marginBottom: 12,
              boxSizing: "border-box",
            }}
          />
          <label
            style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}
          >
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about?"
            rows={2}
            style={{
              width: "100%",
              background: "#0a0a14",
              color: "#fff",
              border: "1px solid #444",
              borderRadius: 4,
              padding: "8px 10px",
              fontSize: 13,
              fontFamily: "monospace",
              resize: "vertical",
              marginBottom: 12,
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleCreate}
            disabled={!name.trim() || submitting}
            style={{
              width: "100%",
              background: !name.trim() || submitting ? "#333" : "#2196f3",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "8px 16px",
              cursor: !name.trim() || submitting ? "default" : "pointer",
              fontWeight: 600,
              fontSize: 14,
              fontFamily: "monospace",
            }}
          >
            {submitting ? "Creating..." : "Create Project"}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#666", fontSize: 14, marginTop: 40 }}>Loading...</div>
      ) : projects.length === 0 ? (
        <div style={{ color: "#666", fontSize: 14, marginTop: 40 }}>
          No projects yet. Create one to get started.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
            width: "100%",
            maxWidth: 900,
          }}
        >
          {projects.map((p) => (
            <div
              key={p.id}
              style={{
                background: "#111118",
                border: "1px solid #333",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div
                style={{
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {p.name}
              </div>
              {p.description && (
                <div
                  style={{
                    color: "#888",
                    fontSize: 12,
                    marginBottom: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {p.description}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  fontSize: 11,
                  color: "#888",
                  marginBottom: 12,
                }}
              >
                <span>Runs: {p.run_count}</span>
                <span>
                  Pass:{" "}
                  <span style={{ color: p.pass_rate > 0 ? "#4caf50" : "#888" }}>
                    {p.pass_rate.toFixed(1)}%
                  </span>
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 12 }}>
                Last run: {formatDate(p.last_run)}
              </div>
              <button
                onClick={() => router.push(`/project/${p.id}`)}
                style={{
                  width: "100%",
                  background: "#2196f3",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                  fontFamily: "monospace",
                }}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
