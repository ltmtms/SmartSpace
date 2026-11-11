// Rigid-body physics (Rapier). Bodies live in the world's local space, so the whole world can be
// scaled and moved (AR table-top mode) without touching the simulation.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { localBounds, localGeometry } from './factory.js';

let initPromise = null;
export const initPhysics = () => (initPromise ||= RAPIER.init());

const STEP = 1 / 60;
const _q = new THREE.Quaternion();

export function groupsFor(layer, mask) {
  const member = 1 << (Math.max(1, Math.min(16, layer | 0)) - 1);
  let filter = 0;
  for (const l of mask || []) if (l >= 1 && l <= 16) filter |= 1 << (l - 1);
  return ((member << 16) | filter) >>> 0;
}

export class Physics {
  constructor(gravityY) {
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
    this.events = new RAPIER.EventQueue(true);
    this.byCollider = new Map(); // collider handle -> entity
    this.acc = 0;
    this.onCollision = null; // (entityA, entityB, started)
  }

  setGravity(y) { this.world.gravity = { x: 0, y, z: 0 }; this.wakeAll(); }
  wakeAll() { this.world.forEachRigidBody((b) => b.wakeUp()); }

  /** Create (or re-create) the body + collider for an entity from its object and physics settings. */
  add(entity) {
    this.remove(entity);
    const p = entity.phys, obj = entity.object, type = entity.data.type;
    if (type === 'audio' || type === 'light') return;
    const dynamic = p.dynamic && type !== 'terrain';
    // Things that are not simulated start as fixed bodies and are promoted to kinematic the first
    // time a script moves them (see step). Rapier's character controller cannot walk on kinematic
    // bodies that are standing still, so ground and buildings must stay fixed.
    const desc = dynamic ? RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true) : RAPIER.RigidBodyDesc.fixed();
    desc.setTranslation(obj.position.x, obj.position.y, obj.position.z).setRotation(obj.quaternion);
    const body = this.world.createRigidBody(desc);
    body.setGravityScale(p.gravity ? 1 : 0, false);

    const col = this.colliderDesc(entity, dynamic);
    col.setFriction(p.friction).setRestitution(p.bounciness).setMass(Math.max(0.001, p.mass))
      .setSensor(!p.solid)
      .setCollisionGroups(groupsFor(p.layer, p.mask))
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC);
    const collider = this.world.createCollider(col, body);
    entity.body = body;
    entity.collider = collider;
    entity.isDynamic = dynamic;
    entity.isKinematic = false;
    entity.colliderScale = obj.scale.clone();
    this.byCollider.set(collider.handle, entity);
  }

  colliderDesc(entity, dynamic) {
    const obj = entity.object, d = entity.data, s = obj.scale;
    const ax = Math.abs(s.x), ay = Math.abs(s.y), az = Math.abs(s.z);
    let shape = entity.phys.shape || 'auto';
    const uniform = Math.abs(ax - ay) < 1e-3 && Math.abs(ay - az) < 1e-3;
    if (d.type === 'terrain') shape = 'mesh';
    else if (shape === 'auto') {
      if (d.type === 'primitive') {
        if (d.kind === 'sphere') return uniform ? RAPIER.ColliderDesc.ball(0.5 * ax) : this.hull(obj);
        if (d.kind === 'cylinder' && Math.abs(ax - az) < 1e-3) return RAPIER.ColliderDesc.cylinder(0.5 * ay, 0.5 * ax);
        if (d.kind === 'cone' && Math.abs(ax - az) < 1e-3) return RAPIER.ColliderDesc.cone(0.5 * ay, 0.5 * ax);
        if (d.kind === 'capsule' && uniform) return RAPIER.ColliderDesc.capsule(0.2 * ax, 0.3 * ax);
        shape = d.kind === 'box' || d.kind === 'plane' ? 'box' : 'hull';
      } else shape = 'box';
    }
    if (shape === 'mesh' && dynamic) shape = 'hull'; // triangle meshes cannot be dynamic bodies
    if (shape === 'mesh') {
      const { vertices, indices } = localGeometry(obj);
      if (indices.length >= 3) return RAPIER.ColliderDesc.trimesh(vertices, indices);
      shape = 'box';
    }
    if (shape === 'hull') return this.hull(obj);
    const box = localBounds(obj);
    const c = box.getCenter(new THREE.Vector3()).multiply(s);
    const h = box.getSize(new THREE.Vector3()).multiply(s).multiplyScalar(0.5);
    const desc = shape === 'sphere'
      ? RAPIER.ColliderDesc.ball(Math.max(Math.abs(h.x), Math.abs(h.y), Math.abs(h.z)))
      : RAPIER.ColliderDesc.cuboid(Math.max(0.005, Math.abs(h.x)), Math.max(0.005, Math.abs(h.y)), Math.max(0.005, Math.abs(h.z)));
    return desc.setTranslation(c.x, c.y, c.z);
  }

  hull(obj) {
    const { vertices } = localGeometry(obj, 1500);
    return RAPIER.ColliderDesc.convexHull(vertices) || RAPIER.ColliderDesc.ball(0.5);
  }

  remove(entity) {
    if (!entity.body) return;
    this.byCollider.delete(entity.collider.handle);
    this.world.removeRigidBody(entity.body);
    entity.body = entity.collider = null;
  }

  step(dt, entities) {
    for (const e of entities) {
      if (!e.body) continue;
      const o = e.object;
      if (!o.scale.equals(e.colliderScale)) { this.add(e); continue; }
      if (e.isDynamic) {
        if (e.teleported) {
          e.body.setTranslation(o.position, true);
          e.body.setRotation(o.quaternion, true);
          e.teleported = false;
        }
      } else {
        const t = e.body.translation(), r = e.body.rotation(), q = o.quaternion;
        const moved = Math.abs(t.x - o.position.x) + Math.abs(t.y - o.position.y) + Math.abs(t.z - o.position.z) > 1e-6;
        const turned = Math.abs(r.x - q.x) + Math.abs(r.y - q.y) + Math.abs(r.z - q.z) + Math.abs(r.w - q.w) > 1e-6;
        if ((moved || turned) && !e.isKinematic) {
          e.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
          e.isKinematic = true;
        }
        if (moved) e.body.setNextKinematicTranslation(o.position);
        if (turned) e.body.setNextKinematicRotation(q);
      }
    }
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) {
      this.world.step(this.events);
      this.acc -= STEP;
      this.events.drainCollisionEvents((h1, h2, started) => {
        const a = this.byCollider.get(h1), b = this.byCollider.get(h2);
        if (a && b && this.onCollision) this.onCollision(a, b, started);
      });
    }
    for (const e of entities) {
      if (!e.body || !e.isDynamic || e.teleported) continue;
      const t = e.body.translation(), r = e.body.rotation();
      e.object.position.set(t.x, t.y, t.z);
      e.object.quaternion.copy(_q.set(r.x, r.y, r.z, r.w));
    }
  }

  /** A walking player: capsule + character controller that slides along walls and climbs small steps. */
  createPlayer(position, height = 1.7, radius = 0.35) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y + height / 2, position.z));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(height / 2 - radius, radius)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL), body);
    const ctrl = this.world.createCharacterController(0.02);
    ctrl.enableAutostep(0.45, 0.2, true);
    ctrl.enableSnapToGround(0.3);
    ctrl.setApplyImpulsesToDynamicBodies(true);
    ctrl.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.player = { body, collider, ctrl, height };
    return this.player;
  }

  /** Move the player by `delta`, return whether they are standing on something. */
  movePlayer(player, delta) {
    player.ctrl.computeColliderMovement(player.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = player.ctrl.computedMovement(), t = player.body.translation();
    player.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    return player.ctrl.computedGrounded();
  }

  dispose() {
    try {
      if (this.player) this.world.removeCharacterController(this.player.ctrl);
      this.events.free();
      this.world.free();
    } catch (e) { console.warn('physics cleanup', e); }
  }
}
