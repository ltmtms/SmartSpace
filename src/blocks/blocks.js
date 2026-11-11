// Visual programming blocks for spatial logic. Each block is described once in a table and
// compiles to both JavaScript and Python, so learners can flip from blocks to real code.
import * as Blockly from 'blockly/core';
import * as libraryBlocks from 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { javascriptGenerator as JS, Order as JSOrder } from 'blockly/javascript';
import { pythonGenerator as PY, Order as PYOrder } from 'blockly/python';
import { SOUND_NAMES } from '../engine/sounds.js';

Blockly.setLocale(En);
void libraryBlocks;

const COLORS = { events: 45, motion: 215, looks: 280, anim: 320, physics: 15, sound: 175, control: 120, sensing: 195, world: 255 };
const KEYS = ['space', 'up', 'down', 'left', 'right', 'w', 'a', 's', 'd', 'e', 'q', 'enter', 'any'].map((k) => [k, k]);
const PALETTE = [['red', '#ef4444'], ['orange', '#f97316'], ['yellow', '#facc15'], ['green', '#22c55e'], ['blue', '#3b82f6'], ['purple', '#a855f7'], ['pink', '#ec4899'], ['white', '#ffffff'], ['black', '#111827'], ['gray', '#94a3b8']];

/** Names of the objects in the open world, for the "object named" dropdown. Set by the code panel. */
let objectNames = () => [];
export function setObjectNameSource(fn) { objectNames = fn; }

const T = { type: 'input_value', name: 'T' }; // "which object" input, defaults to `me`
const N = (name) => ({ type: 'input_value', name, check: 'Number' });
const V = (name) => ({ type: 'input_value', name });
const DD = (name, options) => ({ type: 'field_dropdown', name, options });
const snake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

// kind: stmt | value | hat.  `code` is a template: {X} = value input, [F] = field. The method name is
// snake_cased for Python.  Hats give the (JS, Python) registration call instead.
const DEFS = [
  // ---- events
  { type: 'ss_when_start', cat: 'events', kind: 'hat', msg: 'when the world starts', hat: ['when.start', 'when_start'] },
  { type: 'ss_when_clicked', cat: 'events', kind: 'hat', msg: 'when %1 is clicked', args: [T], hat: ['when.clicked', 'when_clicked'], hatArgs: '{T}' },
  { type: 'ss_when_collides', cat: 'events', kind: 'hat', msg: 'when %1 touches something', args: [T], hat: ['when.collides', 'when_collides'], hatArgs: '{T}', params: 'other' },
  { type: 'ss_when_key', cat: 'events', kind: 'hat', msg: 'when key %1 is pressed', args: [DD('KEY', KEYS)], hat: ['when.key', 'when_key'], hatArgs: '"[KEY]"' },
  { type: 'ss_every_frame', cat: 'events', kind: 'hat', msg: 'every frame', hat: ['when.update', 'when_update'] },
  { type: 'ss_every', cat: 'events', kind: 'hat', msg: 'every %1 seconds', args: [N('S')], hat: ['when.every', 'every'], hatArgs: '{S}' },
  { type: 'ss_when_message', cat: 'events', kind: 'hat', msg: 'when I receive message %1', args: [{ type: 'field_input', name: 'MSG', text: 'go' }], hat: ['when.message', 'when_message'], hatArgs: '"[MSG]"' },
  { type: 'ss_broadcast', cat: 'events', kind: 'stmt', msg: 'broadcast message %1', args: [{ type: 'field_input', name: 'MSG', text: 'go' }], code: 'world.broadcast("[MSG]")' },

  // ---- motion
  { type: 'ss_move_by', cat: 'motion', kind: 'stmt', msg: 'move %1 by x %2 y %3 z %4', args: [T, N('X'), N('Y'), N('Z')], code: '{T}.moveBy({X}, {Y}, {Z})' },
  { type: 'ss_set_pos', cat: 'motion', kind: 'stmt', msg: 'set position of %1 to x %2 y %3 z %4', args: [T, N('X'), N('Y'), N('Z')], code: '{T}.setPosition({X}, {Y}, {Z})' },
  { type: 'ss_move_forward', cat: 'motion', kind: 'stmt', msg: 'move %1 forward %2', args: [T, N('D')], code: '{T}.moveForward({D})' },
  { type: 'ss_turn', cat: 'motion', kind: 'stmt', msg: 'turn %1 by %2 degrees', args: [T, N('D')], code: '{T}.turn({D})' },
  { type: 'ss_rotate_by', cat: 'motion', kind: 'stmt', msg: 'rotate %1 by x %2 y %3 z %4 degrees', args: [T, N('X'), N('Y'), N('Z')], code: '{T}.rotateBy({X}, {Y}, {Z})' },
  { type: 'ss_set_rot', cat: 'motion', kind: 'stmt', msg: 'set rotation of %1 to x %2 y %3 z %4', args: [T, N('X'), N('Y'), N('Z')], code: '{T}.setRotation({X}, {Y}, {Z})' },
  { type: 'ss_look_at', cat: 'motion', kind: 'stmt', msg: 'make %1 look at %2', args: [T, V('O')], code: '{T}.lookAt({O})' },
  { type: 'ss_glide', cat: 'motion', kind: 'stmt', msg: 'glide %1 to x %2 y %3 z %4 in %5 seconds', args: [T, N('X'), N('Y'), N('Z'), N('S')], code: '{T}.glideTo({X}, {Y}, {Z}, {S})', await: true },
  { type: 'ss_set_scale', cat: 'motion', kind: 'stmt', msg: 'set size of %1 to %2', args: [T, N('S')], code: '{T}.setScale({S})' },
  { type: 'ss_get_pos', cat: 'motion', kind: 'value', out: 'Number', msg: '%1 position of %2', args: [DD('AXIS', [['x', 'x'], ['y', 'y'], ['z', 'z']]), T], code: '{T}.[AXIS]' },
  { type: 'ss_distance', cat: 'motion', kind: 'value', out: 'Number', msg: 'distance from %1 to %2', args: [T, V('O')], code: '{T}.distanceTo({O})' },

  // ---- looks
  { type: 'ss_set_color', cat: 'looks', kind: 'stmt', msg: 'set color of %1 to %2', args: [T, V('C')], code: '{T}.setColor({C})' },
  { type: 'ss_color', cat: 'looks', kind: 'value', out: 'String', msg: '%1', args: [DD('C', PALETTE)], code: '"[C]"' },
  { type: 'ss_show_hide', cat: 'looks', kind: 'stmt', msg: '%1 %2', args: [DD('M', [['show', 'show'], ['hide', 'hide']]), T], code: '{T}.[M]()' },
  { type: 'ss_say', cat: 'looks', kind: 'stmt', msg: '%1 says %2 for %3 seconds', args: [T, V('MSG'), N('S')], code: '{T}.say({MSG}, {S})' },
  { type: 'ss_set_opacity', cat: 'looks', kind: 'stmt', msg: 'set see-through of %1 to %2 (0 to 1)', args: [T, N('O')], code: '{T}.opacity = {O}' },
  { type: 'ss_set_text', cat: 'looks', kind: 'stmt', msg: 'set 3D text of %1 to %2', args: [T, V('TXT')], code: '{T}.setText({TXT})' },
  { type: 'ss_show_text', cat: 'looks', kind: 'stmt', msg: 'show on screen %1', args: [V('TXT')], code: 'world.showText({TXT})' },
  { type: 'ss_set_sky', cat: 'looks', kind: 'stmt', msg: 'set sky color to %1', args: [V('C')], code: 'world.setSky({C})' },

  // ---- animation
  { type: 'ss_animate', cat: 'anim', kind: 'stmt', msg: 'start %1 animation on %2 speed %3', args: [DD('A', ['spin', 'bounce', 'float', 'pulse', 'wobble'].map((a) => [a, a])), T, N('S')], code: '{T}.animate("[A]", {S})' },
  { type: 'ss_animate_clip', cat: 'anim', kind: 'stmt', msg: 'play model animation %1 on %2', args: [{ type: 'field_input', name: 'A', text: 'Walk' }, T], code: '{T}.animate("[A]")' },
  { type: 'ss_stop_anim', cat: 'anim', kind: 'stmt', msg: 'stop animations on %1', args: [T], code: '{T}.stopAnimation()' },

  // ---- physics
  { type: 'ss_set_physics', cat: 'physics', kind: 'stmt', msg: 'turn physics %1 for %2', args: [DD('ON', [['on', 'true'], ['off', 'false']]), T], code: '{T}.dynamic = [ON]', bool: 'ON' },
  { type: 'ss_set_gravity', cat: 'physics', kind: 'stmt', msg: 'turn gravity %1 for %2', args: [DD('ON', [['on', 'true'], ['off', 'false']]), T], code: '{T}.gravity = [ON]', bool: 'ON' },
  { type: 'ss_set_solid', cat: 'physics', kind: 'stmt', msg: 'make %2 %1', args: [DD('ON', [['solid', 'true'], ['a ghost (pass-through)', 'false']]), T], code: '{T}.solid = [ON]', bool: 'ON' },
  { type: 'ss_push', cat: 'physics', kind: 'stmt', msg: 'push %1 with force x %2 y %3 z %4', args: [T, N('X'), N('Y'), N('Z')], code: '{T}.push({X}, {Y}, {Z})' },
  { type: 'ss_set_velocity', cat: 'physics', kind: 'stmt', msg: 'set speed of %1 to x %2 y %3 z %4', args: [T, N('X'), N('Y'), N('Z')], code: '{T}.setVelocity({X}, {Y}, {Z})' },
  { type: 'ss_set_prop', cat: 'physics', kind: 'stmt', msg: 'set %1 of %2 to %3', args: [DD('P', [['mass', 'mass'], ['friction', 'friction'], ['bounciness', 'bounciness']]), T, N('V')], code: '{T}.[P] = {V}' },
  { type: 'ss_set_layer', cat: 'physics', kind: 'stmt', msg: 'put %1 on collision layer %2', args: [T, N('L')], code: '{T}.setCollision({L})' },
  { type: 'ss_world_gravity', cat: 'physics', kind: 'stmt', msg: 'set world gravity to %1', args: [N('G')], code: 'world.gravity = {G}' },
  { type: 'ss_touching', cat: 'physics', kind: 'value', out: 'Boolean', msg: '%1 is touching %2 ?', args: [T, V('O')], code: '{T}.isTouching({O})' },

  // ---- sound
  { type: 'ss_play_sound', cat: 'sound', kind: 'stmt', msg: 'play sound %1', args: [DD('S', SOUND_NAMES.map((s) => [s, s]))], code: 'world.playSound("[S]")' },
  { type: 'ss_play_named', cat: 'sound', kind: 'stmt', msg: 'play my imported sound named %1', args: [{ type: 'field_input', name: 'S', text: 'Sound' }], code: 'world.playSound("[S]")' },
  { type: 'ss_play_note', cat: 'sound', kind: 'stmt', msg: 'play note %1 Hz', args: [N('F')], code: 'world.playSound({F})' },
  { type: 'ss_stop_sounds', cat: 'sound', kind: 'stmt', msg: 'stop all sounds', code: 'world.stopSounds()' },

  // ---- control extras
  { type: 'ss_wait', cat: 'control', kind: 'stmt', msg: 'wait %1 seconds', args: [N('S')], code: 'wait({S})', await: true },
  { type: 'ss_forever', cat: 'control', kind: 'forever', msg: 'forever' },

  // ---- sensing / world
  { type: 'ss_me', cat: 'sensing', kind: 'value', msg: 'me', code: 'me' },
  { type: 'ss_object', cat: 'sensing', kind: 'value', msg: 'object %1', args: [{ type: 'field_dropdown', name: 'NAME', options: () => { const n = objectNames(); return n.length ? n.map((x) => [x, x]) : [['(none)', '']]; } }], code: 'world.find("[NAME]")' },
  { type: 'ss_other', cat: 'sensing', kind: 'value', msg: 'the thing I touched', code: 'other' },
  { type: 'ss_player', cat: 'sensing', kind: 'value', msg: 'the player', code: 'player' },
  { type: 'ss_name_of', cat: 'sensing', kind: 'value', out: 'String', msg: 'name of %1', args: [T], code: '{T}.name' },
  { type: 'ss_key_down', cat: 'sensing', kind: 'value', out: 'Boolean', msg: 'key %1 is down ?', args: [DD('KEY', KEYS.slice(0, -1))], code: 'input.keyDown("[KEY]")' },
  { type: 'ss_time', cat: 'sensing', kind: 'value', out: 'Number', msg: 'seconds since start', code: 'world.time' },
  { type: 'ss_shared_set', cat: 'world', kind: 'stmt', msg: 'set shared %1 to %2', args: [{ type: 'field_input', name: 'K', text: 'score' }, V('V')], code: 'world.setVar("[K]", {V})' },
  { type: 'ss_shared_change', cat: 'world', kind: 'stmt', msg: 'change shared %1 by %2', args: [{ type: 'field_input', name: 'K', text: 'score' }, N('V')], code: 'world.changeVar("[K]", {V})' },
  { type: 'ss_shared_get', cat: 'world', kind: 'value', msg: 'shared %1', args: [{ type: 'field_input', name: 'K', text: 'score' }], code: 'world.getVar("[K]")' },
  { type: 'ss_clone', cat: 'world', kind: 'value', msg: 'new clone of %1', args: [T], code: '{T}.clone()' },
  { type: 'ss_spawn', cat: 'world', kind: 'value', msg: 'create a %1 at x %2 y %3 z %4', args: [{ type: 'field_input', name: 'KIND', text: 'sphere' }, N('X'), N('Y'), N('Z')], code: 'world.spawn("[KIND]", {X}, {Y}, {Z})' },
  { type: 'ss_destroy', cat: 'world', kind: 'stmt', msg: 'delete %1', args: [T], code: '{T}.destroy()' },
];

let handlerCount = 0;
const safeIdent = (s) => String(s).replace(/[^\w]/g, '_').replace(/^(\d)/, '_$1') || 'value';
const escapeStr = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function fill(def, template, block, gen, noneOrder, py) {
  return template
    .replace(/\{(\w+)\}/g, (_, name) => gen.valueToCode(block, name, name === 'T' ? (py ? PYOrder.MEMBER : JSOrder.MEMBER) : noneOrder) || (name === 'T' ? 'me' : py ? 'None' : 'null'))
    .replace(/"\[(\w+)\]"/g, (_, f) => `"${escapeStr(block.getFieldValue(f))}"`)
    .replace(/\[(\w+)\]/g, (_, f) => {
      const v = block.getFieldValue(f);
      if (def.bool === f) return py ? (v === 'true' ? 'True' : 'False') : v;
      return safeIdent(v);
    });
}
const pyMethods = (code) => code.replace(/\.([a-z]+[A-Z]\w*)\(/g, (_, m) => `.${snake(m)}(`);

function pyGlobals(block) {
  const names = block.workspace.getVariableMap().getAllVariables().map((v) => PY.getVariableName(v.getId()));
  return names.length ? `${PY.INDENT}global ${names.join(', ')}\n` : '';
}

for (const def of DEFS) {
  const json = { type: def.type, message0: def.msg, args0: def.args || [], colour: COLORS[def.cat], inputsInline: true };
  if (def.kind === 'stmt') { json.previousStatement = null; json.nextStatement = null; }
  if (def.kind === 'value') json.output = def.out || null;
  if (def.kind === 'hat' || def.kind === 'forever') { json.message1 = '%1'; json.args1 = [{ type: 'input_statement', name: 'DO' }]; }
  if (def.kind === 'forever') json.previousStatement = null;
  // dropdowns with dynamic options cannot go through JSON
  const dyn = (def.args || []).find((a) => typeof a.options === 'function');
  if (dyn) {
    Blockly.Blocks[def.type] = {
      init() {
        this.appendDummyInput().appendField('object').appendField(new Blockly.FieldDropdown(dyn.options), dyn.name);
        this.setOutput(true, null);
        this.setColour(COLORS[def.cat]);
      },
    };
  } else {
    Blockly.common.defineBlocksWithJsonArray([json]);
  }

  if (def.kind === 'hat') {
    JS.forBlock[def.type] = (block, gen) => {
      const body = gen.statementToCode(block, 'DO');
      const args = def.hatArgs ? fill(def, def.hatArgs, block, gen, JSOrder.NONE, false) + ', ' : '';
      return `${def.hat[0]}(${args}async (${def.params || ''}) => {\n${body}});\n\n`;
    };
    PY.forBlock[def.type] = (block, gen) => {
      const body = gen.statementToCode(block, 'DO') || gen.PASS;
      const args = def.hatArgs ? `(${fill(def, def.hatArgs, block, gen, PYOrder.NONE, true)})` : '';
      return `@${def.hat[1]}${args}\nasync def _${def.hat[1]}_${++handlerCount}(${def.params || ''}):\n${pyGlobals(block)}${body}\n`;
    };
  } else if (def.kind === 'forever') {
    JS.forBlock[def.type] = (block, gen) => `while (true) {\n${gen.statementToCode(block, 'DO')}${gen.INDENT}await nextFrame();\n}\n`;
    PY.forBlock[def.type] = (block, gen) => `while True:\n${gen.statementToCode(block, 'DO')}${gen.INDENT}await next_frame()\n`;
  } else if (def.kind === 'stmt') {
    JS.forBlock[def.type] = (block, gen) => `${def.await ? 'await ' : ''}${fill(def, def.jsCode || def.code, block, gen, JSOrder.NONE, false)};\n`;
    PY.forBlock[def.type] = (block, gen) => `${def.await ? 'await ' : ''}${pyMethods(fill(def, def.code, block, gen, PYOrder.NONE, true))}\n`;
  } else {
    JS.forBlock[def.type] = (block, gen) => [fill(def, def.code, block, gen, JSOrder.NONE, false), JSOrder.FUNCTION_CALL];
    PY.forBlock[def.type] = (block, gen) => [pyMethods(fill(def, def.code, block, gen, PYOrder.NONE, true)), PYOrder.FUNCTION_CALL];
  }
}

// ---- make everything async-friendly: functions can contain "wait", loops cannot freeze the tab
JS.INFINITE_LOOP_TRAP = 'await __guard();\n';
PY.INFINITE_LOOP_TRAP = 'await _guard()\n';
for (const [gen, from, to] of [[JS, /^function /m, 'async function '], [PY, /^def /m, 'async def ']]) {
  for (const type of ['procedures_defreturn', 'procedures_defnoreturn']) {
    const orig = gen.forBlock[type];
    gen.forBlock[type] = (block, g) => {
      const r = orig(block, g);
      for (const k of Object.keys(g.definitions_)) {
        if (k.startsWith('%') && !/^async /m.test(g.definitions_[k])) g.definitions_[k] = g.definitions_[k].replace(from, to);
      }
      return r;
    };
  }
  const call = gen.forBlock.procedures_callreturn;
  const atomic = gen === JS ? JSOrder.ATOMIC : PYOrder.ATOMIC;
  gen.forBlock.procedures_callreturn = (block, g) => [`(await ${call(block, g)[0]})`, atomic];
  gen.forBlock.procedures_callnoreturn = (block, g) => `await ${call(block, g)[0]}${gen === JS ? ';' : ''}\n`;
}
// print -> the play console (works the same in both languages)
JS.forBlock.text_print = (block, g) => `print(${g.valueToCode(block, 'TEXT', JSOrder.NONE) || "''"});\n`;

const num = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const txt = (t) => ({ shadow: { type: 'text', fields: { TEXT: t } } });
const me = { shadow: { type: 'ss_me' } };
const DEFAULTS = { X: num(0), Y: num(0), Z: num(0), D: num(1), S: num(1), O: num(0.5), V: num(1), L: num(1), G: num(-9.81), F: num(440), MSG: txt('Hello!'), TXT: txt('Score: 0'), C: { shadow: { type: 'ss_color' } } };

function entry(type) {
  const def = DEFS.find((d) => d.type === type);
  const inputs = {};
  for (const a of def.args || []) {
    if (a.type !== 'input_value') continue;
    if (a.name === 'T') inputs.T = me;
    else if (a.name === 'O' && a.check !== 'Number') { if (def.type === 'ss_touching' || def.type === 'ss_look_at' || def.type === 'ss_distance') inputs.O = { shadow: { type: 'ss_player' } }; } else if (DEFAULTS[a.name]) inputs[a.name] = DEFAULTS[a.name];
  }
  return { kind: 'block', type, inputs };
}
const cat = (name, key, extra = []) => ({ kind: 'category', name, colour: COLORS[key], contents: [...DEFS.filter((d) => d.cat === key).map((d) => entry(d.type)), ...extra] });
const b = (type, inputs) => ({ kind: 'block', type, inputs });

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    cat('Events', 'events'),
    cat('Motion', 'motion'),
    cat('Looks', 'looks'),
    cat('Animation', 'anim'),
    cat('Physics', 'physics'),
    cat('Sound', 'sound'),
    cat('Control', 'control', [
      b('controls_if'), b('controls_if', undefined), b('controls_repeat_ext', { TIMES: num(10) }), b('controls_whileUntil'),
      b('controls_for', { FROM: num(1), TO: num(10), BY: num(1) }), b('controls_flow_statements'),
    ]),
    cat('Sensing', 'sensing'),
    cat('World', 'world'),
    { kind: 'category', name: 'Logic', colour: 210, contents: [b('logic_compare'), b('logic_operation'), b('logic_negate'), b('logic_boolean')] },
    { kind: 'category', name: 'Math', colour: 230, contents: [
      b('math_number'), b('math_arithmetic', { A: num(1), B: num(1) }), b('math_random_int', { FROM: num(1), TO: num(10) }),
      b('math_single', { NUM: num(9) }), b('math_trig', { NUM: num(45) }), b('math_round', { NUM: num(3.1) }), b('math_modulo', { DIVIDEND: num(64), DIVISOR: num(10) }),
    ] },
    { kind: 'category', name: 'Text', colour: 160, contents: [b('text'), b('text_join'), b('text_print', { TEXT: txt('hello') })] },
    { kind: 'category', name: 'Variables', colour: 330, custom: 'VARIABLE' },
    { kind: 'category', name: 'Functions', colour: 290, custom: 'PROCEDURE' },
  ],
};
TOOLBOX.contents[6].contents[1] = { kind: 'block', type: 'controls_if', extraState: { hasElse: true } };

const HATS = new Set(DEFS.filter((d) => d.kind === 'hat').map((d) => d.type).concat(['procedures_defreturn', 'procedures_defnoreturn']));

/** Code for the event blocks (and functions) in a workspace; loose blocks are ignored, like in Scratch. */
export function workspaceToCode(workspace, lang) {
  const gen = lang === 'py' ? PY : JS;
  gen.init(workspace);
  let code = '';
  for (const block of workspace.getTopBlocks(true)) {
    if (!HATS.has(block.type) || !block.isEnabled()) continue;
    const out = gen.blockToCode(block);
    code += Array.isArray(out) ? out[0] : out;
  }
  return gen.finish(code).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Compile saved block JSON without any UI (used when a world is played). */
export function blocksToCode(json, lang = 'js') {
  if (!json) return '';
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(JSON.parse(json), ws);
    return workspaceToCode(ws, lang);
  } finally {
    ws.dispose();
  }
}

export { Blockly };
