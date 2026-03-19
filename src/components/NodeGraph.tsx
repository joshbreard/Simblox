"use client";

import {
  useCallback,
  useRef,
  createContext,
  useContext,
  type CSSProperties,
} from "react";
import ReactFlow, {
  Controls,
  Background,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { PipelineConfig } from "@/lib/types";

// ── Context for child nodes ────────────────────────────────────

interface GraphCtx {
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  executePipeline: () => void;
}

const GraphContext = createContext<GraphCtx>({
  updateNodeData: () => {},
  executePipeline: () => {},
});

// ── Shared node styles ─────────────────────────────────────────

const base = (c: string): CSSProperties => ({
  background: "#1e1e2e",
  border: `2px solid ${c}`,
  borderRadius: 8,
  minWidth: 180,
  fontSize: 12,
  fontFamily: "sans-serif",
  color: "#ddd",
});

const header = (bg: string, light = false): CSSProperties => ({
  background: bg,
  padding: "6px 10px",
  borderRadius: "6px 6px 0 0",
  fontWeight: 600,
  fontSize: 13,
  color: light ? "#222" : "#fff",
});

const body: CSSProperties = { padding: "8px 10px" };

const handleStyle: CSSProperties = {
  width: 10,
  height: 10,
  background: "#888",
  border: "2px solid #555",
};

// ── Custom nodes ───────────────────────────────────────────────

function PhysicsSceneNode({ isConnectable }: NodeProps) {
  return (
    <div style={base("#4caf50")}>
      <div style={header("#4caf50")}>Physics Scene</div>
      <div style={body}>
        <div style={{ color: "#999", marginBottom: 2 }}>Entry point</div>
        <div>Ground plane + lighting</div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        style={handleStyle}
      />
    </div>
  );
}

function URDFLoaderNode({ id, data, isConnectable }: NodeProps) {
  const { updateNodeData } = useContext(GraphContext);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateNodeData(id, {
        urdfXml: reader.result as string,
        filename: file.name,
      });
    };
    reader.readAsText(file);
  };

  return (
    <div style={base("#9c27b0")}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        style={handleStyle}
      />
      <div style={header("#9c27b0")}>URDF Loader</div>
      <div style={body}>
        <label
          className="nodrag nopan"
          style={{
            display: "block",
            padding: "6px 8px",
            background: "#2a2a3e",
            border: "1px dashed #666",
            borderRadius: 4,
            textAlign: "center",
            cursor: "pointer",
            color: data.filename ? "#ce93d8" : "#888",
            fontSize: 11,
          }}
        >
          {(data.filename as string) || "Choose .urdf file…"}
          <input
            type="file"
            accept=".urdf,.xml"
            onChange={handleFile}
            style={{ display: "none" }}
          />
        </label>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        style={handleStyle}
      />
    </div>
  );
}

function PhysicsPresetNode({ id, data, isConnectable }: NodeProps) {
  const { updateNodeData } = useContext(GraphContext);
  const gravity = (data.gravity as number) ?? -9.81;
  const friction = (data.friction as number) ?? 0.7;

  return (
    <div style={base("#ffc107")}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        style={handleStyle}
      />
      <div style={header("#ffc107", true)}>Physics Preset</div>
      <div style={body}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Gravity</span>
            <span style={{ color: "#ffc107" }}>{gravity.toFixed(1)}</span>
          </div>
          <input
            className="nodrag nopan"
            type="range"
            min={-20}
            max={0}
            step={0.1}
            value={gravity}
            onChange={(e) =>
              updateNodeData(id, { gravity: parseFloat(e.target.value) })
            }
            style={{ width: "100%", accentColor: "#ffc107" }}
          />
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Friction</span>
            <span style={{ color: "#ffc107" }}>{friction.toFixed(2)}</span>
          </div>
          <input
            className="nodrag nopan"
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={friction}
            onChange={(e) =>
              updateNodeData(id, { friction: parseFloat(e.target.value) })
            }
            style={{ width: "100%", accentColor: "#ffc107" }}
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        style={handleStyle}
      />
    </div>
  );
}

function SceneOutputNode({ isConnectable }: NodeProps) {
  const { executePipeline } = useContext(GraphContext);

  return (
    <div style={base("#f44336")}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        style={handleStyle}
      />
      <div style={header("#f44336")}>Scene Output</div>
      <div style={body}>
        <button
          className="nodrag nopan"
          onClick={executePipeline}
          style={{
            width: "100%",
            padding: "7px 0",
            background: "#f44336",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          ▶ Run Pipeline
        </button>
      </div>
    </div>
  );
}

// Must be stable (defined outside component) so React Flow doesn't
// re-mount nodes on every render.
const nodeTypes = {
  physicsScene: PhysicsSceneNode,
  urdfLoader: URDFLoaderNode,
  physicsPreset: PhysicsPresetNode,
  sceneOutput: SceneOutputNode,
};

// ── Default graph ──────────────────────────────────────────────

const initialNodes: Node[] = [
  {
    id: "physics-scene",
    type: "physicsScene",
    position: { x: 0, y: 80 },
    data: {},
  },
  {
    id: "urdf-loader",
    type: "urdfLoader",
    position: { x: 260, y: 80 },
    data: { urdfXml: null, filename: null },
  },
  {
    id: "physics-preset",
    type: "physicsPreset",
    position: { x: 520, y: 60 },
    data: { gravity: -9.81, friction: 0.7 },
  },
  {
    id: "scene-output",
    type: "sceneOutput",
    position: { x: 780, y: 100 },
    data: {},
  },
];

const initialEdges: Edge[] = [
  {
    id: "e1",
    source: "physics-scene",
    target: "urdf-loader",
    animated: true,
    style: { stroke: "#4caf50" },
  },
  {
    id: "e2",
    source: "urdf-loader",
    target: "physics-preset",
    animated: true,
    style: { stroke: "#9c27b0" },
  },
  {
    id: "e3",
    source: "physics-preset",
    target: "scene-output",
    animated: true,
    style: { stroke: "#ffc107" },
  },
];

// ── Main component ─────────────────────────────────────────────

interface NodeGraphProps {
  onExecute: (config: PipelineConfig) => void;
}

export default function NodeGraph({ onExecute }: NodeGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep live refs so the pipeline callback always reads current state
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const updateNodeData = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
        )
      );
    },
    [setNodes]
  );

  const executePipeline = useCallback(() => {
    const nodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));
    const visited = new Set<string>();

    function traverse(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      for (const e of edgesRef.current) {
        if (e.target === id) traverse(e.source);
      }
    }
    traverse("scene-output");

    const cfg: PipelineConfig = { gravity: -9.81, friction: 0.7 };
    for (const id of visited) {
      const node = nodeMap.get(id);
      if (!node) continue;
      if (node.type === "physicsPreset") {
        cfg.gravity = (node.data.gravity as number) ?? -9.81;
        cfg.friction = (node.data.friction as number) ?? 0.7;
      }
      if (node.type === "urdfLoader" && node.data.urdfXml) {
        cfg.urdfXml = node.data.urdfXml as string;
      }
    }

    onExecute(cfg);
  }, [onExecute]);

  const onConnect = useCallback(
    (conn: Connection) =>
      setEdges((eds) => addEdge({ ...conn, animated: true }, eds)),
    [setEdges]
  );

  return (
    <GraphContext.Provider value={{ updateNodeData, executePipeline }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        defaultEdgeOptions={{ style: { stroke: "#555" } }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "#111118" }}
      >
        <Controls
          style={{ background: "#1e1e2e", borderRadius: 6, borderColor: "#333" }}
        />
        <Background variant={BackgroundVariant.Dots} color="#333" gap={20} />
      </ReactFlow>
    </GraphContext.Provider>
  );
}
