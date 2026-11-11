// Import the user's own files. 3D models (.glb/.gltf/.obj/.stl) are loaded in the browser,
// resized to a sensible scale, and re-saved as a single .glb so everyone in the world sees the same thing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { api } from '../api.js';

const IMAGE = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const AUDIO = ['mp3', 'wav', 'ogg', 'm4a'];
const MODEL = ['glb', 'gltf', 'obj', 'stl'];
export const ACCEPT = [...MODEL, 'mtl', 'bin', ...IMAGE, ...AUDIO].map((e) => '.' + e).join(',');
const ext = (name) => name.split('.').pop().toLowerCase();
const stem = (name) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Import';

/** Scale to about 2 m and stand the model on the ground, centred. */
function normalize(object) {
  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new Error('That file has no 3D shapes in it.');
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const s = 2 / Math.max(size.x, size.y, size.z, 1e-6);
  object.scale.multiplyScalar(s);
  object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)).multiplyScalar(s);
  return wrapper;
}

async function toGlb(object, animations = []) {
  const buffer = await new GLTFExporter().parseAsync(normalize(object), { binary: true, animations });
  return new Blob([buffer], { type: 'model/gltf-binary' });
}

/** Load a model where sibling files (textures, .bin, .mtl) may be in the same selection. */
async function loadLocalModel(file, siblings) {
  const urls = new Map(siblings.map((f) => [f.name.toLowerCase(), URL.createObjectURL(f)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(blob|data):/.test(url)) return url;
    const name = decodeURIComponent(url.split(/[\\/]/).pop().split('?')[0]).toLowerCase();
    return urls.get(name) || url;
  });
  try {
    const kind = ext(file.name);
    if (kind === 'glb' || kind === 'gltf') {
      const gltf = await new GLTFLoader(manager).loadAsync(urls.get(file.name.toLowerCase()));
      return { object: gltf.scene, animations: gltf.animations };
    }
    if (kind === 'obj') {
      const loader = new OBJLoader(manager);
      const mtl = siblings.find((f) => ext(f.name) === 'mtl');
      if (mtl) {
        const materials = new MTLLoader(manager).parse(await mtl.text(), '');
        materials.preload();
        loader.setMaterials(materials);
      }
      const object = loader.parse(await file.text());
      object.traverse((o) => {
        if (!o.isMesh) return;
        const fix = (m) => (m.isMeshPhongMaterial || m.isMeshBasicMaterial ? new THREE.MeshStandardMaterial({ color: mtl ? m.color : '#b8c0cc', map: m.map || null, roughness: 0.7 }) : m);
        o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
      });
      // give textures a moment to arrive before exporting
      await new Promise((resolve) => { if (!mtl) return resolve(); manager.onLoad = resolve; setTimeout(resolve, 4000); });
      return { object, animations: [] };
    }
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    geometry.rotateX(-Math.PI / 2); // STL files are Z-up
    geometry.computeVertexNormals();
    return { object: new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#b8c0cc', roughness: 0.6 })), animations: [] };
  } finally {
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 10000);
  }
}

/**
 * @returns list of object descriptions ready for editor.addObject()
 */
export async function importFiles(worldId, files) {
  const out = [], errors = [];
  for (const file of files) {
    const kind = ext(file.name);
    try {
      if (IMAGE.includes(kind)) {
        const { file: saved } = await api.uploadAsset(worldId, file, kind);
        out.push({ type: 'image', kind: 'image', name: stem(file.name), scl: [2, 2, 2], props: { file: saved } });
      } else if (AUDIO.includes(kind)) {
        const { file: saved } = await api.uploadAsset(worldId, file, kind);
        out.push({ type: 'audio', kind: 'audio', name: stem(file.name), props: { file: saved, loop: false, autoplay: false, volume: 1, positional: false } });
      } else if (MODEL.includes(kind)) {
        const { object, animations } = await loadLocalModel(file, files);
        const { file: saved } = await api.uploadAsset(worldId, await toGlb(object, animations), 'glb');
        out.push({ type: 'model', kind: 'model', name: stem(file.name), props: { file: saved } });
      } else if (!['mtl', 'bin'].includes(kind)) {
        errors.push(`${file.name}: this file type is not supported.`);
      }
    } catch (e) {
      errors.push(`${file.name}: ${e.message || 'could not be imported.'}`);
    }
  }
  return { objects: out, errors };
}

/** Import a model found through search (downloaded through the server's proxy). */
export async function importFromUrl(worldId, url, name) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => (/^https?:/.test(u) ? api.proxyUrl(u) : u));
  const gltf = await new GLTFLoader(manager).loadAsync(url);
  const { file } = await api.uploadAsset(worldId, await toGlb(gltf.scene, gltf.animations), 'glb');
  return { type: 'model', kind: 'model', name: stem(name), props: { file } };
}
