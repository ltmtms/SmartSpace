// Sculptable terrain: a square height grid, stored compactly (16-bit centimetres, base64).
import * as THREE from 'three';

export const TERRAIN_RES = 64; // cells per side -> (RES+1)^2 height samples
const N = TERRAIN_RES + 1;

export function decodeHeights(str) {
  const out = new Float32Array(N * N);
  if (!str) return out;
  try {
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ints = new Int16Array(bytes.buffer);
    for (let i = 0; i < Math.min(ints.length, out.length); i++) out[i] = ints[i] / 100;
  } catch { /* corrupt data -> flat */ }
  return out;
}

export function encodeHeights(heights) {
  const ints = new Int16Array(heights.length);
  for (let i = 0; i < heights.length; i++) ints[i] = Math.max(-32000, Math.min(32000, Math.round(heights[i] * 100)));
  const bytes = new Uint8Array(ints.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

const STOPS = [
  [-2, new THREE.Color('#d9c98f')], [0.15, new THREE.Color('#6cc070')], [3, new THREE.Color('#4f9d58')],
  [6, new THREE.Color('#8b8f86')], [9, new THREE.Color('#f4f6f8')],
];
const tmp = new THREE.Color();
function colorFor(h) {
  if (h <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (h <= STOPS[i][0]) {
      const t = (h - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]);
      return tmp.copy(STOPS[i - 1][1]).lerp(STOPS[i][1], t);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function createTerrain(props) {
  const size = props.size || 40;
  const geometry = new THREE.PlaneGeometry(size, size, TERRAIN_RES, TERRAIN_RES);
  geometry.rotateX(-Math.PI / 2);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  mesh.userData.heights = decodeHeights(props.heights);
  mesh.userData.size = size;
  refreshTerrain(mesh);
  return mesh;
}

export function refreshTerrain(mesh) {
  const { heights } = mesh.userData;
  const pos = mesh.geometry.attributes.position;
  const col = mesh.geometry.attributes.color;
  for (let i = 0; i < heights.length; i++) {
    pos.setY(i, heights[i]);
    const c = colorFor(heights[i]);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  pos.needsUpdate = col.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
  mesh.geometry.computeBoundingBox();
}

/** Apply one brush dab. `local` is the brush centre in the terrain's local space. */
export function sculpt(mesh, local, { mode, radius, strength }, dt) {
  const { heights, size } = mesh.userData;
  const cell = size / TERRAIN_RES;
  const cx = (local.x + size / 2) / cell, cz = (local.z + size / 2) / cell;
  const r = radius / cell;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(TERRAIN_RES, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(TERRAIN_RES, Math.ceil(cz + r));
  let avg = 0, n = 0;
  if (mode === 'smooth' || mode === 'flatten') {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { avg += heights[z * N + x]; n++; }
    avg = n ? avg / n : 0;
    if (mode === 'flatten') {
      const ix = Math.round(Math.max(0, Math.min(TERRAIN_RES, cx))), iz = Math.round(Math.max(0, Math.min(TERRAIN_RES, cz)));
      avg = mesh.userData.flattenTarget ?? (mesh.userData.flattenTarget = heights[iz * N + ix]);
    }
  }
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d > 1) continue;
      const w = 0.5 * (1 + Math.cos(Math.PI * d)) * strength * dt; // smooth falloff
      const i = z * N + x;
      if (mode === 'raise') heights[i] += w * 6;
      else if (mode === 'lower') heights[i] -= w * 6;
      else heights[i] += (avg - heights[i]) * Math.min(1, w * 4);
      heights[i] = Math.max(-20, Math.min(60, heights[i]));
    }
  }
  refreshTerrain(mesh);
}

/** Vertices + triangle indices in local space, for the physics trimesh. */
export function terrainTrimesh(mesh) {
  return { vertices: new Float32Array(mesh.geometry.attributes.position.array), indices: new Uint32Array(mesh.geometry.index.array) };
}
