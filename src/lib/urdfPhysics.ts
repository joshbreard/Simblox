import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import URDFLoader, { URDFRobot, URDFJoint, URDFLink } from "urdf-loader";

// ── Parsed XML types ───────────────────────────────────────────

interface ParsedGeometry {
  type: "box" | "cylinder" | "sphere" | "mesh";
  size?: [number, number, number];
  radius?: number;
  length?: number;
}

interface ParsedOrigin {
  xyz: [number, number, number];
  rpy: [number, number, number];
}

interface ParsedVisual {
  geometry: ParsedGeometry;
  origin?: ParsedOrigin;
  color?: [number, number, number, number];
}

interface ParsedInertial {
  mass: number;
  origin?: ParsedOrigin;
}

interface ParsedLinkData {
  name: string;
  inertial?: ParsedInertial;
  visuals: ParsedVisual[];
  collisions: ParsedVisual[];
}

export interface RobotLinkRuntime {
  name: string;
  group: THREE.Group;
  body: RAPIER.RigidBody;
}

export interface SpawnedRobot {
  links: RobotLinkRuntime[];
  rootGroup: THREE.Group;
}

// ── XML parsing helpers ────────────────────────────────────────

function parseFloats(str: string): number[] {
  return str.trim().split(/\s+/).map(Number);
}

function parseOriginEl(parentEl: Element): ParsedOrigin | undefined {
  const el = parentEl.querySelector(":scope > origin");
  if (!el) return undefined;
  return {
    xyz: parseFloats(el.getAttribute("xyz") || "0 0 0") as [number, number, number],
    rpy: parseFloats(el.getAttribute("rpy") || "0 0 0") as [number, number, number],
  };
}

function parseGeometryEl(geoEl: Element): ParsedGeometry | null {
  const box = geoEl.querySelector("box");
  if (box) {
    return {
      type: "box",
      size: parseFloats(box.getAttribute("size") || "0.1 0.1 0.1") as [number, number, number],
    };
  }
  const cyl = geoEl.querySelector("cylinder");
  if (cyl) {
    return {
      type: "cylinder",
      radius: parseFloat(cyl.getAttribute("radius") || "0.01"),
      length: parseFloat(cyl.getAttribute("length") || "0.1"),
    };
  }
  const sph = geoEl.querySelector("sphere");
  if (sph) {
    return {
      type: "sphere",
      radius: parseFloat(sph.getAttribute("radius") || "0.01"),
    };
  }
  if (geoEl.querySelector("mesh")) {
    return { type: "mesh" };
  }
  return null;
}

function parseMaterialColor(
  visualEl: Element,
  doc: Document
): [number, number, number, number] | undefined {
  const matEl = visualEl.querySelector(":scope > material");
  if (!matEl) return undefined;

  const colorEl = matEl.querySelector("color");
  if (colorEl) {
    return parseFloats(
      colorEl.getAttribute("rgba") || "0.5 0.5 0.5 1"
    ) as [number, number, number, number];
  }

  // Named material at <robot> level
  const matName = matEl.getAttribute("name");
  if (matName) {
    for (const m of Array.from(doc.querySelectorAll("robot > material"))) {
      if (m.getAttribute("name") === matName) {
        const c = m.querySelector("color");
        if (c) {
          return parseFloats(
            c.getAttribute("rgba") || "0.5 0.5 0.5 1"
          ) as [number, number, number, number];
        }
      }
    }
  }
  return undefined;
}

function parseURDFXml(xml: string): Map<string, ParsedLinkData> {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const result = new Map<string, ParsedLinkData>();

  for (const linkEl of Array.from(doc.querySelectorAll("link"))) {
    const name = linkEl.getAttribute("name") || "";

    let inertial: ParsedInertial | undefined;
    const inertialEl = linkEl.querySelector(":scope > inertial");
    if (inertialEl) {
      const massEl = inertialEl.querySelector("mass");
      inertial = {
        mass: massEl ? parseFloat(massEl.getAttribute("value") || "1") : 1,
        origin: parseOriginEl(inertialEl),
      };
    }

    const visuals: ParsedVisual[] = [];
    for (const v of Array.from(linkEl.querySelectorAll(":scope > visual"))) {
      const geoEl = v.querySelector("geometry");
      if (!geoEl) continue;
      const geometry = parseGeometryEl(geoEl);
      if (!geometry) continue;
      visuals.push({
        geometry,
        origin: parseOriginEl(v),
        color: parseMaterialColor(v, doc),
      });
    }

    const collisions: ParsedVisual[] = [];
    for (const c of Array.from(linkEl.querySelectorAll(":scope > collision"))) {
      const geoEl = c.querySelector("geometry");
      if (!geoEl) continue;
      const geometry = parseGeometryEl(geoEl);
      if (!geometry) continue;
      collisions.push({ geometry, origin: parseOriginEl(c) });
    }

    result.set(name, { name, inertial, visuals, collisions });
  }

  return result;
}

// ── Geometry / quaternion helpers ──────────────────────────────

function rpyToQuaternion(r: number, p: number, y: number): THREE.Quaternion {
  // URDF RPY = extrinsic XYZ = intrinsic ZYX
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, "ZYX"));
}

function colorFromName(name: string): THREE.Color {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = (((hash % 360) + 360) % 360) / 360;
  return new THREE.Color().setHSL(hue, 0.55, 0.5);
}

function makeThreeGeometry(geo: ParsedGeometry): THREE.BufferGeometry {
  switch (geo.type) {
    case "box":
      return new THREE.BoxGeometry(...(geo.size || [0.1, 0.1, 0.1]));
    case "cylinder": {
      const g = new THREE.CylinderGeometry(
        geo.radius!,
        geo.radius!,
        geo.length!,
        16
      );
      // URDF cylinder axis = Z, Three.js cylinder axis = Y → rotate -90° about X
      g.rotateX(Math.PI / 2);
      return g;
    }
    case "sphere":
      return new THREE.SphereGeometry(geo.radius || 0.01, 16, 16);
    default:
      return new THREE.SphereGeometry(0.02, 8, 8);
  }
}

function createLinkVisual(link: ParsedLinkData): THREE.Group {
  const group = new THREE.Group();
  const shapes = link.visuals.length > 0 ? link.visuals : link.collisions;

  if (shapes.length === 0) {
    // Joint marker for links without geometry
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffff00 })
      )
    );
    return group;
  }

  for (const shape of shapes) {
    const geo = makeThreeGeometry(shape.geometry);
    const color = shape.color
      ? new THREE.Color(shape.color[0], shape.color[1], shape.color[2])
      : colorFromName(link.name);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (shape.origin) {
      mesh.position.set(...shape.origin.xyz);
      mesh.quaternion.copy(rpyToQuaternion(...shape.origin.rpy));
    }
    group.add(mesh);
  }

  return group;
}

// ── Rapier collider from URDF geometry ─────────────────────────

// Quaternion that rotates URDF Z-axis cylinder to Rapier Y-axis cylinder
const CYLINDER_FIX = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI / 2, 0, 0)
);

function createColliderDesc(
  geo: ParsedGeometry,
  origin?: ParsedOrigin
): RAPIER.ColliderDesc {
  let desc: RAPIER.ColliderDesc;

  switch (geo.type) {
    case "box":
      desc = RAPIER.ColliderDesc.cuboid(
        (geo.size?.[0] || 0.1) / 2,
        (geo.size?.[1] || 0.1) / 2,
        (geo.size?.[2] || 0.1) / 2
      );
      break;
    case "cylinder":
      desc = RAPIER.ColliderDesc.cylinder(
        (geo.length || 0.1) / 2,
        geo.radius || 0.01
      );
      break;
    case "sphere":
      desc = RAPIER.ColliderDesc.ball(geo.radius || 0.01);
      break;
    default:
      desc = RAPIER.ColliderDesc.ball(0.02);
      break;
  }

  // Apply origin transform and cylinder axis correction
  const q = origin ? rpyToQuaternion(...origin.rpy) : new THREE.Quaternion();
  if (geo.type === "cylinder") {
    q.multiply(CYLINDER_FIX);
  }

  if (origin) {
    desc.setTranslation(origin.xyz[0], origin.xyz[1], origin.xyz[2]);
  }
  desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });

  return desc;
}

// ── Main spawn function ────────────────────────────────────────

export function spawnURDFRobot(
  xml: string,
  scene: THREE.Scene,
  world: RAPIER.World,
  spawnOffset: THREE.Vector3
): SpawnedRobot {
  // 1. Parse raw XML for inertial + geometry data
  const linkDataMap = parseURDFXml(xml);

  // 2. Parse with URDFLoader for kinematic chain / world transforms
  const loader = new URDFLoader();
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    onLoad(new THREE.Group());
  };
  const robot: URDFRobot = loader.parse(xml);

  // 3. Place robot in a temp group to compute world matrices
  const tempGroup = new THREE.Group();
  tempGroup.position.copy(spawnOffset);
  tempGroup.add(robot);
  scene.add(tempGroup);
  tempGroup.updateWorldMatrix(true, true);

  // 4. Identify root link (not a child of any joint)
  const childLinkNames = new Set<string>();
  for (const joint of Object.values(robot.joints)) {
    for (const child of joint.children) {
      if ((child as unknown as URDFLink).isURDFLink) {
        childLinkNames.add((child as unknown as URDFLink).urdfName);
      }
    }
  }
  const rootLinkName = Object.keys(robot.links).find(
    (n) => !childLinkNames.has(n)
  );

  // 5. Create Rapier bodies + Three.js visuals per link
  const bodies = new Map<string, RAPIER.RigidBody>();
  const runtimeLinks: RobotLinkRuntime[] = [];
  const rootGroup = new THREE.Group();

  for (const [name, urdfLink] of Object.entries(robot.links)) {
    const linkData = linkDataMap.get(name);
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    urdfLink.getWorldPosition(worldPos);
    urdfLink.getWorldQuaternion(worldQuat);

    // Body — root link is fixed, others are dynamic
    const isRoot = name === rootLinkName;
    const bodyDesc = isRoot
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic();

    bodyDesc.setTranslation(worldPos.x, worldPos.y, worldPos.z);
    bodyDesc.setRotation({
      x: worldQuat.x,
      y: worldQuat.y,
      z: worldQuat.z,
      w: worldQuat.w,
    });

    if (!isRoot) {
      bodyDesc.setLinearDamping(0.5);
      bodyDesc.setAngularDamping(1.0);
    }

    const body = world.createRigidBody(bodyDesc);

    // Colliders from collision geometry (fallback to visual, then default)
    if (linkData) {
      const shapes =
        linkData.collisions.length > 0
          ? linkData.collisions
          : linkData.visuals;
      const mass = linkData.inertial?.mass ?? 1.0;

      if (shapes.length > 0) {
        for (const shape of shapes) {
          const cd = createColliderDesc(shape.geometry, shape.origin);
          cd.setMass(mass / shapes.length);
          cd.setRestitution(0.1);
          cd.setFriction(0.5);
          world.createCollider(cd, body);
        }
      } else {
        world.createCollider(
          RAPIER.ColliderDesc.ball(0.02).setMass(mass),
          body
        );
      }
    } else {
      world.createCollider(
        RAPIER.ColliderDesc.ball(0.02).setMass(0.1),
        body
      );
    }

    // Visual
    const visual = createLinkVisual(
      linkData || { name, visuals: [], collisions: [] }
    );
    visual.position.copy(worldPos);
    visual.quaternion.copy(worldQuat);
    rootGroup.add(visual);

    bodies.set(name, body);
    runtimeLinks.push({ name, group: visual, body });
  }

  // 6. Create Rapier joints
  for (const joint of Object.values(robot.joints)) {
    const parentLink = joint.parent as unknown as URDFLink | null;
    if (!parentLink?.isURDFLink) continue;

    const childLink = joint.children.find(
      (c) => (c as unknown as URDFLink).isURDFLink
    ) as URDFLink | undefined;
    if (!childLink) continue;

    const parentBody = bodies.get(parentLink.urdfName);
    const childBody = bodies.get(childLink.urdfName);
    if (!parentBody || !childBody) continue;

    // World transforms
    const jointWorldPos = new THREE.Vector3();
    const jointWorldQuat = new THREE.Quaternion();
    joint.getWorldPosition(jointWorldPos);
    joint.getWorldQuaternion(jointWorldQuat);

    const parentWorldPos = new THREE.Vector3();
    const parentWorldQuat = new THREE.Quaternion();
    parentLink.getWorldPosition(parentWorldPos);
    parentLink.getWorldQuaternion(parentWorldQuat);
    const parentInvQuat = parentWorldQuat.clone().invert();

    const childWorldPos = new THREE.Vector3();
    const childWorldQuat = new THREE.Quaternion();
    childLink.getWorldPosition(childWorldPos);
    childLink.getWorldQuaternion(childWorldQuat);
    const childInvQuat = childWorldQuat.clone().invert();

    // Anchors in each body's local frame
    const anchor1 = jointWorldPos
      .clone()
      .sub(parentWorldPos)
      .applyQuaternion(parentInvQuat);
    const anchor2 = jointWorldPos
      .clone()
      .sub(childWorldPos)
      .applyQuaternion(childInvQuat);

    const a1 = { x: anchor1.x, y: anchor1.y, z: anchor1.z };
    const a2 = { x: anchor2.x, y: anchor2.y, z: anchor2.z };

    // Axis in parent body's local frame
    const worldAxis = joint.axis
      .clone()
      .applyQuaternion(jointWorldQuat)
      .normalize();
    const localAxis = worldAxis.clone().applyQuaternion(parentInvQuat);
    const axisVec = { x: localAxis.x, y: localAxis.y, z: localAxis.z };

    let jointData: RAPIER.JointData;

    switch (joint.jointType) {
      case "fixed": {
        const f1 = jointWorldQuat.clone().premultiply(parentInvQuat);
        const f2 = jointWorldQuat.clone().premultiply(childInvQuat);
        jointData = RAPIER.JointData.fixed(
          a1,
          { x: f1.x, y: f1.y, z: f1.z, w: f1.w },
          a2,
          { x: f2.x, y: f2.y, z: f2.z, w: f2.w }
        );
        break;
      }
      case "revolute":
      case "continuous":
        jointData = RAPIER.JointData.revolute(a1, a2, axisVec);
        break;
      case "prismatic":
        jointData = RAPIER.JointData.prismatic(a1, a2, axisVec);
        break;
      default:
        // Fallback to fixed for unsupported types (planar, floating)
        jointData = RAPIER.JointData.fixed(
          a1,
          { x: 0, y: 0, z: 0, w: 1 },
          a2,
          { x: 0, y: 0, z: 0, w: 1 }
        );
    }

    const impulseJoint = world.createImpulseJoint(
      jointData,
      parentBody,
      childBody,
      true
    );

    // Apply limits for revolute / prismatic joints
    if (
      (joint.jointType === "revolute" ||
        joint.jointType === "prismatic") &&
      joint.limit
    ) {
      const lo = joint.limit.lower;
      const hi = joint.limit.upper;
      if (lo < hi) {
        try {
          (impulseJoint as RAPIER.RevoluteImpulseJoint).setLimits(lo, hi);
        } catch {
          // joint type may not support setLimits
        }
      }
    }
  }

  // 7. Cleanup temp group; add visual group to scene
  scene.remove(tempGroup);
  scene.add(rootGroup);

  return { links: runtimeLinks, rootGroup };
}

// ── Per-frame sync ─────────────────────────────────────────────

export function syncRobot(robot: SpawnedRobot): void {
  for (const link of robot.links) {
    const pos = link.body.translation();
    const rot = link.body.rotation();
    link.group.position.set(pos.x, pos.y, pos.z);
    link.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }
}

// ── Removal ────────────────────────────────────────────────────

export function removeRobot(
  robot: SpawnedRobot,
  scene: THREE.Scene,
  world: RAPIER.World
): void {
  scene.remove(robot.rootGroup);
  for (const link of robot.links) {
    world.removeRigidBody(link.body);
  }
}
