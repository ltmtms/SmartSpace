// Right panel: properties of the selected object, or world settings when nothing is selected.
import { h, clear } from '../ui/dom.js';
import { DEFAULT_PHYSICS } from '../../shared/schema.js';

const DEG = 180 / Math.PI;
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

export class Inspector {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
    this.fields = []; // { input, read(data) } kept in step with the document without stealing focus
  }

  // ---- field builders
  bind(input, read) { this.fields.push({ input, read }); return input; }
  number(read, write, { step = 0.1, min, max } = {}) {
    const input = h('input', { type: 'number', step, min, max, onChange: () => { const v = parseFloat(input.value); if (Number.isFinite(v)) write(v); } });
    return this.bind(input, (d) => round(read(d), 3));
  }
  vec(label, read, write, opts) {
    return h('div.field', null, h('label', null, label), h('div.vec', null, ['X', 'Y', 'Z'].map((axis, i) =>
      h('label', null, h('span', null, axis), this.number((d) => read(d)[i], (v) => { const a = [...read(this.data())]; a[i] = v; write(a); }, opts)))));
  }
  row(label, control) { return h('div.field.inline', null, h('label', null, label), control); }
  text(read, write) {
    const input = h('input', { type: 'text', onChange: () => write(input.value) });
    return this.bind(input, read);
  }
  color(read, write) {
    const input = h('input', { type: 'color', onInput: () => write(input.value) });
    return this.bind(input, (d) => (/^#[0-9a-f]{6}$/i.test(read(d)) ? read(d) : '#888888'));
  }
  check(read, write) {
    const input = h('input', { type: 'checkbox', onChange: () => write(input.checked) });
    this.fields.push({ input, read, checkbox: true });
    return input;
  }
  select(options, read, write) {
    const input = h('select', { onChange: () => write(input.value) }, options.map(([v, l]) => h('option', { value: v }, l)));
    return this.bind(input, read);
  }
  range(read, write, { min = 0, max = 1, step = 0.05 } = {}) {
    const input = h('input', { type: 'range', min, max, step, onInput: () => write(parseFloat(input.value)) });
    return this.bind(input, read);
  }

  data() { return this.editor.sync.entries.get(this.editor.selected)?.data; }
  set(patch) { this.editor.world.set(this.editor.selected, patch); }
  setProps(patch) { this.set({ props: { ...this.data().props, ...patch } }); }
  setPhys(patch) { this.set({ physics: { ...DEFAULT_PHYSICS, ...this.data().physics, ...patch } }); }

  render() {
    this.fields = [];
    clear(this.el);
    const d = this.data();
    if (!d) this.renderWorld(); else this.renderObject(d);
    this.sync();
  }

  /** Push current document values into the inputs (skipping whichever one the user is typing in). */
  sync() {
    const ed = this.editor;
    const d = this.data() || ed.settings();
    for (const f of this.fields) {
      if (f.input === document.activeElement && !f.checkbox && f.input.type !== 'range' && f.input.type !== 'color') continue;
      const v = f.read(d);
      if (f.checkbox) f.input.checked = !!v; else if (String(f.input.value) !== String(v)) f.input.value = v;
    }
    this.afterSync?.(d);
  }

  renderWorld() {
    const ed = this.editor, w = ed.world;
    const set = (k, v) => w.transact(() => w.settings.set(k, v));
    this.afterSync = null;
    this.el.append(
      h('h2', null, 'World settings'),
      h('p.hint', null, 'Click an object to edit it. These settings apply to the whole world.'),
      h('h3', null, 'Physics'),
      this.row('Gravity', this.number((s) => s.gravity, (v) => set('gravity', v), { step: 0.5 })),
      h('div.chips', null, [['Earth', -9.81], ['Moon', -1.62], ['Mars', -3.71], ['Space', 0]].map(([n, g]) => h('button.chip', { onClick: () => set('gravity', g) }, n))),
      h('h3', null, 'Exploring'),
      this.row('When playing', this.select([['orbit', 'Look around (orbit)'], ['walk', 'Walk in first person'], ['fly', 'Fly']], (s) => s.playerMode, (v) => set('playerMode', v))),
      this.row('Move speed', this.number((s) => s.playerSpeed, (v) => set('playerSpeed', Math.max(0.1, v)), { step: 0.5, min: 0.1 })),
      this.row('AR size', this.select([['0.02', 'Tiny (1:50)'], ['0.05', 'Small (1:20)'], ['0.1', 'Table-top (1:10)'], ['0.25', 'Large (1:4)'], ['1', 'Life-size']], (s) => String(s.arScale), (v) => set('arScale', parseFloat(v)))),
      h('h3', null, 'Look'),
      this.row('Sky', this.color((s) => s.skyColor, (v) => set('skyColor', v))),
      this.row('Sunlight', this.range((s) => s.sunIntensity, (v) => set('sunIntensity', v), { max: 5, step: 0.1 })),
      this.row('Soft light', this.range((s) => s.ambientIntensity, (v) => set('ambientIntensity', v), { max: 3, step: 0.1 })),
      h('h3', null, 'Shortcuts'),
      h('p.hint', null, 'W move · E rotate · R resize · F focus · Del delete · Ctrl+D duplicate · Ctrl+Z undo'));
  }

  renderObject(d) {
    const ed = this.editor;
    const hasColor = ['primitive', 'text', 'light'].includes(d.type);
    const physical = !['audio', 'light'].includes(d.type);
    const parts = [
      h('div.field', null, h('label', null, 'Name'), this.text((x) => x.name, (v) => this.set({ name: v.trim().slice(0, 40) || d.name }))),
      h('div.actions', null,
        h('button.btn.primary', { onClick: () => ed.code.open() }, '{ } Code'),
        h('button.btn', { onClick: () => ed.duplicateSelected(), title: 'Duplicate (Ctrl+D)' }, 'Duplicate'),
        h('button.btn.danger', { onClick: () => ed.deleteSelected(), title: 'Delete (Del)' }, 'Delete')),
      h('h3', null, 'Position & size'),
      this.vec('Position', (x) => x.pos, (v) => this.set({ pos: v })),
      this.vec('Rotation (degrees)', (x) => x.rot.map((r) => round(r * DEG, 1)), (v) => this.set({ rot: v.map((r) => r / DEG) }), { step: 5 }),
      this.vec('Size', (x) => x.scl, (v) => this.set({ scl: v.map((s) => Math.max(0.01, Math.abs(s))) }), { step: 0.1, min: 0.01 }),
    ];

    if (d.type === 'text') parts.push(h('h3', null, '3D text'),
      h('div.field', null, h('label', null, 'Words'), this.text((x) => x.props.text ?? '', (v) => this.setProps({ text: v.slice(0, 80) }))),
      this.row('Thickness', this.number((x) => x.props.depth ?? 0.25, (v) => this.setProps({ depth: Math.max(0.01, Math.min(5, v)) }), { step: 0.05, min: 0.01 })));
    if (d.type === 'light') parts.push(h('h3', null, 'Light'),
      this.row('Brightness', this.number((x) => x.props.intensity ?? 30, (v) => this.setProps({ intensity: Math.max(0, v) }), { step: 5, min: 0 })),
      this.row('Reach', this.number((x) => x.props.distance ?? 20, (v) => this.setProps({ distance: Math.max(0, v) }), { step: 1, min: 0 })));
    if (d.type === 'audio') parts.push(h('h3', null, 'Sound'),
      h('p.hint', null, `Play it from code with world.playSound("${d.name}") or the "play my imported sound" block.`),
      this.row('Play at start', this.check((x) => x.props.autoplay, (v) => this.setProps({ autoplay: v }))),
      this.row('Loop', this.check((x) => x.props.loop, (v) => this.setProps({ loop: v }))),
      this.row('3D sound (louder when near)', this.check((x) => x.props.positional, (v) => this.setProps({ positional: v }))),
      this.row('Volume', this.range((x) => x.props.volume ?? 1, (v) => this.setProps({ volume: v }))));
    if (d.type === 'terrain') {
      const modes = [['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']];
      const sculptBtn = h('button.btn.wide', { onClick: () => { ed.setBrush(!ed.brush.active); this.afterSync(); } });
      const modeBtns = modes.map(([m, l]) => h('button.chip', { onClick: () => { ed.brush.mode = m; ed.setBrush(true); this.afterSync(); } }, l));
      parts.push(h('h3', null, 'Sculpt'), sculptBtn, h('div.chips', null, modeBtns),
        this.row('Brush size', h('input', { type: 'range', min: 0.5, max: 10, step: 0.5, value: ed.brush.radius, onInput: (e) => { ed.brush.radius = +e.target.value; } })),
        this.row('Strength', h('input', { type: 'range', min: 0.2, max: 3, step: 0.1, value: ed.brush.strength, onInput: (e) => { ed.brush.strength = +e.target.value; } })),
        h('p.hint', null, 'Turn sculpting on, then press and drag on the terrain to shape hills and valleys.'),
        h('button.btn', { onClick: () => this.setProps({ heights: '' }) }, 'Flatten everything'));
      this.afterSync = () => {
        sculptBtn.textContent = ed.brush.active ? 'Sculpting is on - click to finish' : 'Start sculpting';
        sculptBtn.classList.toggle('primary', ed.brush.active);
        modeBtns.forEach((b, i) => b.classList.toggle('active', ed.brush.active && ed.brush.mode === modes[i][0]));
      };
    } else this.afterSync = null;

    parts.push(h('h3', null, 'Look'));
    if (hasColor) parts.push(this.row('Colour', this.color((x) => x.color, (v) => this.set({ color: v }))));
    if (d.type !== 'audio') parts.push(this.row('See-through', this.range((x) => 1 - (x.opacity ?? 1), (v) => this.set({ opacity: round(1 - v) }), { max: 0.9 })));
    parts.push(this.row('Visible', this.check((x) => x.visible !== false, (v) => this.set({ visible: v }))));

    if (physical) {
      const p = (x) => ({ ...DEFAULT_PHYSICS, ...x.physics });
      const layerBoxes = h('div.layers', null, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('label', { title: `Collide with layer ${n}` },
        this.check((x) => p(x).mask.includes(n), (on) => { const m = new Set(p(this.data()).mask); on ? m.add(n) : m.delete(n); this.setPhys({ mask: [...m].sort() }); }), n)));
      parts.push(h('h3', null, 'Physics'),
        d.type !== 'terrain' && this.row('Moves with physics', this.check((x) => p(x).dynamic, (v) => this.setPhys({ dynamic: v }))),
        this.row('Solid (things bump into it)', this.check((x) => p(x).solid, (v) => this.setPhys({ solid: v }))),
        d.type !== 'terrain' && this.row('Pulled by gravity', this.check((x) => p(x).gravity, (v) => this.setPhys({ gravity: v }))),
        d.type !== 'terrain' && this.row('Mass (kg)', this.number((x) => p(x).mass, (v) => this.setPhys({ mass: Math.max(0.01, v) }), { step: 0.5, min: 0.01 })),
        this.row('Friction', this.range((x) => p(x).friction, (v) => this.setPhys({ friction: v }), { max: 2 })),
        this.row('Bounciness', this.range((x) => p(x).bounciness, (v) => this.setPhys({ bounciness: v }), { max: 1.2 })),
        d.type !== 'terrain' && this.row('Collision shape', this.select([['auto', 'Automatic'], ['box', 'Box'], ['sphere', 'Ball'], ['hull', 'Wrap (convex)'], ['mesh', 'Exact (still objects only)']], (x) => p(x).shape, (v) => this.setPhys({ shape: v }))),
        this.row('Collision layer', this.select([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), `Layer ${n}`]), (x) => String(p(x).layer), (v) => this.setPhys({ layer: +v }))),
        h('div.field', null, h('label', null, 'Collides with layers'), layerBoxes));
    }
    this.el.append(...parts.filter(Boolean));
  }
}
