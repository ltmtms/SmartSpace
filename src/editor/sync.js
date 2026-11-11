// Keeps the three.js scene in step with the shared document (local edits and collaborators' alike).
import { buildObject, buildKey, applyTransform, applyLook, disposeObject } from '../engine/factory.js';

export class SceneSync {
  constructor(world, view, ctx) {
    this.world = world;
    this.view = view;
    this.ctx = ctx;
    this.entries = new Map(); // id -> { data, object, key }
    this.paused = false; // true while playing: the runtime owns the objects
    this.listeners = new Set();
    this.observer = (events) => {
      const ids = new Set();
      let structural = false;
      for (const ev of events) {
        if (ev.path.length === 0) { ev.changes.keys.forEach((_, id) => ids.add(id)); structural = true; } else if (ev.path[1] !== 'js' && ev.path[1] !== 'py') ids.add(ev.path[0]);
      }
      if (this.paused) { this.dirty = true; return; }
      for (const id of ids) this.apply(id);
      if (ids.size) this.emit([...ids], structural);
    };
  }
  start() {
    for (const id of this.world.objects.keys()) this.apply(id);
    this.world.objects.observeDeep(this.observer);
    this.emit([...this.entries.keys()], true);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ids, structural) { for (const fn of this.listeners) fn(ids, structural); }

  apply(id) {
    const data = this.world.data(id);
    let entry = this.entries.get(id);
    if (!data) {
      if (entry) { entry.object.removeFromParent(); disposeObject(entry.object); this.entries.delete(id); }
      return;
    }
    const key = buildKey(data);
    if (!entry || entry.key !== key) {
      const object = buildObject(data, this.ctx);
      object.userData.id = id;
      if (entry) { entry.object.removeFromParent(); disposeObject(entry.object); }
      this.view.worldRoot.add(object);
      entry = { object, key };
      this.entries.set(id, entry);
    }
    entry.data = data;
    applyTransform(entry.object, data);
    applyLook(entry.object, data);
  }

  /** Throw away every object and rebuild from the document (used when play mode stops). */
  rebuildAll() {
    for (const e of this.entries.values()) { e.object.removeFromParent(); disposeObject(e.object); }
    this.entries.clear();
    for (const id of this.world.objects.keys()) this.apply(id);
    this.dirty = false;
    this.emit([...this.entries.keys()], true);
  }

  /** Find which world object a raycast hit belongs to. */
  idOf(object3d) {
    let o = object3d;
    while (o && !o.userData.id) o = o.parent;
    return o?.userData.id || null;
  }
  dispose() {
    this.world.objects.unobserveDeep(this.observer);
    for (const e of this.entries.values()) disposeObject(e.object);
    this.entries.clear();
  }
}
