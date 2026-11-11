// Left panel: things to add (shapes, built-in assets, text, lights, terrain, imports, model search)
// and the list of objects already in the world.
import * as THREE from 'three';
import { h, clear, toast, debounce } from '../ui/dom.js';
import { api } from '../api.js';
import { STATIC } from '../env.js';
import { ASSETS, ASSET_CATEGORIES, buildAsset } from '../engine/assets.js';
import { PRIMITIVES, buildObject } from '../engine/factory.js';
import { importFiles, importFromUrl, ACCEPT } from './importer.js';

const thumbs = new Map();
/** Render small preview pictures for the library once, with a throwaway renderer. */
function makeThumbs() {
  if (thumbs.size) return;
  const size = 112;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#99a', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const shoot = (key, object) => {
    scene.add(object);
    const box = new THREE.Box3().setFromObject(object);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    camera.position.copy(c).add(new THREE.Vector3(1, 0.7, 1.4).normalize().multiplyScalar(r * 4));
    camera.lookAt(c);
    renderer.render(scene, camera);
    thumbs.set(key, renderer.domElement.toDataURL('image/png'));
    scene.remove(object);
  };
  for (const kind of Object.keys(PRIMITIVES)) shoot('p:' + kind, buildObject({ type: 'primitive', kind, color: '#4f9dff' }, {}));
  for (const a of ASSETS) shoot('a:' + a.id, buildAsset(a.id));
  shoot('text', buildObject({ type: 'text', color: '#ff8a3d', props: { text: 'Abc' } }, {}));
  renderer.dispose();
  renderer.forceContextLoss();
}

const ICONS = { primitive: '◼', asset: '★', model: '⬢', text: 'T', image: '▣', audio: '♪', terrain: '⛰', light: '☀' };

export class LibraryPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
    this.tab = 'add';
    this.dragData = null;
    makeThumbs();
    this.objectsEl = h('div.object-list');
    this.addEl = this.buildAdd();
    this.tabBtns = { add: h('button', { onClick: () => this.setTab('add') }, 'Add'), objects: h('button', { onClick: () => this.setTab('objects') }, 'Objects') };
    el.append(h('div.tabs', { role: 'tablist' }, Object.values(this.tabBtns)), this.addEl, this.objectsEl);
    this.setTab('add');
    this.refreshObjects = debounce(() => this.renderObjects(), 30);
  }
  setTab(tab) {
    this.tab = tab;
    for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('active', k === tab);
    this.addEl.hidden = tab !== 'add';
    this.objectsEl.hidden = tab !== 'objects';
    if (tab === 'objects') this.renderObjects();
  }

  tile(label, thumb, data) {
    return h('button.tile', {
      draggable: true, title: `${label} - click to add, or drag into the world`,
      onDragstart: (e) => { this.dragData = data; e.dataTransfer.setData('text/plain', label); e.dataTransfer.effectAllowed = 'copy'; },
      onDragend: () => { setTimeout(() => { this.dragData = null; }, 0); },
      onClick: () => { this.editor.addObject(data); this.editor.el.classList.remove('show-left'); },
    }, typeof thumb === 'string' && thumb.startsWith('data:') ? h('img', { src: thumb, alt: '', draggable: false }) : h('span.glyph', null, thumb), h('span', null, label));
  }

  buildAdd() {
    const section = (title, ...kids) => h('section', null, h('h3', null, title), ...kids);
    const fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true, onChange: () => { this.importFiles([...fileInput.files]); fileInput.value = ''; } });
    this.searchResults = h('div.grid');
    const searchInput = h('input', { type: 'search', placeholder: 'Search 3D models…', 'aria-label': 'Search 3D models' });
    const doSearch = async (e) => {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (!q) return;
      clear(this.searchResults).append(h('p.hint', null, 'Searching…'));
      try {
        const { results, errors } = await api.searchModels(q);
        clear(this.searchResults);
        if (!results.length) this.searchResults.append(h('p.hint', null, errors.length ? 'The model libraries could not be reached right now.' : 'No models found. Try another word.'));
        for (const r of results) {
          this.searchResults.append(h('button.tile', { title: `${r.name} - ${r.author} (${r.license})`, onClick: (ev) => this.importSearchResult(r, ev.currentTarget) },
            h('img', { src: r.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }), h('span', null, r.name)));
        }
      } catch (err) { clear(this.searchResults).append(h('p.hint', null, err.message)); }
    };
    return h('div.add', null,
      section('Shapes', h('div.grid', null, Object.entries(PRIMITIVES).map(([kind, p]) => this.tile(p.name, thumbs.get('p:' + kind), { type: 'primitive', kind, name: p.name })))),
      section('Special', h('div.grid', null,
        this.tile('3D Text', thumbs.get('text'), { type: 'text', kind: 'text', name: 'Text', color: '#ff8a3d', props: { text: 'Hello', depth: 0.25 } }),
        this.tile('Terrain', '⛰', { type: 'terrain', kind: 'terrain', name: 'Terrain', props: { size: 40, heights: '' } }),
        this.tile('Light', '☀', { type: 'light', kind: 'light', name: 'Light', color: '#ffe9a8', props: { intensity: 30, distance: 20 } }))),
      ASSET_CATEGORIES.map((cat) => section(cat, h('div.grid', null, ASSETS.filter((a) => a.cat === cat).map((a) => this.tile(a.name, thumbs.get('a:' + a.id), { type: 'asset', kind: a.id, name: a.name }))))),
      section('Import your files', fileInput,
        h('button.btn.wide', { onClick: () => fileInput.click() }, 'Choose files…'),
        h('p.hint', null, '3D models (.glb, .gltf, .obj, .stl), pictures and sounds. You can also drop files onto the world.')),
      !STATIC && section('Find 3D models', h('form.row', { onSubmit: doSearch }, searchInput, h('button.btn', { type: 'submit' }, 'Search')), this.searchResults,
        h('p.hint', null, 'Free models from Poly Haven and Poly Pizza. Check each model\'s licence before publishing.')));
  }

  async importFiles(files, point) {
    if (!files.length) return;
    toast(`Importing ${files.length === 1 ? files[0].name : files.length + ' files'}…`);
    const { objects, errors } = await importFiles(this.editor.meta.id, files);
    objects.forEach((o, i) => this.editor.addObject(o, point ? point.clone().add({ x: i * 1.5, y: 0, z: 0 }) : undefined));
    if (errors.length) toast(errors.join('\n'), 'error');
    else if (objects.length) toast('Imported');
  }
  async importSearchResult(r, tile) {
    tile.classList.add('busy');
    try {
      const url = r.url || (await api.polyHavenUrl(r.id)).url;
      this.editor.addObject(await importFromUrl(this.editor.meta.id, url, r.name));
      toast(`Added ${r.name}`);
    } catch (e) { toast(`Could not add that model. ${e.message || ''}`, 'error'); }
    tile.classList.remove('busy');
  }

  renderObjects() {
    if (this.tab !== 'objects') return;
    const ed = this.editor;
    const others = new Map(ed.world.people().filter((p) => !p.isMe && p.selected).map((p) => [p.selected, p]));
    const rows = [...ed.sync.entries.entries()].sort((a, b) => a[1].data.name.localeCompare(b[1].data.name, undefined, { numeric: true })).map(([id, { data }]) => {
      const who = others.get(id);
      return h('div.object-row' + (id === ed.selected ? '.selected' : ''), { onClick: () => ed.select(id), onDblclick: () => ed.focusSelected(), style: who ? { boxShadow: `inset 3px 0 0 ${who.color}` } : null },
        h('span.glyph', null, ICONS[data.type] || '◼'),
        h('span.name', { title: who ? `${who.name} is editing this` : data.name }, data.name),
        h('button.icon-btn.small', { title: data.locked ? 'Unlock' : 'Lock (cannot be clicked in the world)', 'aria-label': data.locked ? 'Unlock' : 'Lock', onClick: (e) => { e.stopPropagation(); ed.world.set(id, { locked: !data.locked }); } }, data.locked ? '🔒' : '🔓'),
        h('button.icon-btn.small', { title: data.visible === false ? 'Show' : 'Hide', 'aria-label': data.visible === false ? 'Show' : 'Hide', onClick: (e) => { e.stopPropagation(); ed.world.set(id, { visible: data.visible === false }); } }, data.visible === false ? '◌' : '◉'));
    });
    clear(this.objectsEl).append(...(rows.length ? rows : [h('p.hint', null, 'Nothing here yet. Add something from the Add tab.')]));
  }
}
