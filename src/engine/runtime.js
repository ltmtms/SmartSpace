// Play mode: runs physics, scripts, input and sound against the live three.js objects.
// Nothing here writes to the shared document, so pressing Stop restores the world exactly.
import * as THREE from 'three';
import { DEFAULT_PHYSICS, DEFAULT_SETTINGS } from '../../shared/schema.js';
import { buildObject, applyTransform, applyLook, disposeObject, localBounds, PRIMITIVES } from './factory.js';
import { ASSET_BY_ID } from './assets.js';
import { Physics, initPhysics } from './physics.js';
import { Sounds } from './sounds.js';
import { PlayerController } from './player.js';

const DEG = Math.PI / 180;
const AsyncFunction = (async () => {}).constructor;
// Names hidden from student scripts. This prevents accidents (and casual mischief);
// it is not a security sandbox - see README "Script safety".
const SHADOWED = ['window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location', 'history', 'open', 'alert', 'confirm', 'prompt', 'importScripts', 'Worker', 'Function'];

const normKey = (k) => {
  k = String(k).toLowerCase();
  if (k === ' ' || k === 'spacebar') return 'space';
  return k.replace(/^arrow/, '');
};
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const unwrap = (v) => (v && typeof v.toJs === 'function' ? v.toJs() : v); // Python lists -> JS arrays

function vec3Proxy(get, set) {
  const p = {};
  ['x', 'y', 'z'].forEach((k, i) => Object.defineProperty(p, k, {
    enumerable: true,
    get: () => get()[i],
    set: (v) => { const a = get(); a[i] = num(v, a[i]); set(a[0], a[1], a[2]); },
  }));
  p.toString = () => `(${get().map((n) => +n.toFixed(2)).join(', ')})`;
  return p;
}

function makeBubble(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 44px system-ui, sans-serif';
  ctx.font = font;
  const lines = String(text).split('\n').slice(0, 4);
  const w = Math.min(1000, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 56);
  const h = lines.length * 56 + 36;
  canvas.width = w; canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, 24);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111827';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, 28, 46 + i * 56, w - 56));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(w / 220, h / 220, 1);
  sprite.renderOrder = 999;
  return sprite;
}

// ------------------------------------------------------------------ Entity (what scripts call `me`)
export class Entity {
  constructor(rt, id, data, object) {
    this._rt = rt;
    this.id = id;
    this.data = data;
    this.object = object;
    this.phys = { ...DEFAULT_PHYSICS, ...(data.physics || {}) };
    this.touching = new Set();
    this.alive = true;
    this._anims = new Map();
    this.position = vec3Proxy(() => object.position.toArray(), (x, y, z) => this.setPosition(x, y, z));
    this.rotation = vec3Proxy(() => [object.rotation.x / DEG, object.rotation.y / DEG, object.rotation.z / DEG], (x, y, z) => this.setRotation(x, y, z));
    this.velocity = vec3Proxy(() => { const v = this.body?.linvel(); return v ? [v.x, v.y, v.z] : [0, 0, 0]; }, (x, y, z) => this.setVelocity(x, y, z));
  }
  get name() { return this.data.name; }
  set name(v) { this.data = { ...this.data, name: String(v) }; }
  get isPlayer() { return false; }
  toString() { return this.name; }

  // ---- motion
  get x() { return this.object.position.x; } set x(v) { this.setPosition(v, this.y, this.z); }
  get y() { return this.object.position.y; } set y(v) { this.setPosition(this.x, v, this.z); }
  get z() { return this.object.position.z; } set z(v) { this.setPosition(this.x, this.y, v); }
  setPosition(x, y, z) {
    const p = this.object.position;
    p.set(num(x, p.x), num(y, p.y), num(z, p.z));
    this.teleported = true;
  }
  moveBy(dx = 0, dy = 0, dz = 0) { this.setPosition(this.x + num(dx), this.y + num(dy), this.z + num(dz)); }
  /** Move along the direction the object is facing (its local +Z). */
  moveForward(distance = 1) {
    const d = new THREE.Vector3(0, 0, 1).applyQuaternion(this.object.quaternion).multiplyScalar(num(distance));
    this.moveBy(d.x, d.y, d.z);
  }
  setRotation(x, y, z) {
    const r = this.object.rotation;
    r.set(num(x) * DEG, num(y) * DEG, num(z) * DEG);
    this.teleported = true;
  }
  rotateBy(dx = 0, dy = 0, dz = 0) {
    const o = this.object;
    o.rotateX(num(dx) * DEG); o.rotateY(num(dy) * DEG); o.rotateZ(num(dz) * DEG);
    this.teleported = true;
  }
  turn(degrees = 15) { this.rotateBy(0, degrees, 0); }
  lookAt(x, y, z) {
    const t = x && typeof x === 'object' ? new THREE.Vector3(x.x, x.y, x.z) : new THREE.Vector3(num(x), num(y), num(z));
    const o = this.object;
    // For ordinary objects three.js turns the local +Z axis (our "forward") towards the target.
    o.lookAt(o.parent.localToWorld(t));
    this.teleported = true;
  }
  get scale() { const s = this.object.scale; return (s.x + s.y + s.z) / 3; }
  set scale(v) { this.setScale(v); }
  setScale(x, y, z) {
    x = Math.max(0.001, num(x, 1));
    this.object.scale.set(x, y === undefined ? x : Math.max(0.001, num(y, 1)), z === undefined ? x : Math.max(0.001, num(z, 1)));
  }
  scaleBy(f) { this.object.scale.multiplyScalar(Math.max(0.001, num(f, 1))); }
  /** Smoothly move to a point over some seconds. `await` it to continue when it arrives. */
  glideTo(x, y, z, seconds = 1) {
    return new Promise((resolve) => {
      this._rt.tweens.push({ e: this, from: this.object.position.clone(), to: new THREE.Vector3(num(x), num(y), num(z)), t: 0, dur: Math.max(0.001, num(seconds, 1)), resolve });
    });
  }
  distanceTo(other) {
    if (!other) return Infinity;
    return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
  }
  isTouching(other) { return other ? this.touching.has(other) : this.touching.size > 0; }

  // ---- looks
  get color() { return this.data.color; }
  set color(v) {
    this.data = { ...this.data, color: String(v) };
    try {
      const c = new THREE.Color(String(v));
      this.object.traverse((o) => { if (o.isMesh && !o.material.vertexColors && !o.parent?.userData.editorOnly) o.material.color.copy(c); if (o.isLight) o.color.copy(c); });
    } catch { /* bad colour name */ }
  }
  setColor(v) { this.color = v; }
  get opacity() { return this.data.opacity ?? 1; }
  set opacity(v) { this.data = { ...this.data, opacity: Math.max(0, Math.min(1, num(v, 1))) }; applyLook(this.object, this.data); }
  get visible() { return this.object.visible; }
  set visible(v) { this.object.visible = !!v; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  get text() { return this.data.props?.text ?? ''; }
  set text(v) {
    if (this.data.type !== 'text') return;
    this.data = { ...this.data, props: { ...this.data.props, text: String(v) } };
    const fresh = buildObject(this.data, this._rt.ctx);
    disposeObject(this.object);
    this.object.clear();
    this.object.add(...fresh.children);
  }
  setText(v) { this.text = v; }
  /** Show a speech bubble above the object. */
  say(message, seconds = 2) {
    this._bubble?.removeFromParent();
    this._bubble = null;
    if (message === undefined || message === null || message === '') return;
    this._bubble = makeBubble(message);
    this._bubbleTop = localBounds(this.object).max.y;
    this._bubbleUntil = seconds > 0 ? this._rt.time + num(seconds, 2) : Infinity;
    this._rt.root.add(this._bubble);
  }

  // ---- animation
  /** Built-in: spin, bounce, float, pulse, wobble. Imported models: the name of one of their clips. */
  animate(name = 'spin', speed = 1) {
    name = String(name);
    const clips = this.object.userData.animations || [];
    const clip = clips.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (clip) {
      this._mixer ||= new THREE.AnimationMixer(this.object);
      this._mixer.stopAllAction();
      const action = this._mixer.clipAction(clip);
      action.timeScale = num(speed, 1);
      action.reset().play();
      return;
    }
    this._anims.set(name.toLowerCase(), { speed: num(speed, 1), t: 0, last: 0 });
  }
  stopAnimation(name) {
    if (name === undefined) { this._anims.clear(); this._mixer?.stopAllAction(); } else this._anims.delete(String(name).toLowerCase());
  }
  get animations() { return (this.object.userData.animations || []).map((c) => c.name); }

  // ---- physics
  _rebuild() { if (this.alive) this._rt.physics.add(this); }
  get dynamic() { return this.phys.dynamic; } set dynamic(v) { this.phys.dynamic = !!v; this._rebuild(); }
  get solid() { return this.phys.solid; } set solid(v) { this.phys.solid = !!v; this._rebuild(); }
  get gravity() { return this.phys.gravity; } set gravity(v) { this.phys.gravity = !!v; this.body?.setGravityScale(v ? 1 : 0, true); }
  get mass() { return this.phys.mass; } set mass(v) { this.phys.mass = Math.max(0.001, num(v, 1)); this.collider?.setMass(this.phys.mass); }
  get friction() { return this.phys.friction; } set friction(v) { this.phys.friction = Math.max(0, num(v, 0.5)); this.collider?.setFriction(this.phys.friction); }
  get bounciness() { return this.phys.bounciness; } set bounciness(v) { this.phys.bounciness = Math.max(0, num(v, 0)); this.collider?.setRestitution(this.phys.bounciness); }
  enablePhysics(on = true) { this.dynamic = on; }
  /** Which layer (1-8) this object is on, and which layers it bumps into. */
  setCollision(layer, mask) {
    this.phys.layer = num(layer, 1);
    if (mask !== undefined) this.phys.mask = Array.from(unwrap(mask) || []).map(Number);
    this._rebuild();
  }
  _needDynamic() { if (!this.isDynamic) this.dynamic = true; return this.body; }
  /** Give the object a sudden shove. Turns physics on if it was off. */
  push(x = 0, y = 0, z = 0) { this._needDynamic()?.applyImpulse({ x: num(x), y: num(y), z: num(z) }, true); }
  setVelocity(x = 0, y = 0, z = 0) { this._needDynamic()?.setLinvel({ x: num(x), y: num(y), z: num(z) }, true); }
  setSpin(x = 0, y = 0, z = 0) { this._needDynamic()?.setAngvel({ x: num(x) * DEG, y: num(y) * DEG, z: num(z) * DEG }, true); }

  // ---- sound (audio objects)
  play() {
    const file = this.data.props?.file;
    if (this.data.type === 'audio' && file) this._rt.sounds.playClip(this, this._rt.ctx.assetUrl(file)).catch((e) => this._rt.report(e, this));
  }
  stop() { this._rt.sounds.stopClip(this); }

  // ---- events and lifetime
  onClick(fn) { this._rt.on('click', fn, this, this); }
  onCollide(fn) { this._rt.on('collide', fn, this, this); }
  onCollideEnd(fn) { this._rt.on('collideEnd', fn, this, this); }
  clone() { return this._rt.spawnFrom(this); }
  destroy() { this._rt.destroy(this); }
}

// ------------------------------------------------------------------ Runtime
export class Runtime {
  /**
   * @param opts { view, entries: Map<id,{data,object}>, settings, assetUrl, log(kind,text), hud(text), getScript(id) }
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.root = opts.view.worldRoot;
    this.camera = opts.view.camera;
    this.dom = opts.view.renderer.domElement;
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.ctx = { assetUrl: opts.assetUrl };
    this.entities = [];
    this.spawned = [];
    this.handlers = { start: [], update: [], click: [], collide: [], collideEnd: [], key: [], keyUp: [], message: [], timer: [] };
    this.tweens = [];
    this.waits = [];
    this.keys = new Set();
    this.vars = {};
    this.time = 0;
    this.frame = 0;
    this.running = false;
    this.raycaster = new THREE.Raycaster();
    this._listeners = [];
  }

  log_(kind, text) { this.log?.(kind, String(text)); }
  report(err, entity) {
    const msg = err?.message || String(err);
    this.log_('error', `${entity ? entity.name + ': ' : ''}${msg.split('\n').filter(Boolean).pop()}`);
  }

  on(type, fn, owner, target, extra) {
    if (typeof fn !== 'function') return;
    this.handlers[type].push({ fn, owner, target, extra, last: this.time });
  }
  fire(type, match, ...args) {
    for (const h of [...this.handlers[type]]) {
      if (match && !match(h)) continue;
      if (h.owner && !h.owner.alive) continue;
      this.call(h, ...args);
    }
  }
  call(h, ...args) {
    try {
      const r = h.fn(...args);
      if (r && typeof r.catch === 'function') r.catch((e) => this.running && this.report(e, h.owner));
    } catch (e) { this.report(e, h.owner); }
  }

  async start() {
    await initPhysics();
    this.physics = new Physics(this.settings.gravity);
    this.sounds = new Sounds(this.camera);
    this.sounds.resume();
    await Promise.all([...this.entries.values()].map((e) => e.object.userData.ready));
    for (const [id, { data, object }] of this.entries) {
      const e = new Entity(this, id, data, object);
      object.userData.entity = e;
      object.traverse((o) => { if (o.userData.editorOnly) o.visible = false; });
      this.entities.push(e);
      this.physics.add(e);
    }
    this.physics.onCollision = (a, b, started) => this.collision(a, b, started);
    this.player = new PlayerController(this);
    this.bindInput();
    this.running = true;

    // compile + run every script; top-level code registers event handlers
    for (const e of [...this.entities]) {
      try {
        const script = await this.getScript(e.id);
        if (script && script.code.trim()) await this.runScript(e, script);
      } catch (err) { this.report(err, e); }
      if (!this.running) return;
    }
    for (const e of this.entities) if (e.data.type === 'audio' && e.data.props?.autoplay) e.play();
    this.fire('start');
  }

  api(e) {
    const rt = this;
    const world = this.worldApi ||= snakeAliases(makeWorldApi(this));
    const when = {
      start: (fn) => rt.on('start', fn, e),
      update: (fn) => rt.on('update', fn, e),
      clicked: (a, b) => (typeof a === 'function' ? rt.on('click', a, e, e) : rt.on('click', b, e, a)),
      collides: (a, b) => (typeof a === 'function' ? rt.on('collide', a, e, e) : rt.on('collide', b, e, a)),
      collisionEnds: (a, b) => (typeof a === 'function' ? rt.on('collideEnd', a, e, e) : rt.on('collideEnd', b, e, a)),
      key: (key, fn) => rt.on('key', fn, e, null, normKey(key)),
      keyReleased: (key, fn) => rt.on('keyUp', fn, e, null, normKey(key)),
      message: (name, fn) => rt.on('message', fn, e, null, String(name)),
      every: (seconds, fn) => rt.on('timer', fn, e, null, Math.max(0.01, num(seconds, 1))),
    };
    snakeAliases(when);
    const input = snakeAliases({
      keyDown: (k) => rt.keys.has(normKey(k)),
      get keys() { return [...rt.keys]; },
    });
    const print = (...a) => rt.log_('print', a.map((v) => (typeof v === 'object' && v !== null && !(v instanceof Entity) ? safeJson(v) : String(v))).join(' '));
    const wait = (s) => rt.wait(s);
    const nextFrame = () => rt.wait(0);
    return { me: e, world, when, input, player: this.player.api, print, wait, nextFrame, console: { log: print, warn: print, error: print, info: print } };
  }

  async runScript(e, script) {
    const api = this.api(e);
    if (script.lang === 'py') {
      const { runPython } = await import('./python.js');
      await runPython(script.code, api, this);
      return;
    }
    const guard = this.loopGuard();
    const names = ['me', 'world', 'when', 'input', 'player', 'print', 'wait', 'nextFrame', 'console', '__guard'];
    const fn = new AsyncFunction(...names, ...SHADOWED, `"use strict";\n${script.code}`);
    await fn.call(undefined, api.me, api.world, api.when, api.input, api.player, api.print, api.wait, api.nextFrame, api.console, guard);
  }

  /** Called inside every loop of block-generated code so a runaway loop yields instead of freezing the tab. */
  loopGuard() {
    let count = 0, stamp = performance.now();
    return async () => {
      if (!this.running) return new Promise(() => {});
      if (++count < 200) return;
      count = 0;
      if (performance.now() - stamp > 12) { await this.wait(0); stamp = performance.now(); }
    };
  }

  /** Game-time delay; never resolves once the world is stopped, so stale scripts simply halt. */
  wait(seconds) {
    return new Promise((resolve) => {
      if (this.running) this.waits.push({ at: this.time + Math.max(0, num(seconds, 0)), frame: this.frame, resolve });
    });
  }

  // ---- input
  listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); this._listeners.push(() => target.removeEventListener(type, fn, opts)); }
  bindInput() {
    const typing = (ev) => /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName) || ev.target?.isContentEditable;
    this.listen(window, 'keydown', (ev) => {
      if (typing(ev)) return;
      const k = normKey(ev.key);
      if (['space', 'up', 'down', 'left', 'right'].includes(k)) ev.preventDefault();
      if (this.keys.has(k)) return;
      this.keys.add(k);
      this.fire('key', (h) => h.extra === k || h.extra === 'any', k);
    });
    this.listen(window, 'keyup', (ev) => {
      const k = normKey(ev.key);
      if (!this.keys.delete(k)) return;
      this.fire('keyUp', (h) => h.extra === k || h.extra === 'any', k);
    });
    this.listen(window, 'blur', () => this.keys.clear());
    let down = null;
    this.listen(this.dom, 'pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, id: ev.pointerId }; this.sounds.resume(); });
    this.listen(this.dom, 'pointerup', (ev) => {
      if (!down || down.id !== ev.pointerId) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      down = null;
      if (moved > 6) return;
      const r = this.dom.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
      this.clickRay(this.raycaster);
    });
  }
  /** Used by mouse/touch taps and by VR/AR controllers. */
  clickRay(raycaster) {
    if (!this.running) return;
    const hits = raycaster.intersectObjects(this.entities.filter((e) => e.object.visible).map((e) => e.object), true);
    for (const hit of hits) {
      let o = hit.object;
      if (o.isSprite) continue;
      while (o && !o.userData.entity) o = o.parent;
      const e = o?.userData.entity;
      if (!e) continue;
      this.fire('click', (h) => h.target === e);
      return e;
    }
    return null;
  }

  collision(a, b, started) {
    if (started) { a.touching.add(b); b.touching.add(a); } else { a.touching.delete(b); b.touching.delete(a); }
    const type = started ? 'collide' : 'collideEnd';
    this.fire(type, (h) => h.target === a, b);
    this.fire(type, (h) => h.target === b, a);
  }

  // ---- spawning
  register(data, object) {
    const e = new Entity(this, 'rt' + Math.random().toString(36).slice(2, 10), data, object);
    object.userData.entity = e;
    this.root.add(object);
    this.entities.push(e);
    this.spawned.push(e);
    object.userData.ready.then(() => { if (e.alive && this.running) this.physics.add(e); });
    this.physics.add(e);
    return e;
  }
  spawnFrom(src) {
    if (this.spawned.length >= 500) { this.log_('error', 'Too many clones (limit 500).'); return src; }
    const data = { ...src.data, physics: { ...src.phys }, name: src.name };
    const object = buildObject(data, this.ctx);
    object.position.copy(src.object.position);
    object.quaternion.copy(src.object.quaternion);
    object.scale.copy(src.object.scale);
    object.traverse((o) => { if (o.userData.editorOnly) o.visible = false; });
    return this.register(data, object);
  }
  spawn(kind, x = 0, y = 1, z = 0, color) {
    if (this.spawned.length >= 500) { this.log_('error', 'Too many spawned objects (limit 500).'); return null; }
    kind = String(kind);
    const lower = kind.toLowerCase();
    const asset = ASSET_BY_ID[lower] || Object.values(ASSET_BY_ID).find((a) => a.name.toLowerCase() === lower);
    const prim = PRIMITIVES[lower] ? lower : Object.keys(PRIMITIVES).find((k) => PRIMITIVES[k].name.toLowerCase() === lower);
    if (!asset && !prim) {
      const src = this.entities.find((e) => e.alive && e.name === kind);
      if (!src) { this.log_('error', `spawn: nothing called "${kind}"`); return null; }
      const c = this.spawnFrom(src);
      c.setPosition(x, y, z);
      return c;
    }
    const data = {
      type: asset ? 'asset' : 'primitive', kind: asset ? asset.id : prim, name: asset ? asset.name : PRIMITIVES[prim].name,
      color: color || '#4f9dff', opacity: 1, props: {}, physics: { ...DEFAULT_PHYSICS }, pos: [num(x), num(y), num(z)], rot: [0, 0, 0], scl: [1, 1, 1],
    };
    const object = buildObject(data, this.ctx);
    applyTransform(object, data);
    return this.register(data, object);
  }
  destroy(e) {
    if (!e.alive) return;
    e.alive = false;
    e.object.visible = false;
    e._bubble?.removeFromParent();
    this.sounds.stopClip(e);
    for (const o of e.touching) o.touching.delete(e);
    this.physics.remove(e);
    this.entities = this.entities.filter((x) => x !== e);
    for (const k of Object.keys(this.handlers)) this.handlers[k] = this.handlers[k].filter((h) => h.owner !== e && h.target !== e);
  }

  // ---- frame
  update(dt) {
    if (!this.running) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.frame++;

    if (this.waits.length) {
      const due = [], later = [];
      for (const w of this.waits) (w.at <= this.time && w.frame !== this.frame ? due : later).push(w);
      this.waits = later;
      for (const w of due) w.resolve();
    }
    for (const h of this.handlers.timer) {
      if (this.time - h.last >= h.extra) { h.last = this.time; if (!h.owner || h.owner.alive) this.call(h); }
    }
    this.fire('update', null, dt);

    for (const t of this.tweens) {
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      const s = k * k * (3 - 2 * k);
      t.e.object.position.lerpVectors(t.from, t.to, s);
      t.e.teleported = true;
      if (k >= 1) { t.done = true; t.resolve(); }
    }
    if (this.tweens.some((t) => t.done)) this.tweens = this.tweens.filter((t) => !t.done && t.e.alive);

    for (const e of this.entities) {
      if (e._mixer) e._mixer.update(dt);
      if (!e._anims.size) continue;
      for (const [name, a] of e._anims) {
        a.t += dt * a.speed;
        const o = e.object;
        if (name === 'spin') o.rotateY(dt * a.speed * 90 * DEG);
        else if (name === 'bounce') { const v = Math.abs(Math.sin(a.t * 4)) * 0.6; o.position.y += v - a.last; a.last = v; } else if (name === 'float') { const v = Math.sin(a.t * 2) * 0.25; o.position.y += v - a.last; a.last = v; } else if (name === 'pulse') { const v = 1 + Math.sin(a.t * 5) * 0.12; o.scale.multiplyScalar(v / (a.last || 1)); a.last = v; } else if (name === 'wobble') { const v = Math.sin(a.t * 6) * 12 * DEG; o.rotateZ(v - a.last); a.last = v; }
        e.teleported = true;
      }
    }

    this.player.update(dt);
    this.physics.step(dt, this.entities);
    this.player.afterPhysics();

    for (const e of this.entities) {
      if (!e._bubble) continue;
      if (this.time > e._bubbleUntil) { e._bubble.removeFromParent(); e._bubble = null; continue; }
      e._bubble.position.copy(e.object.position);
      e._bubble.position.y += e._bubbleTop * e.object.scale.y + 0.6;
    }
  }

  stop() {
    this.running = false;
    for (const off of this._listeners) off();
    this.player?.dispose();
    this.sounds?.dispose();
    for (const e of [...this.entities, ...this.spawned]) { e._bubble?.removeFromParent(); e._mixer?.stopAllAction(); delete e.object.userData.entity; }
    for (const e of this.spawned) { e.object.removeFromParent(); disposeObject(e.object); }
    this.physics?.dispose();
    this.hud?.('');
  }
}

function safeJson(v) { try { return JSON.stringify(v); } catch { return String(v); } }

function makeWorldApi(rt) {
  return {
    /** Shared variables that every script in the world can read and change. */
    vars: rt.vars,
    getVar: (name) => rt.vars[String(name)] ?? 0,
    setVar: (name, value) => { rt.vars[String(name)] = value; },
    changeVar: (name, by = 1) => { rt.vars[String(name)] = num(rt.vars[String(name)]) + num(by, 1); },
    find: (name) => rt.entities.find((e) => e.name === String(name)), // undefined (None in Python) if missing
    findAll: (name) => rt.entities.filter((e) => e.name === String(name)),
    get objects() { return [...rt.entities]; },
    get time() { return rt.time; },
    get gravity() { return rt.settings.gravity; },
    set gravity(v) { rt.settings.gravity = num(v, -9.81); rt.physics.setGravity(rt.settings.gravity); },
    setGravity(v) { this.gravity = v; },
    /** Built-in effects (pop, coin, jump, laser, boom, hit, win, lose, click, beep), a note frequency, or the name of an audio object. */
    playSound(name) {
      if (rt.sounds.synth(name)) return;
      const e = rt.entities.find((x) => x.data.type === 'audio' && x.name === String(name));
      if (e) e.play(); else rt.log_('error', `No sound called "${name}"`);
    },
    stopSounds: () => rt.sounds.stopAll(),
    spawn: (kind, x, y, z, color) => rt.spawn(kind, x, y, z, color),
    /** Send a message to every script; pair with when.message(name, fn). */
    broadcast: (name, data) => rt.fire('message', (h) => h.extra === String(name), data),
    /** Show text on screen (score, timer, instructions). */
    showText: (text) => rt.hud?.(text === undefined || text === null ? '' : String(text)),
    setSky: (color) => rt.view.setSky(String(color)),
    random: (min = 0, max = 1) => min + Math.random() * (max - min),
    randomInt: (min, max) => Math.floor(num(min) + Math.random() * (num(max) - num(min) + 1)),
  };
}

// Python-friendly aliases: me.move_by(...), world.play_sound(...)
for (const proto of [Entity.prototype]) {
  for (const key of Object.getOwnPropertyNames(proto)) {
    const snake = key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    if (snake !== key && !key.startsWith('_') && key !== 'constructor') Object.defineProperty(proto, snake, Object.getOwnPropertyDescriptor(proto, key));
  }
}
export function snakeAliases(obj) {
  for (const key of Object.keys(obj)) {
    const snake = key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    if (snake !== key) Object.defineProperty(obj, snake, Object.getOwnPropertyDescriptor(obj, key));
  }
  return obj;
}
