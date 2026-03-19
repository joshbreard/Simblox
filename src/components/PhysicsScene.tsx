"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  spawnURDFRobot,
  syncRobot,
  removeRobot,
  type SpawnedRobot,
} from "@/lib/urdfPhysics";
import { getSupabase } from "@/lib/supabase";
import type { PipelineConfig } from "@/lib/types";

// Singleton — calling RAPIER.init() more than once corrupts WASM state
let rapierReady: Promise<void> | null = null;
function ensureRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

interface PhysicsSceneProps {
  config?: PipelineConfig | null;
}

export default function PhysicsScene({ config }: PhysicsSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spawnRef = useRef<((xml: string) => void) | null>(null);
  const applyConfigRef = useRef<((c: PipelineConfig) => void) | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const [logStatus, setLogStatus] = useState<"idle" | "logging" | "ok" | "error">("idle");
  const runIdRef = useRef(generateUUID());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    async function init(el: HTMLDivElement) {
      await ensureRapier();
      if (disposed) return;

      const gravity = new RAPIER.Vector3(0, -9.81, 0);
      const world = new RAPIER.World(gravity);

      // ── Renderer (sized to container, not window) ────────────────
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(w, h);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);

      const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
      camera.position.set(8, 6, 8);
      camera.lookAt(0, 0, 0);

      // ── Orbit controls ───────────────────────────────────────────
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.mouseButtons = {
        LEFT: -1 as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      renderer.domElement.addEventListener("pointerdown", (e: PointerEvent) => {
        controls.mouseButtons.LEFT =
          e.button === 0 && e.altKey
            ? THREE.MOUSE.ROTATE
            : (-1 as THREE.MOUSE);
      });

      // ── Lighting ─────────────────────────────────────────────────
      scene.add(new THREE.AmbientLight(0xffffff, 0.4));

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
      dirLight.position.set(10, 15, 10);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.set(2048, 2048);
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 50;
      dirLight.shadow.camera.left = -15;
      dirLight.shadow.camera.right = 15;
      dirLight.shadow.camera.top = 15;
      dirLight.shadow.camera.bottom = -15;
      scene.add(dirLight);

      // ── Ground ───────────────────────────────────────────────────
      const groundSize = 20;
      scene.add(new THREE.GridHelper(groundSize, 20, 0x888888, 0x444444));

      const groundMesh = new THREE.Mesh(
        new THREE.BoxGeometry(groundSize, 0.1, groundSize),
        new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 })
      );
      groundMesh.position.y = -0.05;
      groundMesh.receiveShadow = true;
      scene.add(groundMesh);

      const groundBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0)
      );
      const groundCollider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(groundSize / 2, 0.05, groundSize / 2),
        groundBody
      );

      // ── Dynamic box ──────────────────────────────────────────────
      const boxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0xe94560,
          roughness: 0.4,
          metalness: 0.3,
        })
      );
      boxMesh.castShadow = true;
      boxMesh.receiveShadow = true;
      scene.add(boxMesh);

      const boxBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0)
      );
      const boxCollider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
          .setRestitution(0.3)
          .setFriction(0.7),
        boxBody
      );

      // ── Robot state ──────────────────────────────────────────────
      let currentRobot: SpawnedRobot | null = null;

      spawnRef.current = (xml: string) => {
        if (currentRobot) {
          removeRobot(currentRobot, scene, world);
          currentRobot = null;
        }
        try {
          currentRobot = spawnURDFRobot(
            xml,
            scene,
            world,
            new THREE.Vector3(0, 1, 0)
          );
        } catch (err) {
          console.error("Failed to load URDF:", err);
        }
      };

      // ── Resize (observe container, not window) ───────────────────
      const resizeObserver = new ResizeObserver(() => {
        const cw = el.clientWidth || 1;
        const ch = el.clientHeight || 1;
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
        renderer.setSize(cw, ch);
      });
      resizeObserver.observe(el);

      // ── Pipeline config application ─────────────────────────────
      applyConfigRef.current = (c: PipelineConfig) => {
        world.gravity = { x: 0, y: c.gravity, z: 0 };
        groundCollider.setFriction(c.friction);
        boxCollider.setFriction(c.friction);
        if (c.urdfXml) {
          spawnRef.current?.(c.urdfXml);
        }
      };

      // ── Supabase state logging ─────────────────────────────────
      let step = 0;
      const LOG_INTERVAL = 10;

      function serializeWorld(): object {
        const bodies: object[] = [];
        world.bodies.forEach((body: RAPIER.RigidBody) => {
          const t = body.translation();
          const r = body.rotation();
          const lv = body.linvel();
          const av = body.angvel();
          bodies.push({
            handle: body.handle,
            type: body.bodyType(),
            translation: { x: t.x, y: t.y, z: t.z },
            rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
            linvel: { x: lv.x, y: lv.y, z: lv.z },
            angvel: { x: av.x, y: av.y, z: av.z },
          });
        });
        return { bodies };
      }

      function logState(currentStep: number) {
        const sb = getSupabase();
        if (!sb) return;
        const state = serializeWorld();
        setLogStatus("logging");
        sb.from("simulation_states")
          .insert({
            run_id: runIdRef.current,
            step: currentStep,
            state,
          })
          .then(({ error }) => {
            setLogStatus(error ? "error" : "ok");
          });
      }

      // ── Animation loop ───────────────────────────────────────────
      let rafId: number;
      let alive = true;

      function animate() {
        if (!alive) return;

        world.step();
        step++;

        // Log every N steps
        if (step % LOG_INTERVAL === 0) {
          setStepCount(step);
          logState(step);
        }

        // Sync box
        const bp = boxBody.translation();
        const br = boxBody.rotation();
        boxMesh.position.set(bp.x, bp.y, bp.z);
        boxMesh.quaternion.set(br.x, br.y, br.z, br.w);

        // Sync robot
        if (currentRobot) {
          syncRobot(currentRobot);
        }

        controls.update();
        renderer.render(scene, camera);

        // Schedule next frame only after successful work
        rafId = requestAnimationFrame(animate);
      }

      rafId = requestAnimationFrame(animate);

      // ── Cleanup ──────────────────────────────────────────────────
      return () => {
        alive = false;
        disposed = true;
        cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        controls.dispose();
        renderer.dispose();
        spawnRef.current = null;
        applyConfigRef.current = null;
        if (el.contains(renderer.domElement)) {
          el.removeChild(renderer.domElement);
        }
      };
    }

    let cleanup: (() => void) | undefined;
    init(container).then((fn) => {
      cleanup = fn;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // ── Apply pipeline config from node graph ──────────────────────
  useEffect(() => {
    if (config) {
      applyConfigRef.current?.(config);
    }
  }, [config]);

  // ── Drop zone handlers ─────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      spawnRef.current?.(reader.result as string);
    };
    reader.readAsText(file);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          width: 200,
          height: 100,
          border: `2px dashed ${dragOver ? "#4fc3f7" : "#666"}`,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: dragOver
            ? "rgba(79, 195, 247, 0.15)"
            : "rgba(0, 0, 0, 0.4)",
          color: dragOver ? "#4fc3f7" : "#aaa",
          fontSize: 14,
          fontFamily: "sans-serif",
          pointerEvents: "auto",
          zIndex: 10,
          transition: "all 0.2s",
          userSelect: "none",
        }}
      >
        Drop URDF file here
      </div>
      <div
        style={{
          position: "absolute",
          top: 130,
          left: 16,
          padding: "8px 12px",
          borderRadius: 6,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          color: "#ccc",
          fontSize: 13,
          fontFamily: "monospace",
          zIndex: 10,
          lineHeight: 1.6,
          userSelect: "none",
        }}
      >
        <div>Step: {stepCount}</div>
        <div>
          Log:{" "}
          <span
            style={{
              color:
                logStatus === "ok"
                  ? "#4caf50"
                  : logStatus === "error"
                    ? "#f44336"
                    : logStatus === "logging"
                      ? "#ff9800"
                      : "#888",
            }}
          >
            {logStatus === "idle"
              ? "waiting"
              : logStatus === "logging"
                ? "writing..."
                : logStatus === "ok"
                  ? "saved"
                  : "error"}
          </span>
        </div>
        <div style={{ color: "#666", fontSize: 11 }}>
          run: {runIdRef.current.slice(0, 8)}
        </div>
      </div>
    </div>
  );
}
