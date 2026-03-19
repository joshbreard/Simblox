/// <reference lib="webworker" />
import RAPIER from "@dimforge/rapier3d-compat";
import type { SimWorkerInput, SimWorkerOutput } from "@/lib/types";

let rapierReady = false;

async function ensureRapier() {
  if (!rapierReady) {
    await RAPIER.init();
    rapierReady = true;
  }
}

/** Simple LCG PRNG so each run is deterministic per seed. */
function makePrng(seed: number) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

addEventListener("message", async (e: MessageEvent<SimWorkerInput>) => {
  if (e.data.type !== "run") return;

  const { runIndex, config, randomSeed } = e.data;

  try {
    await ensureRapier();
  } catch (err) {
    postMessage({
      type: "error",
      runIndex,
      error: String(err),
    } satisfies SimWorkerOutput);
    return;
  }

  const { gravity, steps, successThreshold, bodies } = config;
  const rand = makePrng(randomSeed);

  // Slightly randomize gravity per run (±5%)
  const world = new RAPIER.World({
    x: 0,
    y: gravity * (0.95 + rand() * 0.1),
    z: 0,
  });

  const dynamicBodies: RAPIER.RigidBody[] = [];

  for (const bc of bodies) {
    if (bc.type === "fixed") {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          bc.position[0],
          bc.position[1],
          bc.position[2],
        ),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(...bc.halfExtents)
          .setRestitution(bc.restitution)
          .setFriction(bc.friction),
        body,
      );
    } else {
      // Randomize position & initial velocity for dynamic bodies
      const px = bc.position[0] + (rand() - 0.5) * 1.0;
      const py = bc.position[1] + (rand() - 0.5) * 0.5;
      const pz = bc.position[2] + (rand() - 0.5) * 1.0;

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(px, py, pz)
          .setLinvel(
            (rand() - 0.5) * 2,
            (rand() - 0.5) * 1,
            (rand() - 0.5) * 2,
          ),
      );

      const fric = bc.friction * (0.9 + rand() * 0.2);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(...bc.halfExtents)
          .setRestitution(bc.restitution)
          .setFriction(fric),
        body,
      );
      dynamicBodies.push(body);
    }
  }

  // Run simulation, track minimum COM height
  let minComHeight = Infinity;

  for (let i = 0; i < steps; i++) {
    world.step();

    if (dynamicBodies.length > 0) {
      let totalY = 0;
      for (const body of dynamicBodies) {
        totalY += body.translation().y;
      }
      const comH = totalY / dynamicBodies.length;
      if (comH < minComHeight) minComHeight = comH;
    }
  }

  // Collect final state
  const finalState = dynamicBodies.map((body) => {
    const p = body.translation();
    const v = body.linvel();
    return {
      position: [p.x, p.y, p.z] as [number, number, number],
      velocity: [v.x, v.y, v.z] as [number, number, number],
    };
  });

  world.free();

  postMessage({
    type: "result",
    runIndex,
    success: minComHeight >= successThreshold,
    minComHeight,
    steps,
    finalState,
  } satisfies SimWorkerOutput);
});
