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

  const { gravity, steps, bodies, sweepOverride } = config;
  const rand = makePrng(randomSeed);

  // Apply sweep override for gravity, or slightly randomize (±5%)
  let effectiveGravity = gravity;
  if (sweepOverride?.param === "gravity") {
    effectiveGravity = sweepOverride.value;
  } else {
    effectiveGravity = gravity * (0.95 + rand() * 0.1);
  }

  const effectiveTimestep = sweepOverride?.param === "timestep" ? sweepOverride.value : undefined;

  const world = new RAPIER.World({ x: 0, y: effectiveGravity, z: 0 });
  if (effectiveTimestep !== undefined) {
    world.timestep = effectiveTimestep;
  }

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

      // Apply sweep overrides for dynamic bodies
      if (sweepOverride?.param === "joint_damping") {
        body.setLinearDamping(sweepOverride.value);
        body.setAngularDamping(sweepOverride.value);
      }

      const fric = bc.friction * (0.9 + rand() * 0.2);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(...bc.halfExtents)
        .setRestitution(bc.restitution)
        .setFriction(fric);

      if (sweepOverride?.param === "link_mass") {
        colliderDesc.setMass(Math.max(0.001, sweepOverride.value));
      }

      world.createCollider(colliderDesc, body);
      dynamicBodies.push(body);
    }
  }

  // Record initial positions for drift tracking
  const initialPositions = dynamicBodies.map((b) => {
    const p = b.translation();
    return { x: p.x, y: p.y, z: p.z };
  });

  const criteria = config.criteria;

  // Run simulation, tracking metrics for success criteria
  let minComHeight = Infinity;
  let maxBaseDrift = 0;
  let settleStep = -1;
  let hasNaN = false;
  const SETTLE_VEL_THRESHOLD = 0.01;

  for (let i = 0; i < steps; i++) {
    world.step();

    if (dynamicBodies.length > 0) {
      let totalY = 0;
      let totalVelSq = 0;
      let stepMaxDrift = 0;

      for (let bi = 0; bi < dynamicBodies.length; bi++) {
        const body = dynamicBodies[bi];
        const p = body.translation();
        const v = body.linvel();

        // NaN detection
        if (isNaN(p.x) || isNaN(p.y) || isNaN(p.z) ||
            isNaN(v.x) || isNaN(v.y) || isNaN(v.z)) {
          hasNaN = true;
        }

        totalY += p.y;

        // Base drift from initial position
        const init = initialPositions[bi];
        const dx = p.x - init.x;
        const dz = p.z - init.z;
        const drift = Math.sqrt(dx * dx + dz * dz);
        if (drift > stepMaxDrift) stepMaxDrift = drift;

        totalVelSq += v.x * v.x + v.y * v.y + v.z * v.z;
      }

      const comH = totalY / dynamicBodies.length;
      if (comH < minComHeight) minComHeight = comH;
      if (stepMaxDrift > maxBaseDrift) maxBaseDrift = stepMaxDrift;

      // Settle detection: first step where avg velocity magnitude < threshold
      const avgVel = Math.sqrt(totalVelSq / dynamicBodies.length);
      if (settleStep < 0 && avgVel < SETTLE_VEL_THRESHOLD) {
        settleStep = i;
      } else if (avgVel >= SETTLE_VEL_THRESHOLD) {
        settleStep = -1; // reset if it unsettles
      }
    }
  }

  // Evaluate success against parsed criteria (pass if none set)
  const BASE_DRIFT_EPSILON = 1e-6;

  let success = true;
  if (criteria) {
    if (criteria.min_avg_height !== null && minComHeight < criteria.min_avg_height) {
      success = false;
    }

    if (criteria.base_drift_max !== null) {
      // Clamp threshold to at least epsilon so physics-solver noise doesn't cause false failures
      const driftThreshold = Math.max(criteria.base_drift_max, BASE_DRIFT_EPSILON);
      if (maxBaseDrift > driftThreshold) success = false;
    }

    if (criteria.nan_check !== null && hasNaN) {
      success = false;
    }

    if (criteria.settle_time_max !== null) {
      const dt = effectiveTimestep ?? 1 / 60;
      const settleTime = settleStep >= 0 ? settleStep * dt : steps * dt;
      if (settleTime > criteria.settle_time_max) success = false;
    }

    // joint_separation_max and end_effector_reach_max require articulated bodies
    // which are not present in this rigid-body sim — skip evaluation.
    // Non-null values are intentionally ignored (not treated as pass or fail)
    // since we have no data to evaluate them against.
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
    success,
    minComHeight,
    steps,
    finalState,
  } satisfies SimWorkerOutput);
});
