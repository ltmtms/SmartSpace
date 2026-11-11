// The person exploring the world in play mode: orbit camera, first-person walking (with gravity,
// jumping and collisions), or free flying. The same controller drives desktop, touch and VR.
import * as THREE from 'three';

const EYE = 1.6;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _move = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class PlayerController {
  constructor(rt) {
    this.rt = rt;
    this.view = rt.view;
    const cam = this.view.camera, orbit = this.view.orbit;
    this.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), target: orbit.target.clone() };
    this.mode = rt.settings.playerMode;
    this.speed = rt.settings.playerSpeed;
    this.feet = new THREE.Vector3(cam.position.x, Math.min(cam.position.y, orbit.target.y + 2), cam.position.z);
    this.spawn = this.feet.clone();
    const dir = orbit.target.clone().sub(cam.position);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = 0;
    this.vy = 0;
    this.grounded = false;
    this.stick = { x: 0, y: 0 };
    this.jumpQueued = false;
    this.snapReady = true;
    this.offs = [];

    if (this.mode === 'walk') {
      this.body = rt.physics.createPlayer(this.feet);
      rt.physics.byCollider.set(this.body.collider.handle, this.entity = makePlayerEntity(this));
    }
    this.api = this.entity || makePlayerEntity(this);
    if (this.mode !== 'orbit') {
      orbit.enabled = false;
      this.bindLook();
      if (matchMedia('(pointer: coarse)').matches) this.buildTouchControls();
    }
  }

  bindLook() {
    const dom = this.rt.dom;
    let drag = null;
    const on = (t, type, fn) => { t.addEventListener(type, fn); this.offs.push(() => t.removeEventListener(type, fn)); };
    on(dom, 'pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
    on(window, 'pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      this.yaw -= (e.clientX - drag.x) * 0.005;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - (e.clientY - drag.y) * 0.005));
      drag.x = e.clientX; drag.y = e.clientY;
    });
    on(window, 'pointerup', (e) => { if (drag?.id === e.pointerId) drag = null; });
    on(window, 'pointercancel', () => { drag = null; });
  }

  buildTouchControls() {
    const wrap = document.createElement('div');
    wrap.className = 'touch-controls';
    wrap.innerHTML = '<div class="joystick"><div class="knob"></div></div><button class="jump" aria-label="Jump">⤒</button>';
    this.view.container.appendChild(wrap);
    this.offs.push(() => wrap.remove());
    const pad = wrap.querySelector('.joystick'), knob = wrap.querySelector('.knob');
    const set = (e) => {
      const r = pad.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      this.stick = { x, y };
      knob.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
    };
    const reset = () => { this.stick = { x: 0, y: 0 }; knob.style.transform = ''; };
    pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); set(e); });
    pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) set(e); });
    pad.addEventListener('pointerup', reset);
    pad.addEventListener('pointercancel', reset);
    wrap.querySelector('.jump').addEventListener('pointerdown', (e) => { e.preventDefault(); this.jumpQueued = true; });
  }

  teleport(x, y, z) {
    this.feet.set(x, y, z);
    this.vy = 0;
    if (this.body) this.body.body.setTranslation({ x, y: y + this.body.height / 2, z }, true);
    if (this.mode === 'orbit' && !this.view.renderer.xr.isPresenting) {
      const d = this.view.camera.position.clone().sub(this.view.orbit.target);
      this.view.orbit.target.set(x, y, z);
      this.view.camera.position.copy(this.view.orbit.target).add(d);
    }
  }

  update(dt) {
    const view = this.view, xr = view.renderer.xr.isPresenting, keys = this.rt.keys;
    if (view.arActive) return;
    if (xr && !this.wasXr && !this.body) this.feet.copy(view.rig.position);
    this.wasXr = xr;
    const mode = xr && this.mode === 'orbit' ? 'fly' : this.mode;
    this.active = mode;
    if (mode === 'orbit') return;

    let mx = this.stick.x, mz = -this.stick.y;
    if (keys.has('w') || keys.has('up')) mz += 1;
    if (keys.has('s') || keys.has('down')) mz -= 1;
    if (keys.has('a') || keys.has('left')) mx -= 1;
    if (keys.has('d') || keys.has('right')) mx += 1;
    let jump = keys.has('space') || this.jumpQueued;
    this.jumpQueued = false;

    if (xr) {
      const pad = view.xrInput();
      mx += pad.moveX; mz -= pad.moveY;
      jump ||= pad.jump;
      if (Math.abs(pad.turnX) > 0.6) {
        if (this.snapReady) { view.rig.rotation.y -= Math.sign(pad.turnX) * Math.PI / 6; this.snapReady = false; }
      } else this.snapReady = true;
      view.camera.getWorldDirection(_f);
    } else {
      _f.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    }
    if (mode === 'walk') { _f.y = 0; }
    _f.normalize();
    _r.crossVectors(_f, UP).normalize();
    _move.set(0, 0, 0).addScaledVector(_f, mz).addScaledVector(_r, mx);
    if (_move.lengthSq() > 1) _move.normalize();
    _move.multiplyScalar(this.speed * dt);

    if (mode === 'walk' && this.body) {
      const g = this.rt.settings.gravity;
      this.vy = g === 0 ? 0 : this.vy + g * dt;
      if (jump && this.grounded) { this.vy = 5.5; this.rt.fire('message', (h) => h.extra === 'player-jump'); }
      _move.y = this.vy * dt;
      this.grounded = this.rt.physics.movePlayer(this.body, _move);
      if (this.grounded && this.vy < 0) this.vy = 0;
    } else {
      if (keys.has('e') || jump) _move.y += this.speed * dt;
      if (keys.has('q') || keys.has('shift')) _move.y -= this.speed * dt;
      this.feet.add(_move);
    }
  }

  afterPhysics() {
    const view = this.view, xr = view.renderer.xr.isPresenting;
    if (view.arActive || this.active === 'orbit') return;
    if (this.body && this.active === 'walk') {
      const t = this.body.body.translation();
      this.feet.set(t.x, t.y - this.body.height / 2, t.z);
      if (this.feet.y < -60) this.teleport(this.spawn.x, this.spawn.y + 1, this.spawn.z); // fell out of the world
    }
    if (xr) view.rig.position.copy(this.feet);
    else {
      view.camera.position.set(this.feet.x, this.feet.y + EYE, this.feet.z);
      view.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
  }

  dispose() {
    for (const off of this.offs) off();
    const { camera, orbit, rig } = this.view;
    if (!this.view.renderer.xr.isPresenting) {
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
      camera.position.copy(this.saved.pos);
      camera.quaternion.copy(this.saved.quat);
    }
    orbit.target.copy(this.saved.target);
    orbit.enabled = true;
    orbit.update();
  }
}

/** What scripts see as `player`, and what collision handlers receive when the player bumps into things. */
function makePlayerEntity(pc) {
  const pos = () => (pc.active && pc.active !== 'orbit' ? pc.feet : pc.view.camera.position);
  const p = {
    name: 'Player', isPlayer: true, alive: true, touching: new Set(),
    get x() { return pos().x; }, set x(v) { pc.teleport(+v, pos().y, pos().z); },
    get y() { return pos().y; }, set y(v) { pc.teleport(pos().x, +v, pos().z); },
    get z() { return pos().z; }, set z(v) { pc.teleport(pos().x, pos().y, +v); },
    get speed() { return pc.speed; }, set speed(v) { pc.speed = Math.max(0, +v || 0); },
    get mode() { return pc.mode; },
    setPosition: (x, y, z) => pc.teleport(+x || 0, +y || 0, +z || 0),
    distanceTo: (o) => (o ? Math.hypot(pos().x - o.x, pos().y - o.y, pos().z - o.z) : Infinity),
    isTouching(o) { return o ? this.touching.has(o) : this.touching.size > 0; },
    toString: () => 'Player',
  };
  p.set_position = p.setPosition; p.distance_to = p.distanceTo; p.is_touching = p.isTouching;
  return p;
}
