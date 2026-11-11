// The 3D viewport shared by the editor and play mode: renderer, camera, lights, sky and WebXR (VR + AR).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { DEFAULT_SETTINGS } from '../../shared/schema.js';

export class View {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.xr.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.sky = new THREE.Color(DEFAULT_SETTINGS.skyColor);
    this.scene.background = this.sky;
    this.worldRoot = new THREE.Group(); // every world object lives here; AR scales/moves this group
    this.scene.add(this.worldRoot);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
    this.camera.position.set(9, 7, 12);
    this.rig = new THREE.Group(); // moved around in VR; the headset moves the camera inside it
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.5, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.maxPolarAngle = Math.PI * 0.98;
    this.orbit.update();

    this.hemi = new THREE.HemisphereLight('#ffffff', '#8a8f7a', DEFAULT_SETTINGS.ambientIntensity);
    this.sun = new THREE.DirectionalLight('#fff6e0', DEFAULT_SETTINGS.sunIntensity);
    this.sun.position.set(18, 30, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 90 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun);

    this.frameHandlers = new Set();
    this.lastTime = performance.now();
    this.arActive = false;
    this.onXRSelect = null; // (raycaster) => void, set by play mode
    this.raycaster = new THREE.Raycaster();
    this.setupControllers();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop((time, frame) => this.tick(frame));
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    if (this.renderer.xr.isPresenting) return;
    this.renderer.setSize(w, h);
    this.stereo?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick(frame) {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    if (this.orbit.enabled && !this.renderer.xr.isPresenting && !this.cardboard) this.orbit.update();
    if (frame && this.arActive) this.updateHitTest(frame);
    for (const fn of this.frameHandlers) fn(dt);
    if (this.cardboard) this.camera.quaternion.copy(this.cardboard.quat);
    if (this.cardboard) this.stereo.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    if (this.captureNext) { const cb = this.captureNext; this.captureNext = null; cb(); }
  }
  onFrame(fn) { this.frameHandlers.add(fn); return () => this.frameHandlers.delete(fn); }

  setSky(color) {
    try { this.sky.set(color); } catch { /* ignore bad colours */ }
  }
  applySettings(s) {
    const v = { ...DEFAULT_SETTINGS, ...s };
    this.setSky(v.skyColor);
    this.hemi.intensity = v.ambientIntensity;
    this.sun.intensity = v.sunIntensity;
  }

  /** Small JPEG of the current view (for the dashboard card). */
  snapshot(width = 480) {
    return new Promise((resolve) => {
      this.captureNext = () => {
        const src = this.renderer.domElement;
        const c = document.createElement('canvas');
        c.width = width; c.height = Math.round(width * 0.6);
        const scale = Math.max(c.width / src.width, c.height / src.height);
        const w = src.width * scale, h = src.height * scale;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#' + this.sky.getHexString();
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
        c.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
      };
    });
  }

  // ------------------------------------------------------------------ WebXR
  setupControllers() {
    this.controllers = [];
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    for (let i = 0; i < 2; i++) {
      const c = this.renderer.xr.getController(i);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
      line.scale.z = 6;
      line.visible = false;
      c.add(line);
      c.addEventListener('connected', (e) => { line.visible = e.data.targetRayMode === 'tracked-pointer'; });
      c.addEventListener('disconnected', () => { line.visible = false; });
      c.addEventListener('select', () => this.xrSelect(c));
      this.rig.add(c);
      this.controllers.push(c);
    }
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  xrSelect(controller) {
    if (this.arActive && this.arPlacing && this.reticle.visible) {
      this.worldRoot.position.setFromMatrixPosition(this.reticle.matrix);
      this.arPlacing = false;
      this.reticle.visible = false;
      this.onArPlaced?.();
      return;
    }
    const m = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m);
    this.onXRSelect?.(this.raycaster);
  }

  /** Thumbsticks: left = move, right = snap turn, A / right-trigger-squeeze = jump. */
  xrInput() {
    const out = { moveX: 0, moveY: 0, turnX: 0, jump: false };
    const session = this.renderer.xr.getSession();
    if (!session) return out;
    const dead = (v) => (Math.abs(v) > 0.15 ? v : 0);
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const x = dead(gp.axes[2] ?? gp.axes[0] ?? 0), y = dead(gp.axes[3] ?? gp.axes[1] ?? 0);
      if (src.handedness === 'right') { out.turnX = x; out.jump ||= !!gp.buttons[4]?.pressed; } else { out.moveX = x; out.moveY = y; }
    }
    return out;
  }

  static async xrSupport() {
    const xr = navigator.xr;
    const check = async (mode) => { try { return !!(xr && await xr.isSessionSupported(mode)); } catch { return false; } };
    const [vr, ar] = await Promise.all([check('immersive-vr'), check('immersive-ar')]);
    return { vr, ar, cardboard: !vr && matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window };
  }

  async enterVR() {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    // stand where the camera was looking from, on the ground
    this.rig.position.set(this.camera.position.x, this.orbit.target.y, this.camera.position.z);
    this.camera.position.set(0, 1.6, 0);
    this.camera.rotation.set(0, 0, 0);
    session.addEventListener('end', () => this.endXR());
    await this.renderer.xr.setSession(session);
    return session;
  }

  /** AR: the whole world becomes a table-top model you can walk around; tap a surface to place it. */
  async enterAR(scale, overlayRoot) {
    const init = { optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor'] };
    if (overlayRoot) init.domOverlay = { root: overlayRoot };
    const session = await navigator.xr.requestSession('immersive-ar', init);
    this.renderer.xr.setReferenceSpaceType('local');
    this.savedView = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() };
    this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0);
    this.arActive = true;
    this.scene.background = null;
    this.worldRoot.scale.setScalar(scale);
    this.worldRoot.position.set(0, -0.5, -1);
    this.arPlacing = false;
    session.addEventListener('end', () => this.endXR());
    await this.renderer.xr.setSession(session);
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      this.hitSource = await session.requestHitTestSource({ space: viewer });
      this.arPlacing = true;
    } catch { this.hitSource = null; }
    return session;
  }
  /** Let the user pick a new spot for the world. */
  arReposition() { if (this.hitSource) this.arPlacing = true; }

  updateHitTest(frame) {
    if (!this.hitSource || !this.arPlacing) { this.reticle.visible = false; return; }
    const hits = frame.getHitTestResults(this.hitSource);
    const pose = hits[0]?.getPose(this.renderer.xr.getReferenceSpace());
    this.reticle.visible = !!pose;
    if (pose) this.reticle.matrix.fromArray(pose.transform.matrix);
  }

  endXR() {
    this.hitSource?.cancel?.();
    this.hitSource = null;
    this.reticle.visible = false;
    if (this.arActive) {
      this.arActive = false;
      this.scene.background = this.sky;
      this.worldRoot.scale.setScalar(1);
      this.worldRoot.position.set(0, 0, 0);
    }
    this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0);
    if (this.savedView) { this.camera.position.copy(this.savedView.pos); this.camera.quaternion.copy(this.savedView.quat); this.savedView = null; }
    this.onXREnd?.();
    requestAnimationFrame(() => this.resize());
  }
  exitXR() { this.renderer.xr.getSession()?.end(); }

  // ---- phone-in-a-viewer fallback for browsers without WebXR (iOS Safari): split screen + gyroscope
  async enterCardboard() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('Motion access was not allowed.');
    }
    this.stereo ||= new StereoEffect(this.renderer);
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), q0 = new THREE.Quaternion(), zee = new THREE.Vector3(0, 0, 1);
    const handler = (e) => {
      if (e.alpha === null) return;
      const orient = (screen.orientation?.angle || 0) * Math.PI / 180;
      euler.set(e.beta * Math.PI / 180, e.alpha * Math.PI / 180, -e.gamma * Math.PI / 180, 'YXZ');
      quat.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
    };
    window.addEventListener('deviceorientation', handler);
    this.cardboard = { quat, off: () => window.removeEventListener('deviceorientation', handler) };
    this.container.requestFullscreen?.().catch(() => {});
    screen.orientation?.lock?.('landscape').catch(() => {});
    this.resize();
  }
  exitCardboard() {
    if (!this.cardboard) return;
    this.cardboard.off();
    this.cardboard = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    this.resize();
  }

  dispose() {
    this.exitXR();
    this.exitCardboard();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
