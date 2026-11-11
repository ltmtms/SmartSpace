// Bottom panel: program the selected object with blocks, JavaScript or Python.
// Blocks compile to both languages, so a learner can switch to text and keep going from the same program.
import { h, clear, toast, debounce } from '../ui/dom.js';
import { LOCAL } from '../collab/doc.js';
import { BASE } from '../env.js';
import * as Y from 'yjs';

const HELP = {
  js: `// "me" is this object. Examples:
when.start(() => { me.say("Hi!"); });
me.onClick(() => { me.push(0, 5, 0); world.playSound("jump"); });
me.onCollide((other) => { if (other.isPlayer) me.destroy(); });
when.key("space", () => me.moveBy(0, 1, 0));
when.update((dt) => { if (input.keyDown("right")) me.x += 3 * dt; });
when.every(2, async () => { await me.glideTo(0, 3, 0, 1); });

// Motion   me.x / y / z, moveBy, setPosition, moveForward, turn, rotateBy, lookAt, glideTo, setScale
// Looks    me.color = "red", opacity, show(), hide(), say(text, seconds), setText
// Animate  me.animate("spin" | "bounce" | "float" | "pulse" | "wobble", speed), stopAnimation()
// Physics  me.dynamic, gravity, solid, mass, friction, bounciness, push, setVelocity, setCollision(layer, [layers])
// World    world.find(name), spawn(kind, x, y, z), playSound(name), showText(text), gravity, vars, broadcast(msg)
// Other    wait(seconds), print(value), player, me.clone(), me.destroy(), me.isTouching(other), me.distanceTo(other)`,
  py: `# "me" is this object. Examples:
@when_start
def start():
    me.say("Hi!")

@when_clicked
def clicked():
    me.push(0, 5, 0)
    world.play_sound("jump")

@when_collides
def bump(other):
    if other.isPlayer:
        me.destroy()

@when_key("space")
def jump():
    me.move_by(0, 1, 0)

@when_update
def frame(dt):
    if input.key_down("right"):
        me.x += 3 * dt

@every(2)
async def patrol():
    await me.glide_to(0, 3, 0, 1)

# Same commands as JavaScript, in snake_case: move_by, set_position, look_at, set_scale,
# play_sound, show_text, set_velocity ...  Use "await wait(1)" inside "async def" to pause.`,
};

export class CodePanel {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
    this.id = null;
    this.tabBtns = Object.fromEntries([['blocks', 'Blocks'], ['js', 'JavaScript'], ['py', 'Python']].map(([k, label]) => [k, h('button', { onClick: () => this.setMode(k) }, label)]));
    this.titleEl = h('strong');
    this.runsEl = h('span.hint');
    this.bodyEl = h('div.code-body');
    this.convertBtn = h('button.btn.small', { onClick: () => this.regenerate() }, 'Rebuild from blocks');
    el.append(h('header', null, this.titleEl, h('div.tabs', { role: 'tablist' }, Object.values(this.tabBtns)), this.runsEl, h('span.spacer'),
      this.convertBtn,
      h('button.btn.small', { onClick: () => this.toggleHelp() }, 'Examples'),
      h('button.icon-btn', { title: 'Close code', 'aria-label': 'Close code', onClick: () => this.close() }, '✕')), this.bodyEl);
    this.saveBlocks = debounce(() => this.writeBlocks(), 250);
  }

  get map() { return this.editor.world.objects.get(this.id); }

  async open() {
    this.id = this.editor.selected;
    if (!this.id) return;
    this.el.hidden = false;
    this.editor.el.classList.add('coding');
    this.mode = this.map.get('mode') || 'blocks';
    await this.show();
  }
  close() {
    this.flush();
    this.teardown();
    this.el.hidden = true;
    this.editor.el.classList.remove('coding');
    this.id = null;
  }
  selectionChanged() {
    if (this.el.hidden) return;
    if (this.editor.selected && this.editor.selected !== this.id) this.open();
    else if (!this.editor.selected && !this.editor.sync.entries.has(this.id)) this.close();
  }
  objectsChanged() {
    if (!this.el.hidden && this.id && !this.editor.world.objects.get(this.id)) this.close();
  }
  flush() { if (this.ws && this.blocksDirty) this.saveBlocks.flush(); }

  teardown() {
    if (this.mapObserver) { this.observed?.unobserve(this.mapObserver); this.mapObserver = null; }
    this.ws?.dispose();
    this.ws = null;
    this.cm?.destroy();
    this.cm = null;
    this.resizeObs?.disconnect();
    clear(this.bodyEl);
  }

  /** Switching tabs chooses which program runs for this object. */
  async setMode(mode) {
    if (mode === this.mode) return;
    this.flush();
    if (mode !== 'blocks') {
      const text = this.editor.world.codeText(this.id, mode);
      if (!text.toString().trim() && this.map.get('blocks')) {
        const { blocksToCode } = await import('../blocks/blocks.js');
        const code = blocksToCode(this.map.get('blocks'), mode);
        if (code.trim()) this.editor.world.transact(() => { text.delete(0, text.length); text.insert(0, code); });
      }
    }
    this.mode = mode;
    this.editor.world.set(this.id, { mode });
    await this.show();
  }

  async regenerate() {
    if (this.mode === 'blocks' || !this.map.get('blocks')) return;
    const text = this.editor.world.codeText(this.id, this.mode);
    if (text.toString().trim() && !confirm('Replace the code here with code made from this object\'s blocks?')) return;
    const { blocksToCode } = await import('../blocks/blocks.js');
    const code = blocksToCode(this.map.get('blocks'), this.mode);
    this.editor.world.transact(() => { text.delete(0, text.length); text.insert(0, code); });
  }

  toggleHelp() {
    const lang = this.mode === 'py' ? 'py' : 'js';
    if (this.helpEl?.isConnected) return void this.helpEl.remove();
    this.helpEl = h('pre.help', null, this.mode === 'blocks'
      ? 'Drag an orange "when…" block from Events, then snap action blocks inside it.\nOnly blocks inside an event (or a function) run.\n\nTip: build with blocks first, then open the JavaScript or Python tab to see the same program as real code.'
      : HELP[lang]);
    this.bodyEl.append(this.helpEl);
  }

  async show() {
    this.teardown();
    const token = (this.token = {});
    const data = this.editor.world.data(this.id);
    this.titleEl.textContent = data?.name || '';
    for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('active', k === this.mode);
    this.runsEl.textContent = `This object runs its ${this.mode === 'blocks' ? 'blocks' : this.mode === 'js' ? 'JavaScript' : 'Python'}.`;
    this.convertBtn.hidden = this.mode === 'blocks' || !this.map.get('blocks');
    const host = h('div.code-host');
    this.bodyEl.append(host);
    if (this.mode === 'blocks') await this.showBlocks(host, token); else await this.showText(host, token);
    // follow collaborators: mode switches and renames
    this.mapObserver = (ev, tr) => {
      if (ev.keysChanged.has('name')) this.titleEl.textContent = this.map.get('name');
      if (ev.keysChanged.has('mode') && tr.origin !== LOCAL && this.map.get('mode') !== this.mode) { this.mode = this.map.get('mode'); this.show(); }
      if (ev.keysChanged.has('blocks') && tr.origin !== LOCAL && this.ws) this.loadBlocks();
    };
    this.observed = this.map;
    this.observed.observe(this.mapObserver);
  }

  async showBlocks(host, token) {
    const { Blockly, TOOLBOX, setObjectNameSource } = await import('../blocks/blocks.js');
    if (token !== this.token) return;
    this.Blockly = Blockly;
    setObjectNameSource(() => [...new Set([...this.editor.sync.entries.values()].map((e) => e.data.name))].sort());
    this.ws = Blockly.inject(host, {
      toolbox: TOOLBOX, trashcan: true, renderer: 'zelos',
      zoom: { controls: true, wheel: true, startScale: 0.8, maxScale: 1.6, minScale: 0.4 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: '#d5d9e0', snap: false },
      media: `${BASE}blockly-media/`,
    });
    this.loadBlocks();
    this.ws.addChangeListener((e) => {
      if (e.isUiEvent || this.loading) return;
      this.blocksDirty = true;
      this.saveBlocks();
    });
    this.resizeObs = new ResizeObserver(() => this.ws && Blockly.svgResize(this.ws));
    this.resizeObs.observe(host);
  }
  loadBlocks() {
    const json = this.map.get('blocks');
    this.loading = true;
    this.Blockly.Events.disable();
    try {
      this.ws.clear();
      if (json) this.Blockly.serialization.workspaces.load(JSON.parse(json), this.ws);
    } catch (e) { toast('These blocks could not be loaded.', 'error'); } finally {
      this.Blockly.Events.enable();
      this.loading = false;
      this.blocksDirty = false;
    }
  }
  writeBlocks() {
    if (!this.ws || !this.map) return;
    this.blocksDirty = false;
    const state = this.Blockly.serialization.workspaces.save(this.ws);
    const json = this.ws.getAllBlocks(false).length ? JSON.stringify(state) : '';
    if (json !== (this.map.get('blocks') || '')) this.editor.world.set(this.id, { blocks: json });
  }

  async showText(host, token) {
    const [{ EditorView, basicSetup }, { keymap }, { indentWithTab }, lang, { yCollab, yUndoManagerKeymap }, { indentUnit }] = await Promise.all([
      import('codemirror'), import('@codemirror/view'), import('@codemirror/commands'),
      this.mode === 'py' ? import('@codemirror/lang-python') : import('@codemirror/lang-javascript'),
      import('y-codemirror.next'), import('@codemirror/language'),
    ]);
    if (token !== this.token) return;
    const text = this.editor.world.codeText(this.id, this.mode);
    const undoManager = new Y.UndoManager(text);
    this.cm = new EditorView({
      doc: text.toString(),
      parent: host,
      extensions: [
        keymap.of([...yUndoManagerKeymap, indentWithTab]),
        basicSetup,
        indentUnit.of(this.mode === 'py' ? '    ' : '  '),
        this.mode === 'py' ? lang.python() : lang.javascript(),
        yCollab(text, this.editor.world.awareness, { undoManager }),
        EditorView.theme({ '&': { height: '100%', fontSize: '14px' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' } }),
      ],
    });
    if (!text.toString().trim()) this.toggleHelp();
  }

  destroy() { this.teardown(); }
}
