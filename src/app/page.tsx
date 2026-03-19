"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useRef } from "react";
import type { PipelineConfig } from "@/lib/types";

const PhysicsScene = dynamic(() => import("@/components/PhysicsScene"), {
  ssr: false,
});
const NodeGraph = dynamic(() => import("@/components/NodeGraph"), {
  ssr: false,
});
const BatchRunner = dynamic(() => import("@/components/BatchRunner"), {
  ssr: false,
});

const DEFAULT_W = 420;
const MIN_W = 200;
const COLLAPSE_THRESHOLD = 80;

export default function Home() {
  const [sidebarW, setSidebarW] = useState(DEFAULT_W);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const lastWRef = useRef(DEFAULT_W);

  const collapsed = sidebarW < COLLAPSE_THRESHOLD;

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

  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        cursor: dragging ? "col-resize" : undefined,
        userSelect: dragging ? "none" : undefined,
      }}
    >
      {/* ── Sidebar ─────────────────────────────────── */}
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

      {/* ── Resize handle ───────────────────────────── */}
      <div
        onPointerDown={onPointerDown}
        style={{
          position: "absolute",
          left: collapsed ? 0 : sidebarW - 3,
          top: 0,
          width: 6,
          height: "100%",
          cursor: "col-resize",
          zIndex: 40,
          transition: dragging ? "none" : "left 0.3s ease",
        }}
      />

      {/* ── Toggle button ─────────────────────────── */}
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

      {/* ── Viewport ────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative" }}>
        <PhysicsScene config={config} />
        <BatchRunner config={config} />
      </div>
    </div>
  );
}
