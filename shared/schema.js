// Data model shared by the server (world seeding) and the client (editor/runtime).
// A world is one Yjs document:
//   objects  : Y.Map<id, Y.Map>   one entry per scene object (fields below)
//   settings : Y.Map              world-level settings
// Per-object code lives in Y.Text fields (`js`, `py`) so several people can type at once.

export const DEFAULT_PHYSICS = {
  dynamic: false, // moved by the physics engine (forces, gravity)
  solid: true, // has a collider at all
  gravity: true, // affected by world gravity (dynamic bodies only)
  mass: 1,
  friction: 0.5,
  bounciness: 0.2,
  shape: 'auto', // auto | box | sphere | hull | mesh
  layer: 1, // collision layer 1..8
  mask: [1, 2, 3, 4, 5, 6, 7, 8], // layers this object collides with
};

export const DEFAULT_SETTINGS = {
  gravity: -9.81,
  skyColor: '#9fd3ff',
  sunIntensity: 2.2,
  ambientIntensity: 0.9,
  playerMode: 'orbit', // orbit | walk | fly
  playerSpeed: 5,
  arScale: 0.1,
};

export const OBJECT_DEFAULTS = {
  type: 'primitive', // primitive | asset | model | text | image | audio | terrain | light
  kind: 'box',
  name: 'Object',
  pos: [0, 0, 0],
  rot: [0, 0, 0],
  scl: [1, 1, 1],
  color: '#4f9dff',
  opacity: 1,
  visible: true,
  locked: false,
  props: {},
  physics: DEFAULT_PHYSICS,
  mode: 'blocks', // blocks | js | py
  blocks: '',
};

export function newId() {
  const a = new Uint8Array(9);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

/** Fill a Y.Map for a new object. `Y` is passed in so server and client share one copy of yjs each. */
export function writeObject(Y, ymap, data) {
  const full = { ...OBJECT_DEFAULTS, ...data };
  for (const [k, v] of Object.entries(full)) {
    if (k === 'js' || k === 'py') continue;
    ymap.set(k, v);
  }
  const js = new Y.Text();
  const py = new Y.Text();
  if (data.js) js.insert(0, data.js);
  if (data.py) py.insert(0, data.py);
  ymap.set('js', js);
  ymap.set('py', py);
}

/** Seed a brand-new world: a ground slab, a sun-lit sky, and one cube to play with. */
export function seedWorld(Y, doc) {
  doc.transact(() => {
    const objects = doc.getMap('objects');
    const settings = doc.getMap('settings');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) settings.set(k, v);
    const ground = new Y.Map();
    objects.set(newId(), ground);
    writeObject(Y, ground, {
      kind: 'box', name: 'Ground', pos: [0, -0.25, 0], scl: [40, 0.5, 40], color: '#6cc070', locked: true,
      physics: { ...DEFAULT_PHYSICS, friction: 0.8 },
    });
    const cube = new Y.Map();
    objects.set(newId(), cube);
    writeObject(Y, cube, { kind: 'box', name: 'Cube', pos: [0, 0.5, 0], color: '#ff8a3d' });
  }, 'seed');
}
