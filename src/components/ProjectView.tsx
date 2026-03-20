"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import type { PipelineConfig } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";

const PhysicsScene = dynamic(() => import("@/components/PhysicsScene"), {
  ssr: false,
});
const NodeGraph = dynamic(() => import("@/components/NodeGraph"), {
  ssr: false,
});
const BatchRunner = dynamic(() => import("@/components/BatchRunner"), {
  ssr: false,
});
const MLTrainingPanel = dynamic(
  () => import("@/components/MLTrainingPanel"),
  { ssr: false }
);

const DEFAULT_W = 420;
const MIN_W = 200;
const COLLAPSE_THRESHOLD = 80;

const RIGHT_DEFAULT_W = 360;
const RIGHT_MIN_W = 200;

export default function ProjectView({ projectId }: { projectId: string }) {
  /* ── Left sidebar state ──────────────────────── */
  const [sidebarW, setSidebarW] = useState(DEFAULT_W);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const lastWRef = useRef(DEFAULT_W);
  const [projectName, setProjectName] = useState("");

  const collapsed = sidebarW < COLLAPSE_THRESHOLD;

  /* ── Right panel state ───────────────────────── */
  const [rightPanelW, setRightPanelW] = useState(RIGHT_DEFAULT_W);
  const [rightDragging, setRightDragging] = useState(false);
  const rightStartXRef = useRef(0);
  const rightStartWRef = useRef(0);
  const rightLastWRef = useRef(RIGHT_DEFAULT_W);

  const rightCollapsed = rightPanelW < COLLAPSE_THRESHOLD;

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("projects")
      .select("name")
      .eq("id", projectId)
      .single()
      .then(({ data }) => {
        if (data) setProjectName(data.name);
      });
  }, [projectId]);

  /* ── Left sidebar drag ───────────────────────── */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWRef.current = sidebarW;
      setDragging(true);

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startXRef.current;
        const next = startWRef.current + delta;
        if (next >= MIN_W) lastWRef.current = Math.max(MIN_W, next);
        setSidebarW(
          next < COLLAPSE_THRESHOLD ? 0 : Math.max(MIN_W, next)
        );
      };

      const onUp = () => {
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [sidebarW]
  );

  const toggle = useCallback(() => {
    setSidebarW((w) => {
      if (w >= COLLAPSE_THRESHOLD) lastWRef.current = w;
      return w < COLLAPSE_THRESHOLD ? lastWRef.current : 0;
    });
  }, []);

  /* ── Right panel drag ────────────────────────── */
  const onRightPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      rightStartXRef.current = e.clientX;
      rightStartWRef.current = rightPanelW;
      setRightDragging(true);

      const onMove = (ev: PointerEvent) => {
        // Dragging left increases width, dragging right decreases
        const delta = rightStartXRef.current - ev.clientX;
        const next = rightStartWRef.current + delta;
        if (next >= RIGHT_MIN_W)
          rightLastWRef.current = Math.max(RIGHT_MIN_W, next);
        setRightPanelW(
          next < COLLAPSE_THRESHOLD ? 0 : Math.max(RIGHT_MIN_W, next)
        );
      };

      const onUp = () => {
        setRightDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [rightPanelW]
  );

  const rightToggle = useCallback(() => {
    setRightPanelW((w) => {
      if (w >= COLLAPSE_THRESHOLD) rightLastWRef.current = w;
      return w < COLLAPSE_THRESHOLD ? rightLastWRef.current : 0;
    });
  }, []);

  const anyDragging = dragging || rightDragging;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh", overflow: "hidden" }}>
      {/* ── Project header bar ─────────────────────────── */}
      <div
        style={{
          height: 36,
          flexShrink: 0,
          background: "#111118",
          borderBottom: "1px solid #333",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          fontFamily: "monospace",
          fontSize: 13,
          gap: 12,
        }}
      >
        <Link
          href="/"
          style={{
            color: "#2196f3",
            textDecoration: "none",
            fontSize: 12,
          }}
        >
          Back to Projects
        </Link>
        <span style={{ color: "#444" }}>|</span>
        <span style={{ color: "#fff", fontWeight: 600 }}>{projectName}</span>
      </div>

      {/* ── Main layout ────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          cursor: anyDragging ? "col-resize" : undefined,
          userSelect: anyDragging ? "none" : undefined,
        }}
      >
        {/* ── Left Sidebar ──────────────────────────────── */}
        <div
          style={{
            width: collapsed ? 0 : sidebarW,
            flexShrink: 0,
            overflow: "hidden",
            transition: dragging ? "none" : "width 0.3s ease",
            background: "#111118",
            borderRight: collapsed ? "none" : "1px solid #333",
          }}
        >
          <div style={{ width: Math.max(sidebarW, MIN_W), height: "100%" }}>
            <NodeGraph onExecute={setConfig} />
          </div>
        </div>

        {/* ── Left Resize handle ────────────────────────── */}
        <div
          onPointerDown={onPointerDown}
          style={{
            position: "absolute",
            left: collapsed ? 0 : sidebarW - 3,
            top: 36,
            width: 6,
            height: "calc(100% - 36px)",
            cursor: "col-resize",
            zIndex: 40,
            transition: dragging ? "none" : "left 0.3s ease",
          }}
        />

        {/* ── Left Toggle button ──────────────────────── */}
        <button
          onClick={toggle}
          style={{
            position: "absolute",
            left: collapsed ? 0 : sidebarW,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 50,
            background: "#222",
            color: "#aaa",
            border: "1px solid #444",
            borderLeft: "none",
            borderRadius: "0 4px 4px 0",
            padding: "12px 5px",
            cursor: "pointer",
            fontSize: 12,
            lineHeight: 1,
            transition: dragging ? "none" : "left 0.3s ease",
          }}
        >
          {collapsed ? "\u25B6" : "\u25C0"}
        </button>

        {/* ── Viewport ──────────────────────────────────── */}
        <div style={{ flex: 1, position: "relative" }}>
          <PhysicsScene config={config} />
          <BatchRunner config={config} projectId={projectId} />
        </div>

        {/* ── Right Resize handle ───────────────────────── */}
        <div
          onPointerDown={onRightPointerDown}
          style={{
            position: "absolute",
            right: rightCollapsed ? 0 : rightPanelW - 3,
            top: 36,
            width: 6,
            height: "calc(100% - 36px)",
            cursor: "col-resize",
            zIndex: 40,
            transition: rightDragging ? "none" : "right 0.3s ease",
          }}
        />

        {/* ── Right Toggle button ─────────────────────── */}
        <button
          onClick={rightToggle}
          style={{
            position: "absolute",
            right: rightCollapsed ? 0 : rightPanelW,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 50,
            background: "#222",
            color: "#aaa",
            border: "1px solid #444",
            borderRight: "none",
            borderRadius: "4px 0 0 4px",
            padding: "12px 5px",
            cursor: "pointer",
            fontSize: 12,
            lineHeight: 1,
            transition: rightDragging ? "none" : "right 0.3s ease",
          }}
        >
          {rightCollapsed ? "\u25C0" : "\u25B6"}
        </button>

        {/* ── Right Panel (ML Training) ─────────────────── */}
        <div
          style={{
            width: rightCollapsed ? 0 : rightPanelW,
            flexShrink: 0,
            overflow: "hidden",
            transition: rightDragging ? "none" : "width 0.3s ease",
            background: "#111118",
            borderLeft: rightCollapsed ? "none" : "1px solid #333",
            position: "relative",
          }}
        >
          <div
            style={{
              width: Math.max(rightPanelW, RIGHT_MIN_W),
              height: "100%",
            }}
          >
            <MLTrainingPanel projectId={projectId} />
          </div>
        </div>
      </div>
    </div>
  );
}
