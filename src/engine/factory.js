// Turns an object's data (from the shared document) into a three.js object.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import fontJson from '../assets/droid_sans_bold.typeface.json';
import { buildAsset } from './assets.js';
import { createTerrain } from './terrain.js';

const font = new FontLoader().parse(fontJson);

function rampGeometry() {
  const shape = new THREE.Shape([new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(-0.5, 0.5)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
}

export const PRIMITIVES = {
  box: { name: 'Cube', geo: () => new THREE.BoxGeometry(1, 1, 1) },
  sphere: { name: 'Sphere', geo: () => new THREE.SphereGeometry(0.5, 32, 20) },
  cylinder: { name: 'Cylinder', geo: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32) },
  cone: { name: 'Cone', geo: () => new THREE.ConeGeometry(0.5, 1, 32) },
  pyramid: { name: 'Pyramid', geo: () => new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4) },
  capsule: { name: 'Capsule', geo: () => new THREE.CapsuleGeometry(0.3, 0.4, 6, 20) },
  torus: { name: 'Ring', geo: () => new THREE.TorusGeometry(0.4, 0.12, 14, 36).rotateX(Math.PI / 2) },
  ramp: { name: 'Ramp', geo: () => rampGeometry() },
  plane: { name: 'Flat Panel', geo: () => new THREE.BoxGeometry(1, 0.02, 1) },
};
const geoCache = new Map();
function primitiveGeometry(kind) {
  if (!geoCache.has(kind)) geoCache.set(kind, (PRIMITIVES[kind] || PRIMITIVES.box).geo());
  return geoCache.get(kind);
}

const gltfLoader = new GLTFLoader();
const gltfCache = new Map();
export function loadModel(url) {
  if (!gltfCache.has(url)) {
    const p = gltfLoader.loadAsync(url);
    p.catch(() => gltfCache.delete(url));
    gltfCache.set(url, p);
  }
  return gltfCache.get(url);
}
const texLoader = new THREE.TextureLoader();

function editorIcon(color, shape) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  if (shape === 'speaker') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.26), mat));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.34, 20, 1, true), mat);
    cone.rotation.z = Math.PI / 2;
    cone.position.x = 0.2;
    mat.side = THREE.DoubleSide;
    g.add(cone);
  } else {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat));
  }
  g.userData.editorOnly = true;
  return g;
}

/** Everything that, when changed, requires the object's meshes to be rebuilt. */
export function buildKey(d) {
  return JSON.stringify([d.type, d.kind, d.color, d.props]);
}

/**
 * @param data plain object (see shared/schema.js)
 * @param ctx  { assetUrl(file) }
 * @returns THREE.Group whose userData.ready resolves once async content (models, images) has loaded
 */
export function buildObject(data, ctx) {
  const root = new THREE.Group();
  const props = data.props || {};
  let ready = Promise.resolve();
  const std = () => new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.6, metalness: 0.05 });
  const addMesh = (geometry, material = std()) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    return m;
  };

  switch (data.type) {
    case 'asset':
      root.add(buildAsset(data.kind));
      break;
    case 'text': {
      const g = new TextGeometry(String(props.text ?? 'Text') || ' ', { font, size: 1, depth: props.depth ?? 0.25, curveSegments: 5 });
      g.center();
      addMesh(g).userData.ownGeometry = true;
      break;
    }
    case 'terrain':
      root.add(createTerrain(props));
      break;
    case 'model': {
      const holder = new THREE.Group();
      root.add(holder);
      ready = loadModel(ctx.assetUrl(props.file)).then((gltf) => {
        const scene = SkeletonUtils.clone(gltf.scene);
        scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.material = o.material.clone(); } });
        holder.add(scene);
        root.userData.animations = gltf.animations || [];
      }).catch(() => {
        holder.add(new THREE.Mesh(primitiveGeometry('box'), new THREE.MeshStandardMaterial({ color: '#ff4d6d', wireframe: true })));
      });
      break;
    }
    case 'image': {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true });
      const mesh = addMesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.userData.ownGeometry = true;
      mesh.castShadow = false;
      ready = texLoader.loadAsync(ctx.assetUrl(props.file)).then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
        mesh.scale.set(tex.image.width / tex.image.height, 1, 1);
      }).catch(() => { mat.color.set('#ff4d6d'); });
      break;
    }
    case 'audio':
      root.add(editorIcon('#a855f7', 'speaker'));
      break;
    case 'light': {
      const light = new THREE.PointLight(data.color, props.intensity ?? 30, props.distance ?? 20);
      root.add(light, editorIcon(data.color, 'bulb'));
      break;
    }
    default:
      addMesh(primitiveGeometry(data.kind));
  }
  root.userData.ready = ready.then(() => applyLook(root, data));
  applyLook(root, data);
  return root;
}

export function applyLook(root, data) {
  const opacity = data.opacity ?? 1;
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.parent?.userData.editorOnly) return;
    if (o.material.map && data.type === 'image') return void (o.material.opacity = opacity);
    o.material.transparent = opacity < 1;
    o.material.opacity = opacity;
    o.material.depthWrite = opacity >= 1;
  });
}

export function applyTransform(root, data) {
  root.position.fromArray(data.pos || [0, 0, 0]);
  root.rotation.set(...(data.rot || [0, 0, 0]));
  root.scale.fromArray(data.scl || [1, 1, 1]);
  root.visible = data.visible !== false;
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.ownGeometry || o.geometry?.userData?.own) o.geometry.dispose();
    for (const m of [].concat(o.material)) { m.map?.dispose?.(); m.dispose(); }
  });
}

/** Bounding box of an object's content in its own (unscaled) local space. */
const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _v = new THREE.Vector3();
export function localBounds(root) {
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || o.parent?.userData.editorOnly) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _m.multiplyMatrices(_inv, o.matrixWorld);
    const b = o.geometry.boundingBox;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(_m);
      box.expandByPoint(_v);
    }
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.25, -0.25, -0.25), new THREE.Vector3(0.25, 0.25, 0.25));
  return box;
}

/** All vertices (and triangle indices) of an object in root-local space with the root's scale baked in. */
export function localGeometry(root, maxPoints = Infinity) {
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  const verts = [], indices = [];
  let total = 0;
  root.traverse((o) => { if (o.isMesh && !o.parent?.userData.editorOnly) total += o.geometry.attributes.position.count; });
  const stride = Math.max(1, Math.ceil(total / maxPoints));
  root.traverse((o) => {
    if (!o.isMesh || o.parent?.userData.editorOnly) return;
    _m.multiplyMatrices(_inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const base = verts.length / 3;
    for (let i = 0; i < pos.count; i += stride) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m).multiply(root.scale);
      verts.push(_v.x, _v.y, _v.z);
    }
    if (stride === 1) {
      const idx = o.geometry.index;
      if (idx) for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
      else for (let i = 0; i < pos.count; i++) indices.push(base + i);
    }
  });
  return { vertices: new Float32Array(verts), indices: new Uint32Array(indices) };
}
