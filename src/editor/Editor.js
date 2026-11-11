// The world editor: viewport + panels + play mode. Viewers (read-only access) get the same
// component with the editing tools removed.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { h, toast, modal, avatar, debounce, clear } from '../ui/dom.js';
import { api } from '../api.js';
import { STATIC } from '../env.js';
import { openWorld } from '../collab/doc.js';
import { DEFAULT_SETTINGS } from '../../shared/schema.js';
import { View } from '../engine/view.js';
import { Runtime } from '../engine/runtime.js';
import { localBounds } from '../engine/factory.js';
import { sculpt, encodeHeights } from '../engine/terrain.js';
import { SceneSync } from './sync.js';
import { LibraryPanel } from './library.js';
import { Inspector } from './inspector.js';
import { CodePanel } from './codePanel.js';

const TOOLS = [['select', '⬚', 'Select (Q)'], ['translate', '✥', 'Move (W)'], ['rotate', '⟳', 'Rotate (E)'], ['scale', '⤢', 'Resize (R)']];

export class Editor {
  constructor(mount, { meta, user, navigate }) {
    this.mount = mount;
    this.meta = meta;
    this.user = user;
    this.navigate = navigate;
    this.canEdit = meta.access === 'edit';
    this.selected = null;
    this.tool = 'translate';
    this.snap = false;
    this.playing = false;
    this.brush = { active: false, mode: 'raise', radius: 3, strength: 1 };
    this.offs = [];
  }

  async init() {
    this.world = openWorld(this.meta.id, this.user);
    this.buildDom();
    try {
      await this.world.synced;
    } catch (e) {
      this.world.destroy();
      throw e;
    }
    const { world } = this;
    await api.prepareAssets(this.meta.id);
    this.view = new View(this.viewportEl);
    this.ctx = { assetUrl: (file) => api.assetUrl(this.meta.id, file) };
    this.sync = new SceneSync(world, this.view, this.ctx);

    this.grid = new THREE.GridHelper(40, 40, '#ffffff', '#ffffff');
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.25;
    this.grid.position.y = 0.012;
    this.view.scene.add(this.grid);
    this.selBox = new THREE.BoxHelper(undefined, '#ffd60a');
    this.selBox.visible = false;
    this.view.scene.add(this.selBox);
    this.remoteBoxes = new Map();
    this.brushRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd60a', depthTest: false, transparent: true }));
    this.brushRing.visible = false;
    this.brushRing.renderOrder = 10;
    this.view.scene.add(this.brushRing);

    if (this.canEdit) {
      this.gizmo = new TransformControls(this.view.camera, this.view.renderer.domElement);
      this.gizmo.setSize(0.9);
      this.view.scene.add(this.gizmo.getHelper());
      this.gizmo.addEventListener('dragging-changed', (e) => {
        this.view.orbit.enabled = !e.value;
        this.gizmoDragging = e.value;
        if (!e.value) this.writeTransform.flush();
      });
      this.gizmo.addEventListener('objectChange', () => this.writeTransform());
      this.writeTransform = debounce(() => {
        const entry = this.sync.entries.get(this.selected);
        if (!entry || this.playing) return;
        const o = entry.object;
        const r = (n) => Math.round(n * 1000) / 1000;
        world.set(this.selected, { pos: o.position.toArray().map(r), rot: [o.rotation.x, o.rotation.y, o.rotation.z].map((n) => Math.round(n * 1e4) / 1e4), scl: o.scale.toArray().map((n) => Math.max(0.01, Math.abs(r(n)))) });
      }, 40);
    }

    this.library = this.canEdit ? new LibraryPanel(this, this.leftEl) : null;
    this.inspector = this.canEdit ? new Inspector(this, this.rightEl) : null;
    this.code = this.canEdit ? new CodePanel(this, this.codeEl) : null;

    this.thumbSoon = debounce(() => this.saveThumb(), 20000);
    this.sync.onChange((ids, structural) => {
      if (this.selected && !this.sync.entries.has(this.selected)) this.select(null);
      this.library?.refreshObjects();
      if (ids.includes(this.selected)) { this.inspector?.sync(); this.attachGizmo(); }
      if (structural) this.code?.objectsChanged();
      this.thumbSoon();
    });
    this.sync.start();
    const onSettings = () => { this.view.applySettings(this.settings()); this.inspector?.sync(); };
    world.settings.observe(onSettings);
    this.offs.push(() => world.settings.unobserve(onSettings));
    onSettings();

    const onAware = () => this.renderPeople();
    world.awareness.on('change', onAware);
    this.offs.push(() => world.awareness.off('change', onAware));
    onAware();
    const onStatus = ({ status }) => { this.statusEl.textContent = status === 'connected' ? '' : 'Reconnecting…'; };
    world.provider.on('status', onStatus);
    world.provider.on('connection-close', (ev) => {
      if (ev?.code === 4001 || ev?.code === 4003) { world.provider.disconnect(); toast(ev.code === 4001 ? 'This world was deleted.' : 'Your access to this world changed.', 'error'); this.navigate('/'); }
    });

    this.bindViewport();
    this.offs.push(this.view.onFrame((dt) => this.frame(dt)));
    this.inspector?.render();
    this.setTool(this.tool);
    this.updateXRButtons();
    if (!this.canEdit) this.showViewerIntro();
    return this;
  }

  settings() { return { ...DEFAULT_SETTINGS, ...Object.fromEntries(this.world.settings.entries()) }; }

  // ------------------------------------------------------------------ DOM
  buildDom() {
    const E = this.canEdit;
    this.titleEl = h('input.title', { value: this.meta.title, disabled: !E, 'aria-label': 'World name', maxLength: 80,
      onChange: async () => { try { this.meta = (await api.updateWorld(this.meta.id, { title: this.titleEl.value })).world; this.titleEl.value = this.meta.title; } catch (e) { toast(e.message, 'error'); } } });
    this.toolBtns = Object.fromEntries(TOOLS.map(([id, icon, label]) => [id, h('button.icon-btn', { title: label, 'aria-label': label, onClick: () => this.setTool(id) }, icon)]));
    this.snapBtn = h('button.icon-btn', { title: 'Snap to grid', 'aria-label': 'Snap to grid', onClick: () => this.toggleSnap() }, '▦');
    this.peopleEl = h('div.people');
    this.statusEl = h('span.status');
    this.playBtn = h('button.btn.primary.play-btn', { onClick: () => (this.playing ? this.stop() : this.play()) }, '▶ Play');
    this.vrBtn = h('button.btn', { hidden: true, onClick: () => this.enterVR(), title: 'Explore in a VR headset' }, 'VR');
    this.arBtn = h('button.btn', { hidden: true, onClick: () => this.enterAR(), title: 'Place this world in your room' }, 'AR');
    this.viewportEl = h('div.viewport');
    this.hudEl = h('div.hud');
    this.consoleEl = h('div.console', { hidden: true, title: 'Messages from your code. Click to hide.', onClick: () => { this.consoleEl.hidden = true; } });
    this.arBar = h('div.ar-bar', { hidden: true },
      h('span', null, 'Point at the floor or a table, then tap to place the world.'),
      h('button.btn', { onClick: () => this.view.arReposition() }, 'Move world'),
      h('button.btn', { onClick: () => this.view.exitXR() }, 'Exit AR'));
    this.leftEl = h('aside.panel.left');
    this.rightEl = h('aside.panel.right');
    this.codeEl = h('section.code-panel', { hidden: true });

    this.el = h('div.editor' + (E ? '' : '.viewer'), null,
      h('header.topbar', null,
        h('button.icon-btn', { title: 'Back to my worlds', 'aria-label': 'Back to my worlds', onClick: () => this.navigate('/') }, '←'),
        this.titleEl,
        E && h('div.tool-group', null, Object.values(this.toolBtns), this.snapBtn),
        E && h('div.tool-group', null,
          h('button.icon-btn', { title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onClick: () => this.world.undo.undo() }, '↶'),
          h('button.icon-btn', { title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', onClick: () => this.world.undo.redo() }, '↷')),
        h('span.spacer'), this.statusEl, this.peopleEl,
        E && this.meta.isOwner && !STATIC && h('button.btn', { onClick: () => this.shareDialog() }, 'Share'),
        !E && h('button.btn', { onClick: () => this.makeCopy() }, 'Make my own copy'),
        this.vrBtn, this.arBtn, this.playBtn),
      h('div.editor-body', null,
        E && this.leftEl,
        h('main.viewport-wrap', null, this.viewportEl, this.hudEl, this.consoleEl, this.arBar,
          E && h('div.panel-toggles', null,
            h('button.btn.small', { onClick: () => this.el.classList.toggle('show-left') }, '＋ Add'),
            h('button.btn.small', { onClick: () => this.el.classList.toggle('show-right') }, 'Properties'))),
        E && this.rightEl),
      E && this.codeEl);
    clear(this.mount).append(this.el);
  }

  renderPeople() {
    const people = this.world.people();
    clear(this.peopleEl).append(...people.filter((p) => !p.isMe).slice(0, 6).map((p) => avatar(p, 28)));
    // outline what collaborators have selected, in their colour
    const want = new Map(people.filter((p) => !p.isMe && p.selected).map((p) => [p.clientId, p]));
    for (const [id, box] of this.remoteBoxes) if (!want.has(id)) { box.removeFromParent(); box.dispose(); this.remoteBoxes.delete(id); }
    for (const [id, p] of want) {
      let box = this.remoteBoxes.get(id);
      if (!box) { box = new THREE.BoxHelper(undefined, p.color); this.remoteBoxes.set(id, box); this.view?.scene.add(box); }
      box.userData.target = p.selected;
    }
    this.library?.refreshObjects();
  }

  // ------------------------------------------------------------------ selection & tools
  select(id) {
    if (this.playing) return;
    if (id && !this.sync.entries.has(id)) id = null;
    if (this.selected === id) return;
    this.selected = id;
    this.world.awareness.setLocalStateField('selected', id);
    this.setBrush(false);
    this.attachGizmo();
    this.inspector?.render();
    this.library?.refreshObjects();
    this.code?.selectionChanged();
  }
  attachGizmo() {
    if (!this.gizmo) return;
    const entry = this.sync.entries.get(this.selected);
    const usable = entry && !this.playing && this.tool !== 'select' && !entry.data.locked && !this.brush.active;
    if (usable) { if (this.gizmo.object !== entry.object) this.gizmo.attach(entry.object); } else if (this.gizmo.object) this.gizmo.detach();
  }
  setTool(tool) {
    this.tool = tool;
    for (const [id, btn] of Object.entries(this.toolBtns)) btn.classList.toggle('active', id === tool);
    if (this.gizmo && tool !== 'select') this.gizmo.setMode(tool);
    this.attachGizmo();
  }
  toggleSnap() {
    this.snap = !this.snap;
    this.snapBtn.classList.toggle('active', this.snap);
    this.gizmo?.setTranslationSnap(this.snap ? 0.5 : null);
    this.gizmo?.setRotationSnap(this.snap ? Math.PI / 12 : null);
    this.gizmo?.setScaleSnap(this.snap ? 0.25 : null);
  }
  setBrush(active) {
    this.brush.active = active && this.sync.entries.get(this.selected)?.data.type === 'terrain';
    this.brushRing.visible = false;
    this.attachGizmo();
  }
  focusSelected() {
    const entry = this.sync.entries.get(this.selected);
    if (!entry) return;
    const box = new THREE.Box3().setFromObject(entry.object);
    const size = Math.min(60, Math.max(2, box.getSize(new THREE.Vector3()).length()));
    const center = box.getCenter(new THREE.Vector3());
    const dir = this.view.camera.position.clone().sub(this.view.orbit.target).normalize();
    this.view.orbit.target.copy(center);
    this.view.camera.position.copy(center).addScaledVector(dir, size * 1.4);
  }

  // ------------------------------------------------------------------ editing actions
  uniqueName(base) {
    const names = new Set([...this.sync.entries.values()].map((e) => e.data.name));
    if (!names.has(base)) return base;
    const stem = base.replace(/ \d+$/, '');
    let i = 2;
    while (names.has(`${stem} ${i}`)) i++;
    return `${stem} ${i}`;
  }
  /** Add an object. `point` is where its base should rest; default is where the camera is looking. */
  addObject(data, point) {
    if (!this.canEdit) return null;
    if (this.sync.entries.size >= 600) { toast('This world is full (600 objects).', 'error'); return null; }
    const p = point || (data.type === 'terrain' ? new THREE.Vector3(0, 0.03, 0) : this.freeSpot());
    const id = this.world.add({ ...data, name: this.uniqueName(data.name || 'Object'), pos: [p.x, p.y, p.z] });
    const entry = this.sync.entries.get(id);
    if (entry && data.type !== 'terrain') {
      // rest the object on the surface once its real size is known
      entry.object.userData.ready.then(() => {
        const cur = this.world.data(id);
        if (!cur || cur.pos[0] !== p.x || cur.pos[1] !== p.y || cur.pos[2] !== p.z) return;
        const lift = -localBounds(entry.object).min.y * cur.scl[1];
        if (Math.abs(lift) > 1e-4) this.world.set(id, { pos: [p.x, Math.round((p.y + lift) * 1000) / 1000, p.z] });
      });
    }
    this.select(id);
    return id;
  }
  /** A spot near where the camera is looking that is not already taken by another object. */
  freeSpot() {
    const base = this.view.orbit.target.clone().setY(0);
    const taken = [...this.sync.entries.values()].filter((e) => !e.data.locked).map((e) => e.data.pos);
    for (let i = 0; i < 60; i++) {
      const ring = Math.ceil(i / 6), angle = i * 1.047 + ring * 0.5;
      const p = i === 0 ? base.clone() : base.clone().add(new THREE.Vector3(Math.cos(angle) * ring * 2, 0, Math.sin(angle) * ring * 2));
      p.x = Math.round(p.x * 2) / 2; p.z = Math.round(p.z * 2) / 2;
      if (!taken.some((t) => Math.hypot(t[0] - p.x, t[2] - p.z) < 1.6)) return p;
    }
    return base;
  }
  deleteSelected() {
    const entry = this.sync.entries.get(this.selected);
    if (!entry || !this.canEdit) return;
    this.world.remove(this.selected);
  }
  duplicateSelected() {
    const entry = this.sync.entries.get(this.selected);
    if (!entry || !this.canEdit) return;
    const d = entry.data;
    const id = this.world.duplicate(this.selected, { name: this.uniqueName(d.name), pos: [d.pos[0] + 1, d.pos[1], d.pos[2] + 1], locked: false });
    this.select(id);
  }

  // ------------------------------------------------------------------ viewport input
  pointerRay(ev) {
    const r = this.view.renderer.domElement.getBoundingClientRect();
    this.ray ||= new THREE.Raycaster();
    this.ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.view.camera);
    return this.ray;
  }
  /** Where a pointer ray meets the world: an object's surface, else the ground plane. */
  surfacePoint(ev) {
    const ray = this.pointerRay(ev);
    const hit = ray.intersectObjects([...this.sync.entries.values()].filter((e) => e.object.visible).map((e) => e.object), true)[0];
    if (hit) return hit.point;
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : this.view.orbit.target.clone().setY(0);
  }

  bindViewport() {
    const dom = this.view.renderer.domElement;
    const on = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); this.offs.push(() => t.removeEventListener(type, fn, opts)); };
    let down = null;
    on(dom, 'pointerdown', (ev) => {
      down = { x: ev.clientX, y: ev.clientY };
      if (this.brush.active && ev.button === 0 && !this.playing) {
        const hit = this.terrainHit(ev);
        if (hit) { this.sculpting = { ev, changed: false }; this.view.orbit.enabled = false; dom.setPointerCapture(ev.pointerId); delete hit.object.userData.flattenTarget; }
      }
    });
    on(dom, 'pointermove', (ev) => {
      if (this.sculpting) this.sculpting.ev = ev;
      if (this.brush.active && !this.playing) {
        const hit = this.terrainHit(ev);
        this.brushRing.visible = !!hit;
        if (hit) { this.brushRing.position.copy(hit.point).setY(hit.point.y + 0.05); this.brushRing.scale.setScalar(this.brush.radius); }
      }
    });
    on(dom, 'pointerup', (ev) => {
      if (this.sculpting) {
        const entry = this.sync.entries.get(this.selected);
        if (entry && this.sculpting.changed) {
          const mesh = entry.object.children[0];
          this.world.set(this.selected, { props: { ...entry.data.props, heights: encodeHeights(mesh.userData.heights) } });
        }
        this.sculpting = null;
        this.view.orbit.enabled = true;
        return;
      }
      if (!down || this.playing || this.gizmoDragging || !this.canEdit) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      down = null;
      if (moved > 5 || ev.button !== 0) return;
      const pickable = [...this.sync.entries.values()].filter((e) => e.object.visible && !e.data.locked).map((e) => e.object);
      const hit = this.pointerRay(ev).intersectObjects(pickable, true)[0];
      this.select(hit ? this.sync.idOf(hit.object) : null);
    });

    // drag from the library and drop into the scene
    on(this.viewportEl, 'dragover', (ev) => { if (this.canEdit && this.library?.dragData) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
    on(this.viewportEl, 'drop', (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer.files?.length) return void this.library?.importFiles([...ev.dataTransfer.files], this.surfacePoint(ev));
      const data = this.library?.dragData;
      if (data) this.addObject(data, this.surfacePoint(ev));
    });
    on(this.viewportEl, 'dragover', (ev) => { if (this.canEdit && ev.dataTransfer.types.includes('Files')) ev.preventDefault(); });

    on(window, 'keydown', (ev) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable || ev.target.closest?.('.code-panel, .modal')) return;
      if (this.playing) { if (ev.key === 'Escape') this.stop(); return; }
      if (!this.canEdit) return;
      const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
      if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? this.world.undo.redo() : this.world.undo.undo(); } else if (mod && k === 'y') { ev.preventDefault(); this.world.undo.redo(); } else if (mod && k === 'd') { ev.preventDefault(); this.duplicateSelected(); } else if (mod) return;
      else if (k === 'delete' || k === 'backspace') this.deleteSelected();
      else if (k === 'q') this.setTool('select');
      else if (k === 'w') this.setTool('translate');
      else if (k === 'e') this.setTool('rotate');
      else if (k === 'r') this.setTool('scale');
      else if (k === 'f') this.focusSelected();
      else if (k === 'escape') this.select(null);
    });
  }
  terrainHit(ev) {
    const entry = this.sync.entries.get(this.selected);
    return entry ? this.pointerRay(ev).intersectObject(entry.object, true)[0] : null;
  }

  frame(dt) {
    if (this.sculpting) {
      const hit = this.terrainHit(this.sculpting.ev);
      if (hit) {
        sculpt(hit.object, hit.object.worldToLocal(hit.point.clone()), this.brush, dt);
        this.sculpting.changed = true;
      }
    }
    const sel = !this.playing && this.sync.entries.get(this.selected);
    this.selBox.visible = !!sel;
    if (sel) this.selBox.setFromObject(sel.object);
    for (const box of this.remoteBoxes.values()) {
      const target = !this.playing && this.sync.entries.get(box.userData.target);
      box.visible = !!target;
      if (target) box.setFromObject(target.object);
    }
    if (this.playing) this.runtime?.update(dt);
  }

  // ------------------------------------------------------------------ play mode
  log(kind, text) {
    this.consoleEl.hidden = false;
    const line = h('div.line.' + kind, null, text);
    this.consoleEl.append(line);
    while (this.consoleEl.children.length > 60) this.consoleEl.firstChild.remove();
    this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
  }
  async getScript(id) {
    const m = this.world.objects.get(id);
    if (!m) return null;
    const mode = m.get('mode') || 'blocks';
    if (mode === 'blocks') {
      const json = m.get('blocks');
      if (!json) return null;
      const { blocksToCode } = await import('../blocks/blocks.js');
      return { lang: 'js', code: blocksToCode(json, 'js') };
    }
    return { lang: mode, code: m.get(mode)?.toString() || '' };
  }
  async play() {
    if (this.playing || this.starting) return;
    this.starting = true;
    this.code?.flush();
    document.activeElement?.blur?.(); // keys should drive the world now, not a text box
    this.select(null);
    this.playing = true;
    this.sync.paused = true;
    this.gizmo?.detach();
    this.grid.visible = false;
    this.el.classList.add('playing');
    this.playBtn.textContent = '■ Stop';
    clear(this.consoleEl).hidden = true;
    this.runtime = new Runtime({
      view: this.view, entries: this.sync.entries, settings: this.settings(), assetUrl: this.ctx.assetUrl,
      log: (kind, text) => this.log(kind, text), hud: (text) => { this.hudEl.textContent = text; },
      getScript: (id) => this.getScript(id),
    });
    this.view.onXRSelect = (ray) => this.runtime?.clickRay(ray);
    try {
      await this.runtime.start();
    } catch (e) {
      this.log('error', e.message || String(e));
    }
    this.starting = false;
  }
  stop() {
    if (!this.playing || this.starting) return;
    this.view.exitXR();
    this.view.exitCardboard();
    this.runtime.stop();
    this.runtime = null;
    this.playing = false;
    this.el.classList.remove('playing');
    this.playBtn.textContent = '▶ Play';
    this.hudEl.textContent = '';
    this.grid.visible = true;
    if (!this.consoleEl.querySelector('.error')) this.consoleEl.hidden = true; // keep errors on screen to read
    this.sync.paused = false;
    this.sync.rebuildAll();
    this.view.applySettings(this.settings());
  }

  async updateXRButtons() {
    const s = await View.xrSupport();
    this.vrBtn.hidden = !(s.vr || s.cardboard);
    this.vrBtn.textContent = s.vr ? 'VR' : 'Cardboard';
    this.arBtn.hidden = !s.ar;
    this.xr = s;
  }
  async enterVR() {
    try {
      if (!this.xr.vr) {
        if (this.view.cardboard) return this.view.exitCardboard();
        const p = this.view.enterCardboard();
        await this.play();
        return await p;
      }
      const p = this.view.enterVR(); // must start inside the click, before anything slow
      await this.play();
      await p;
    } catch (e) { toast(e.message || 'Could not start VR on this device.', 'error'); }
  }
  async enterAR() {
    try {
      const p = this.view.enterAR(this.settings().arScale, this.arBar);
      this.arBar.hidden = false;
      this.view.onXREnd = () => { this.arBar.hidden = true; };
      await this.play();
      await p;
    } catch (e) { this.arBar.hidden = true; toast(e.message || 'Could not start AR on this device.', 'error'); }
  }

  // ------------------------------------------------------------------ sharing
  shareDialog() {
    const link = `${location.origin}/world/${this.meta.id}`;
    const options = [['private', 'Only me'], ['view', 'Anyone signed in with the link can explore and play'], ['edit', 'Anyone signed in with the link can build with me']];
    const body = h('div.share', null,
      h('p', null, 'Choose who can open this world, then send them the link.'),
      options.map(([value, label]) => h('label.radio', null,
        h('input', { type: 'radio', name: 'share', value, checked: this.meta.share === value,
          onChange: async () => { try { this.meta = (await api.updateWorld(this.meta.id, { share: value })).world; toast('Sharing updated'); } catch (e) { toast(e.message, 'error'); } } }), label)),
      h('div.row', null, h('input', { readOnly: true, value: link, 'aria-label': 'Link to this world', onFocus: (e) => e.target.select() }),
        h('button.btn.primary', { onClick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Select the link and copy it.', 'error'); } } }, 'Copy link')));
    modal('Share world', body);
  }
  async makeCopy() {
    try { const { world } = await api.copyWorld(this.meta.id); toast('Copied to your worlds'); this.navigate(`/world/${world.id}`); } catch (e) { toast(e.message, 'error'); }
  }
  showViewerIntro() {
    this.hudEl.textContent = '';
    toast('You are exploring this world. Press Play to start it.');
  }

  async saveThumb() {
    if (!this.canEdit || this.playing || !this.view) return;
    try {
      const blob = await this.view.snapshot();
      if (blob) await api.saveThumbnail(this.meta.id, blob);
    } catch { /* thumbnails are best-effort */ }
  }

  async close() {
    this.thumbSoon?.cancel();
    if (this.playing) { this.starting = false; this.stop(); }
    this.select(null);
    await Promise.race([this.saveThumb(), new Promise((r) => setTimeout(r, 1500))]);
    this.destroy();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs) off();
    this.code?.destroy();
    this.sync?.dispose();
    this.view?.dispose();
    this.world?.destroy();
  }
}
