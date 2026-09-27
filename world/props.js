// dot.home - the visible world. Everything here is a *view* of the simulation state:
// trees shrink because the engine says wood was taken, buildings rise because labor was logged.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLUEPRINTS } from '../sim/catalog.js';
import { TREE_WOOD, BUSH_MAX } from '../sim/engine.js';

export const ISLAND_R = 9;
// where things happen (x, z); +z faces the default camera
export const ZONES = {
  center: [0, 0.5], stores: [1.7, 1.2], forest: [5.1, -3.5], quarry: [-6.3, -0.4], berries: [4.6, 3.4],
  spring: [-3.7, -5.0], farm: [-1.7, 5.2], ore: [-6.5, -3.8], edge: [0, 0],
};
export const PLOTS = {
  campfire: [0, 0.5], shared_house: [1.9, -2.5], food_storage: [-1.1, -2.9], farm: [-1.7, 5.2], well: [-1.5, -0.6],
  workshop: [-3.9, -2.3], meeting_circle: [-2.7, 2.0], market: [2.1, 3.3], clinic: [3.9, 0.6], school: [-5.0, 2.7],
  courthouse: [0.5, -5.3], watch_post: [6.7, 1.5], hospital: [1.7, 6.5], road: [0, 0],
};
export const HOME_PLOTS = [[-5.4, 5.2], [6.2, -0.6], [-1.9, -6.4], [5.3, 5.7]];
export const SIZE = {
  campfire: 1.0, shared_house: 2.4, food_storage: 1.8, farm: 3.3, well: 1.1, workshop: 2.1, meeting_circle: 2.5, house: 1.8,
  market: 1.7, clinic: 2.1, school: 2.3, courthouse: 2.4, watch_post: 1.3, hospital: 2.9, road: 0,
};

// ---------------------------------------------------------------- small helpers
const mats = new Map();
const M = (color, o = {}) => {
  const k = color + JSON.stringify(o);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o }));
  return mats.get(k);
};
const rbox = (w, h, d, r = 0.05, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
function put(parent, geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export function rockGeo(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const m = mergeVertices(g);
  const p = m.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.3) * Math.sin(v.z * 2.3 + seed * 0.7);
    v.multiplyScalar(1 + 0.16 * n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  m.computeVertexNormals();
  return m;
}
function gable(w, d, h, mat) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
  g.translate(0, 0, -d / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// lit windows at night share one material, so the whole town lights up together
export const windowMat = new THREE.MeshStandardMaterial({ color: '#cfe9ff', roughness: 0.2, emissive: '#ffcf7a', emissiveIntensity: 0 });

// ---------------------------------------------------------------- building kits
function cottage(g, { w, d, h, wall, roof, door = '#8a5a3a', chimney = true }) {
  put(g, rbox(w + 0.14, 0.16, d + 0.14, 0.05), M('#cfc6b8'), 0, 0.08, 0);
  put(g, rbox(w, h, d, 0.07), M(wall), 0, 0.16 + h / 2, 0);
  const r = gable(w + 0.36, d + 0.26, h * 0.62, M(roof, { roughness: 0.65 }));
  r.position.y = 0.16 + h; g.add(r);
  put(g, rbox(0.34, 0.54, 0.06, 0.03), M(door), 0, 0.16 + 0.27, d / 2 + 0.02);
  for (const x of [-w * 0.3, w * 0.3]) {
    put(g, rbox(0.3, 0.27, 0.05, 0.03), windowMat, x, 0.16 + h * 0.58, d / 2 + 0.02, false);
    put(g, rbox(0.36, 0.05, 0.08, 0.02), M('#ffffff'), x, 0.16 + h * 0.58 - 0.16, d / 2 + 0.04);
  }
  if (chimney) put(g, rbox(0.2, 0.42, 0.2, 0.03), M('#b9a38c'), w * 0.25, 0.16 + h + h * 0.38, -d * 0.15);
}

const BUILDERS = {
  campfire(g, ctx) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const r = put(g, rockGeo(i * 3.3, 1), M('#a39d94'), Math.cos(a) * 0.34, 0.06, Math.sin(a) * 0.34);
      r.scale.set(0.1, 0.07, 0.09);
    }
    for (const a of [0.5, -0.5]) { const l = put(g, new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), M('#8b5a35'), 0, 0.08, 0); l.rotation.set(Math.PI / 2, a, 0.25); }
    const flame = new THREE.Group(); flame.position.y = 0.12; g.add(flame);
    put(flame, new THREE.ConeGeometry(0.16, 0.42, 10).translate(0, 0.21, 0), new THREE.MeshBasicMaterial({ color: '#ff9b3d' }), 0, 0, 0, false);
    put(flame, new THREE.ConeGeometry(0.09, 0.28, 10).translate(0, 0.14, 0), new THREE.MeshBasicMaterial({ color: '#ffe27a' }), 0, 0, 0.02, false);
    const light = new THREE.PointLight('#ffb35c', 0, 7, 2);
    light.position.y = 0.5; g.add(light);
    ctx.flame = flame; ctx.light = light;
  },
  shared_house(g) { cottage(g, { w: 2.1, d: 1.6, h: 1.1, wall: '#fbefd9', roof: '#e8735a' }); },
  house(g, ctx) { cottage(g, { w: 1.5, d: 1.2, h: 0.95, wall: '#fff6ea', roof: ctx.color || '#e8735a' }); },
  food_storage(g) {
    put(g, rbox(1.6, 0.14, 1.3, 0.04), M('#cfc6b8'), 0, 0.07, 0);
    put(g, rbox(1.5, 0.95, 1.2, 0.06), M('#d27d4f'), 0, 0.14 + 0.475, 0);
    for (const s of [1, -1]) { const b = put(g, rbox(0.06, 0.9, 0.04, 0.02), M('#ffffff'), 0, 0.6, 0.61); b.rotation.z = s * 0.6; }
    const r = gable(1.8, 1.4, 0.6, M('#9b3d33', { roughness: 0.6 })); r.position.y = 1.09; g.add(r);
    for (let i = 0; i < 3; i++) {
      put(g, new THREE.CylinderGeometry(0.15, 0.12, 0.2, 14), M('#c79a5b'), -0.5 + i * 0.5, 0.1, 0.9);
      put(g, new THREE.SphereGeometry(0.12, 12, 8), M(['#ff6b5a', '#ffb347', '#9fd36b'][i]), -0.5 + i * 0.5, 0.22, 0.9);
    }
  },
  farm(g, ctx) {
    const rows = 5, cols = 7;
    for (let r = 0; r < rows; r++) put(g, rbox(2.8, 0.08, 0.34, 0.04), M('#8a5a3c', { roughness: 0.95 }), 0, 0.04, -0.9 + r * 0.45, false);
    const crops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.7 }), rows * cols);
    const mtx = new THREE.Matrix4();
    for (let r = 0, i = 0; r < rows; r++) for (let c = 0; c < cols; c++, i++) {
      mtx.makeTranslation(-1.2 + c * 0.4, 0.14, -0.9 + r * 0.45);
      crops.setMatrixAt(i, mtx);
      crops.setColorAt(i, new THREE.Color('#79c95c'));
    }
    crops.castShadow = true;
    g.add(crops);
    ctx.crops = crops;
    for (let i = 0; i < 12; i++) {
      const a = i / 12;
      const x = a < 0.5 ? -1.55 + (a * 2) * 3.1 : 1.55 - ((a - 0.5) * 2) * 3.1;
      for (const z of [-1.3, 1.3]) put(g, rbox(0.06, 0.32, 0.06, 0.02), M('#b5804f'), x, 0.16, z);
    }
    for (const z of [-1.3, 1.3]) put(g, rbox(3.2, 0.05, 0.04, 0.02), M('#c99464'), 0, 0.24, z);
  },
  well(g) {
    const pts = [[0.42, 0], [0.45, 0.05], [0.45, 0.42], [0.4, 0.46], [0.33, 0.46], [0.33, 0.1]].map(([x, y]) => new THREE.Vector2(x, y));
    put(g, new THREE.LatheGeometry(pts, 24), M('#b8b0a5'), 0, 0, 0);
    put(g, new THREE.CircleGeometry(0.33, 20).rotateX(-Math.PI / 2), M('#5aa9d6', { roughness: 0.1 }), 0, 0.3, 0, false);
    for (const x of [-0.4, 0.4]) put(g, rbox(0.07, 0.95, 0.07, 0.02), M('#9a6a43'), x, 0.47, 0);
    const r = gable(1.1, 0.8, 0.32, M('#e8735a')); r.position.y = 0.95; g.add(r);
    put(g, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8).rotateZ(Math.PI / 2), M('#8b5a35'), 0, 0.82, 0);
    put(g, new THREE.CylinderGeometry(0.08, 0.07, 0.12, 12), M('#8b5a35'), 0.1, 0.6, 0);
  },
  workshop(g) {
    put(g, rbox(1.8, 0.62, 1.4, 0.06), M('#b8b2a8'), 0, 0.31, 0);
    put(g, rbox(1.8, 0.5, 1.4, 0.06), M('#c98d5b'), 0, 0.87, 0);
    put(g, rbox(0.6, 0.6, 0.05, 0.03), M('#6b4a32'), -0.3, 0.32, 0.71);
    put(g, rbox(0.32, 0.26, 0.05, 0.03), windowMat, 0.45, 0.85, 0.71, false);
    const r = gable(2.1, 1.6, 0.55, M('#6b5a52')); r.position.y = 1.12; g.add(r);
    put(g, rbox(0.26, 0.7, 0.26, 0.04), M('#a59f97'), -0.55, 1.45, -0.2);
    put(g, rbox(0.3, 0.22, 0.2, 0.03), M('#55575f', { metalness: 0.6, roughness: 0.4 }), 0.6, 0.2, 1.0);
    put(g, rbox(0.16, 0.12, 0.16, 0.02), M('#8b5a35'), 0.6, 0.06, 1.0);
  },
  meeting_circle(g) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const s = put(g, rbox(0.24, 0.55, 0.18, 0.06), M('#bdb6ab'), Math.cos(a) * 1.05, 0.27, Math.sin(a) * 1.05);
      s.rotation.y = -a; s.rotation.z = (hash(i) - 0.5) * 0.15;
    }
    put(g, new THREE.CylinderGeometry(0.38, 0.42, 0.22, 20), M('#cfc8bd'), 0, 0.11, 0);
  },
  market(g, ctx) {
    put(g, rbox(1.4, 0.5, 0.55, 0.05), M('#c98d5b'), 0, 0.25, 0.25);
    for (const [x, z] of [[-0.65, 0.5], [0.65, 0.5], [-0.65, -0.3], [0.65, -0.3]]) put(g, rbox(0.06, 1.25, 0.06, 0.02), M('#9a6a43'), x, 0.62, z);
    const stripes = canvasTex(256, 64, (c, W, H) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : (ctx.color || '#ff47b0'); c.fillRect(i * W / 8, 0, W / 8, H); } });
    const aw = put(g, new THREE.BoxGeometry(1.55, 0.04, 1.0), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }), 0, 1.28, 0.12);
    aw.rotation.x = 0.22;
    for (let i = 0; i < 5; i++) put(g, new THREE.SphereGeometry(0.08, 10, 8), M(['#ff6b5a', '#ffb347', '#9fd36b', '#7fb2ff', '#ff6b5a'][i]), -0.5 + i * 0.25, 0.56, 0.3);
    const sign = canvasTex(256, 64, (c, W, H) => {
      c.fillStyle = '#fff6e8'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#5a3a22'; c.font = '900 34px Nunito, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(`${(ctx.owner || 'the').toUpperCase()}'S`, W / 2, H / 2 + 2);
    });
    put(g, new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: sign }), 0, 1.45, 0.62, false);
  },
  clinic(g) {
    cottage(g, { w: 1.8, d: 1.5, h: 1.05, wall: '#ffffff', roof: '#7fd6c2', chimney: false });
    put(g, rbox(0.34, 0.1, 0.05, 0.02), M('#ff5a6e'), 0, 1.0, 0.79);
    put(g, rbox(0.1, 0.34, 0.05, 0.02), M('#ff5a6e'), 0, 1.0, 0.79);
  },
  school(g) {
    cottage(g, { w: 2.0, d: 1.5, h: 1.1, wall: '#fff1c9', roof: '#5b8def', chimney: false });
    put(g, rbox(0.5, 0.55, 0.5, 0.04), M('#fff1c9'), 0, 1.75, -0.1);
    const c = put(g, new THREE.ConeGeometry(0.45, 0.45, 4), M('#5b8def'), 0, 2.25, -0.1); c.rotation.y = Math.PI / 4;
    put(g, new THREE.SphereGeometry(0.1, 12, 8), M('#f2c14e', { metalness: 0.6, roughness: 0.3 }), 0, 1.72, 0.17);
  },
  courthouse(g) {
    put(g, rbox(2.2, 0.14, 1.7, 0.04), M('#d9d3c9'), 0, 0.07, 0.1);
    put(g, rbox(2.0, 0.14, 1.5, 0.04), M('#e5e0d7'), 0, 0.21, 0.05);
    put(g, rbox(1.8, 1.1, 1.0, 0.05), M('#ece7de'), 0, 0.83, -0.2);
    for (const x of [-0.75, -0.25, 0.25, 0.75]) put(g, new THREE.CylinderGeometry(0.09, 0.1, 1.1, 14), M('#ffffff'), x, 0.83, 0.55);
    put(g, rbox(2.0, 0.14, 1.6, 0.04), M('#e5e0d7'), 0, 1.45, 0.05);
    const r = gable(2.0, 1.6, 0.42, M('#ece7de')); r.position.y = 1.52; g.add(r);
    put(g, new THREE.CircleGeometry(0.14, 20), M('#c9a24a', { metalness: 0.5, roughness: 0.35 }), 0, 1.7, 0.87, false);
  },
  watch_post(g) {
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) put(g, rbox(0.08, 1.45, 0.08, 0.02), M('#9a6a43'), x, 0.72, z);
    put(g, rbox(1.05, 0.1, 1.05, 0.03), M('#c98d5b'), 0, 1.45, 0);
    for (const [x, z, w, d] of [[0, 0.5, 1.0, 0.05], [0, -0.5, 1.0, 0.05], [0.5, 0, 0.05, 1.0], [-0.5, 0, 0.05, 1.0]]) put(g, rbox(w, 0.06, d, 0.02), M('#b5804f'), x, 1.75, z);
    const c = put(g, new THREE.ConeGeometry(0.8, 0.45, 4), M('#4f6bff'), 0, 2.2, 0); c.rotation.y = Math.PI / 4;
    put(g, new THREE.PlaneGeometry(0.4, 0.24), M('#ffd23f', { side: THREE.DoubleSide }), 0.2, 2.65, 0, false);
    put(g, rbox(0.03, 0.5, 0.03, 0.01), M('#8b5a35'), 0, 2.55, 0);
  },
  hospital(g) {
    put(g, rbox(2.7, 0.14, 1.9, 0.04), M('#cfc6b8'), 0, 0.07, 0);
    put(g, rbox(2.5, 1.0, 1.7, 0.07), M('#ffffff'), 0, 0.64, 0);
    put(g, rbox(1.6, 0.8, 1.3, 0.07), M('#f5f7fb'), 0, 1.54, -0.1);
    put(g, rbox(2.7, 0.12, 1.9, 0.04), M('#6fa8ff'), 0, 1.16, 0);
    put(g, rbox(1.8, 0.12, 1.5, 0.04), M('#6fa8ff'), 0, 1.98, -0.1);
    for (const x of [-0.9, -0.45, 0.45, 0.9]) put(g, rbox(0.3, 0.3, 0.05, 0.03), windowMat, x, 0.72, 0.86, false);
    put(g, rbox(0.5, 0.6, 0.06, 0.03), M('#8fc3ff'), 0, 0.45, 0.86);
    put(g, rbox(0.4, 0.12, 0.05, 0.02), M('#ff5a6e'), 0, 1.6, 0.56);
    put(g, rbox(0.12, 0.4, 0.05, 0.02), M('#ff5a6e'), 0, 1.6, 0.56);
  },
};

// ---------------------------------------------------------------- the world view
export class World3D {
  constructor({ land, groundAt, agentColors }) {
    this.land = land;
    this.groundAt = groundAt;
    this.colors = agentColors;
    this.buildings = new Map(); // sim id -> view
    this.obstacles = [];         // {x, z, r} that agents hop around
    this.night = 0;
    this.puffs = [];
    this.buildNature();
  }

  at(x, z, obj) { obj.position.set(x, this.groundAt(x, z), z); this.land.add(obj); return obj; }

  buildNature() {
    // the grove: every tree is one slot of the engine's tree array
    const [fx, fz] = ZONES.forest;
    this.trees = [];
    const foliage = ['#6fbf5e', '#5fae55', '#82cc69', '#4f9e4a'];
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996, r = 0.45 + Math.sqrt(i / 14) * 1.7;
      const g = new THREE.Group();
      put(g, new THREE.CylinderGeometry(0.08, 0.12, 0.62, 8).translate(0, 0.31, 0), M('#9a6a43'));
      const top = new THREE.Group(); top.position.y = 0.55; g.add(top);
      for (let k = 0; k < 3; k++) {
        const s = put(top, new THREE.IcosahedronGeometry(0.36 - k * 0.07, 2), M(foliage[(i + k) % 4], { roughness: 0.75 }), (hash(i * 3 + k) - 0.5) * 0.2, k * 0.3, (hash(i * 7 + k) - 0.5) * 0.2);
        s.scale.y = 0.9;
      }
      const stump = put(g, new THREE.CylinderGeometry(0.12, 0.13, 0.14, 10).translate(0, 0.07, 0), M('#c8955f'));
      stump.visible = false;
      g.scale.setScalar(0.85 + hash(i) * 0.4);
      g.rotation.y = hash(i + 9) * 6;
      this.at(fx + Math.cos(a) * r, fz + Math.sin(a) * r, g);
      this.trees.push({ g, top, stump, s: 1, shake: 0, last: TREE_WOOD });
      this.obstacles.push({ x: g.position.x, z: g.position.z, r: 0.28, soft: true });
    }
    // berry bushes
    const [bx, bz] = ZONES.berries;
    this.bushes = [];
    const berryGeo = new THREE.SphereGeometry(0.055, 8, 6);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.3, r = i % 2 ? 0.95 : 0.55;
      const g = new THREE.Group();
      const bush = put(g, new THREE.IcosahedronGeometry(0.34, 2), M('#4f9e4a', { roughness: 0.8 }), 0, 0.24, 0);
      bush.scale.set(1.1, 0.8, 1.1);
      const berries = [];
      for (let k = 0; k < BUSH_MAX; k++) {
        const ba = k * 2.1 + i, by = 0.18 + hash(k + i * 5) * 0.2;
        berries.push(put(g, berryGeo, M(k % 3 ? '#e8456a' : '#6a5cff', { roughness: 0.3 }), Math.cos(ba) * 0.33, by, Math.sin(ba) * 0.33, false));
      }
      this.at(bx + Math.cos(a) * r, bz + Math.sin(a) * r, g);
      this.bushes.push({ g, berries });
      this.obstacles.push({ x: g.position.x, z: g.position.z, r: 0.3, soft: true });
    }
    // quarry outcrop
    const [qx, qz] = ZONES.quarry;
    this.quarry = new THREE.Group();
    [[0, 0.35, -0.5, 0.62], [0.7, 0.25, -0.1, 0.45], [-0.6, 0.22, 0.1, 0.4], [0.2, 0.18, 0.45, 0.32], [-0.2, 0.6, -0.55, 0.4]].forEach(([x, y, z, s], i) => {
      const r = put(this.quarry, rockGeo(i * 5.1 + 2), M(['#b3ada4', '#c8c2b8', '#a59f97'][i % 3], { roughness: 0.85 }), x, y, z);
      r.scale.set(s * 1.2, s, s);
    });
    this.at(qx, qz, this.quarry);
    this.obstacles.push({ x: qx, z: qz - 0.3, r: 0.95 });
    // the spring / pond
    const [px, pz] = ZONES.spring;
    this.pond = new THREE.Group();
    this.water = put(this.pond, new THREE.CircleGeometry(1.15, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6cc3ee', roughness: 0.12, metalness: 0.05 }), 0, 0.03, 0, false);
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      const r = put(this.pond, rockGeo(i * 1.7, 1), M('#c9c2b8'), Math.cos(a) * 1.2, 0.04, Math.sin(a) * 1.2);
      r.scale.set(0.16, 0.08, 0.12);
    }
    for (const [x, z] of [[0.3, -0.2], [-0.4, 0.3]]) put(this.pond, new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2), M('#5aa84a'), x, 0.045, z, false);
    this.at(px, pz, this.pond);
    this.obstacles.push({ x: px, z: pz, r: 1.15 });
    // the ore vein, hidden until someone finds it
    const [ox, oz] = ZONES.ore;
    this.ore = new THREE.Group();
    this.ore.visible = false;
    this.crystals = [];
    [[0, 0.3, 0, 0.5], [0.5, 0.2, 0.3, 0.35], [-0.4, 0.2, 0.2, 0.32]].forEach(([x, y, z, s], i) => {
      const r = put(this.ore, rockGeo(i * 9.3, 2), M('#5c5862', { roughness: 0.7 }), x, y, z);
      r.scale.setScalar(s);
    });
    for (let i = 0; i < 7; i++) {
      const c = put(this.ore, new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshStandardMaterial({ color: '#ffd36b', emissive: '#ffb12e', emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.25 }),
        (hash(i) - 0.5) * 0.9, 0.35 + hash(i + 3) * 0.3, (hash(i + 7) - 0.5) * 0.6);
      c.scale.y = 1.8; c.rotation.z = (hash(i + 2) - 0.5);
      this.crystals.push(c);
    }
    this.at(ox, oz, this.ore);
    // the shared stores: a pallet that visibly fills and empties
    const [sx, sz] = ZONES.stores;
    this.stores = new THREE.Group();
    put(this.stores, rbox(1.25, 0.08, 0.95, 0.03), M('#c99464'), 0, 0.04, 0);
    const logGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.6, 10).rotateZ(Math.PI / 2);
    this.storeLogs = []; for (let i = 0; i < 9; i++) { const row = i < 4 ? 0 : i < 7 ? 1 : 2, k = row === 0 ? i : row === 1 ? i - 4 : i - 7; this.storeLogs.push(put(this.stores, logGeo, M('#8b5a35'), -0.3, 0.15 + row * 0.12, -0.32 + k * 0.15 + row * 0.07)); }
    this.storeStones = []; for (let i = 0; i < 8; i++) { const r = put(this.stores, rockGeo(i * 2.2, 1), M('#bdb6ab'), 0.2 + (i % 3) * 0.15, 0.13 + Math.floor(i / 3) * 0.1, -0.3 + (i % 2) * 0.15); r.scale.setScalar(0.085); this.storeStones.push(r); }
    this.storeFood = []; for (let i = 0; i < 5; i++) { const g = new THREE.Group(); put(g, new THREE.CylinderGeometry(0.11, 0.09, 0.14, 12), M('#c79a5b'), 0, 0.07, 0); put(g, new THREE.SphereGeometry(0.09, 10, 8), M(['#ff6b5a', '#ffb347', '#9fd36b'][i % 3]), 0, 0.16, 0); g.position.set(-0.45 + i * 0.22, 0.08, 0.32); this.stores.add(g); this.storeFood.push(g); }
    this.storeWater = []; for (let i = 0; i < 3; i++) this.storeWater.push(put(this.stores, new THREE.CylinderGeometry(0.11, 0.11, 0.26, 14), M('#7fb2ff', { roughness: 0.4 }), 0.52, 0.21, -0.28 + i * 0.25));
    this.storeMetal = []; for (let i = 0; i < 4; i++) this.storeMetal.push(put(this.stores, rbox(0.16, 0.06, 0.08, 0.02), M('#c9ced6', { metalness: 0.8, roughness: 0.3 }), 0.2 + i * 0.07, 0.11 + (i % 2) * 0.06, 0.12));
    this.storeTools = []; for (let i = 0; i < 3; i++) { const t = put(this.stores, rbox(0.04, 0.4, 0.04, 0.01), M('#9a6a43'), -0.05 + i * 0.1, 0.25, 0.05); t.rotation.z = -0.4 + i * 0.4; put(t, rbox(0.14, 0.06, 0.06, 0.02), M('#9aa3b2', { metalness: 0.7, roughness: 0.35 }), 0, 0.2, 0); this.storeTools.push(t); }
    this.stores.rotation.y = -0.3;
    this.at(sx, sz, this.stores);
    this.obstacles.push({ x: sx, z: sz, r: 0.7 });
    // signpost
    this.signTex = null; this.signDay = -1;
    const sign = new THREE.Group();
    put(sign, rbox(0.1, 1.0, 0.1, 0.03), M('#b5804f'), 0, 0.5, 0);
    this.signCanvas = document.createElement('canvas'); this.signCanvas.width = 512; this.signCanvas.height = 256;
    this.signTex = new THREE.CanvasTexture(this.signCanvas); this.signTex.colorSpace = THREE.SRGBColorSpace;
    const wood = M('#b5804f');
    put(sign, rbox(0.82, 0.44, 0.06, 0.03), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: this.signTex, roughness: 0.8 }), wood], 0, 0.86, 0.02);
    sign.rotation.y = 0.35;
    this.at(-3.6, 6.4, sign);
    this.obstacles.push({ x: -3.6, z: 6.4, r: 0.3 });
    // stone road: laid along the busiest paths once it's built
    const paths = [[ZONES.center, ZONES.forest], [ZONES.center, ZONES.quarry], [ZONES.center, ZONES.farm], [ZONES.center, ZONES.berries], [ZONES.center, ZONES.spring]];
    const stones = [];
    for (const [[x0, z0], [x1, z1]] of paths) {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 0.34);
      for (let k = 2; k < n - 2; k++) { const t = k / n; stones.push([x0 + (x1 - x0) * t + (hash(k + x1) - 0.5) * 0.12, z0 + (z1 - z0) * t + (hash(k + z1) - 0.5) * 0.12, hash(k * 3 + x0)]); }
    }
    this.road = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.16, 0.04, 10), new THREE.MeshStandardMaterial({ color: '#d8cfc0', roughness: 0.9 }), stones.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    stones.forEach(([x, z, h], i) => { mtx.compose(new THREE.Vector3(x, this.groundAt(x, z) + 0.02, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * 6), sc.set(0.85 + h * 0.4, 1, 0.85 + h * 0.4)); this.road.setMatrixAt(i, mtx); });
    this.road.count = 0;
    this.road.receiveShadow = true;
    this.roadTotal = stones.length;
    this.land.add(this.road);
  }

  plotOf(s, b) {
    if (b.bp === 'house') {
      const order = s.buildings.filter((x) => x.bp === 'house').indexOf(b);
      return HOME_PLOTS[order % HOME_PLOTS.length];
    }
    return PLOTS[b.bp] || [0, 0];
  }

  // keep the 3D world in step with the simulation (cheap: only properties change)
  sync(s) {
    // trees
    s.nodes.trees.forEach((w, i) => {
      const t = this.trees[i];
      if (w < t.last) t.shake = 1;
      t.last = w;
      t.target = w > 0 ? 0.4 + 0.6 * (w / TREE_WOOD) : 0;
    });
    s.nodes.berries.forEach((n, i) => this.bushes[i].berries.forEach((b, k) => (b.visible = k < n)));
    this.ore.visible = s.nodes.oreFound;
    this.crystals.forEach((c, i) => (c.visible = i < Math.ceil(s.nodes.ore / 160 * this.crystals.length)));
    this.drought = s.time < (s.droughtUntil || 0);
    // stores
    const st = s.stock;
    this.storeLogs.forEach((m, i) => (m.visible = i < Math.ceil(st.wood / 6)));
    this.storeStones.forEach((m, i) => (m.visible = i < Math.ceil(st.stone / 5)));
    this.storeFood.forEach((m, i) => (m.visible = i < Math.ceil(st.food / 12)));
    this.storeWater.forEach((m, i) => (m.visible = i < Math.ceil(st.water / 10)));
    this.storeMetal.forEach((m, i) => (m.visible = i < Math.ceil(st.metal / 4)));
    this.storeTools.forEach((m, i) => (m.visible = i < st.tools));
    // sign
    const day = Math.floor(s.time / 1440) + 1;
    if (day !== this.signDay) {
      this.signDay = day;
      const c = this.signCanvas.getContext('2d'), W = 512, H = 256;
      c.fillStyle = '#f7e2bd'; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(150,100,55,.12)'; for (let y = 0; y < H; y += 26) c.fillRect(0, y, W, 3);
      c.textAlign = 'center'; c.fillStyle = '#6b4526';
      c.font = '900 30px Nunito, sans-serif'; c.fillText('DOT.HOME', W / 2, 52);
      c.font = '900 96px Nunito, sans-serif'; c.fillText(`DAY ${day}`, W / 2, 156);
      c.font = '800 34px Nunito, sans-serif'; c.fillText('population 4', W / 2, 212);
      this.signTex.needsUpdate = true;
    }
    // buildings
    for (const b of s.buildings) {
      let v = this.buildings.get(b.id);
      if (!v) v = this.addBuilding(s, b);
      v.target = b.status === 'planned' ? 0 : b.status === 'done' ? 1 : b.progress;
      v.planned = b.status === 'planned';
      if (b.status === 'done' && !v.done) this.complete(v);
      if (v.crops) this.growCrops(v, b.growth || 0);
    }
    const road = s.buildings.find((b) => b.bp === 'road');
    this.road.count = road ? Math.floor(this.roadTotal * (road.status === 'done' ? 1 : road.progress)) : 0;
  }

  addBuilding(s, b) {
    const [x, z] = this.plotOf(s, b);
    const owner = b.owner && s.agents[b.owner];
    const ctx = { color: owner ? this.colors[b.owner] : null, owner: owner?.name };
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    if (BUILDERS[b.bp]) BUILDERS[b.bp](body, ctx);
    const size = SIZE[b.bp] || 1.5;
    // construction site: corner stakes and a rope line, plus scaffold poles while it rises
    const site = new THREE.Group();
    const half = size / 2;
    if (b.bp !== 'road') {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(site, rbox(0.05, 0.3, 0.05, 0.015), M('#c99464'), sx * half, 0.15, sz * half);
      for (const [px, pz, w, d] of [[0, -half, size, 0.015], [0, half, size, 0.015], [-half, 0, 0.015, size], [half, 0, 0.015, size]]) put(site, new THREE.BoxGeometry(w, 0.015, d), M('#ffd27a'), px, 0.26, pz, false);
      const tall = b.bp === 'farm' || b.bp === 'campfire' || b.bp === 'meeting_circle' ? 0 : 1.5;
      if (tall) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(site, rbox(0.05, tall, 0.05, 0.015), M('#d9b07c'), sx * (half - 0.15), tall / 2, sz * (half - 0.15));
    }
    root.add(site);
    this.at(x, z, root);
    // things that already existed when the page loaded just stand there; only new progress animates
    const start = b.status === 'done' ? 1 : b.status === 'planned' ? 0.02 : 0.04 + 0.96 * b.progress;
    body.scale.y = start;
    const v = { b, root, body, site, target: 0, shown: start, done: b.status === 'done', pop: 0, size, x, z, ...ctx };
    if (v.done) site.visible = false;
    if (ctx.flame) { v.flame = ctx.flame; v.light = ctx.light; }
    if (ctx.crops) v.crops = ctx.crops;
    this.buildings.set(b.id, v);
    if (b.bp !== 'road' && b.bp !== 'farm') this.obstacles.push({ x, z, r: size / 2 + 0.05, building: b.id });
    return v;
  }

  complete(v) {
    v.done = true;
    v.site.visible = false;
    v.pop = 1;
    this.puff(v.x, v.z, v.size);
  }

  growCrops(v, growth) {
    const k = Math.min(1, growth);
    if (Math.abs((v.lastGrowth ?? -1) - k) < 0.01) return;
    v.lastGrowth = k;
    const mtx = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const ripe = new THREE.Color('#f2c14e'), green = new THREE.Color('#79c95c');
    for (let i = 0; i < v.crops.count; i++) {
      v.crops.getMatrixAt(i, mtx); mtx.decompose(p, q, sc);
      const s = 0.25 + 0.85 * k * (0.85 + hash(i) * 0.3);
      mtx.compose(p.setY(0.06 + 0.1 * s), q, sc.set(s, s * 1.2, s));
      v.crops.setMatrixAt(i, mtx);
      v.crops.setColorAt(i, c.copy(green).lerp(ripe, Math.max(0, (k - 0.6) / 0.4)));
    }
    v.crops.instanceMatrix.needsUpdate = true;
    v.crops.instanceColor.needsUpdate = true;
  }

  puff(x, z, size) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mat.clone());
      const a = i / 10 * Math.PI * 2;
      m.position.set(x + Math.cos(a) * size * 0.45, this.groundAt(x, z) + 0.15, z + Math.sin(a) * size * 0.45);
      m.userData.v = new THREE.Vector3(Math.cos(a) * 0.8, 0.6 + Math.random() * 0.5, Math.sin(a) * 0.8);
      m.userData.life = 1;
      this.land.add(m);
      this.puffs.push(m);
    }
  }

  // where an agent should stand to work somewhere, and what they should face
  workSpot(s, zone, i, task) {
    const ring = (cx, cz, r, faceCenter = true) => {
      const a = i / 4 * Math.PI * 2 + 0.6;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      return { x, z, fx: faceCenter ? cx : null, fz: faceCenter ? cz : null };
    };
    switch (zone) {
      case 'forest': {
        const k = s.nodes.trees.findIndex((w) => w > 0);
        const t = this.trees[Math.max(0, k) + (i % 2)] || this.trees[0];
        const tx = t.g.position.x, tz = t.g.position.z;
        return { x: tx - 0.45 + (i % 2) * 0.1, z: tz + 0.35, fx: tx, fz: tz };
      }
      case 'berries': {
        const k = s.nodes.berries.findIndex((n) => n > 0);
        const b = this.bushes[Math.max(0, k)];
        const a = i * 1.6;
        return { x: b.g.position.x + Math.cos(a) * 0.62, z: b.g.position.z + Math.sin(a) * 0.62, fx: b.g.position.x, fz: b.g.position.z };
      }
      case 'quarry': return ring(ZONES.quarry[0], ZONES.quarry[1], 1.35);
      case 'spring': return ring(ZONES.spring[0], ZONES.spring[1], 1.55);
      case 'ore': return ring(ZONES.ore[0], ZONES.ore[1], 1.0);
      case 'farm': { const v = this.byBp(s, 'farm'); return v ? { x: v.x - 1.2 + i * 0.8, z: v.z + 1.0 - (i % 2) * 0.9, fx: null, fz: null } : ring(0, 0, 1.2); }
      case 'well': { const v = this.byBp(s, 'well'); return v ? ring(v.x, v.z, 0.9) : ring(ZONES.spring[0], ZONES.spring[1], 1.55); }
      case 'stores': return ring(ZONES.stores[0], ZONES.stores[1], 0.95);
      case 'workshop': case 'shop': {
        const v = this.byBp(s, zone === 'shop' ? 'market' : 'workshop');
        return v ? { x: v.x + (i - 1.5) * 0.35, z: v.z + v.size / 2 + 0.55, fx: v.x, fz: v.z } : ring(0, 0, 1.2);
      }
      case 'meeting': { const v = this.byBp(s, 'meeting_circle') || this.byBp(s, 'campfire'); return v ? ring(v.x, v.z, v.b.bp === 'meeting_circle' ? 0.7 : 1.0) : ring(0, 0.5, 1.0); }
      case 'site': {
        const v = this.buildings.get(task.target);
        if (!v) return ring(0, 0, 1);
        const a = (i / 4) * Math.PI * 1.2 - Math.PI * 0.1;
        const r = v.size / 2 + 0.5;
        return { x: v.x + Math.cos(a) * r, z: v.z + Math.abs(Math.sin(a)) * r, fx: v.x, fz: v.z };
      }
      case 'home': case 'bed': {
        const own = s.agents[task.who]?.home && this.buildings.get(s.agents[task.who].home);
        const v = own || this.byBp(s, 'shared_house');
        if (v) return { x: v.x + (own ? 0 : (i - 1.5) * 0.3), z: v.z + v.size / 2 + 0.25, fx: v.x, fz: v.z + 5, door: !!(task.bed === 'house' || task.bed === 'home') };
        const fire = this.byBp(s, 'campfire');
        return fire ? ring(fire.x, fire.z, 0.95) : ring(0, 0.5, 1.0);
      }
      case 'patrol': {
        const a = (s.time / 90) % (Math.PI * 2);
        return { x: Math.cos(a) * 6, z: Math.sin(a) * 6, fx: null, fz: null };
      }
      case 'edge': {
        const a = hash(task.start * 0.01) * Math.PI * 2;
        const r = ISLAND_R - 1.6;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, fx: Math.cos(a) * 20, fz: Math.sin(a) * 20 };
      }
    }
    return ring(0, 0.5, 1.2);
  }

  byBp(s, bp) {
    const b = s.buildings.find((x) => x.bp === bp && x.status === 'done');
    return b ? this.buildings.get(b.id) : null;
  }

  update(dt, t) {
    for (const tr of this.trees) {
      tr.s += ((tr.target ?? 1) - tr.s) * (1 - Math.exp(-3 * dt));
      tr.top.visible = tr.s > 0.05;
      tr.top.scale.setScalar(Math.max(0.05, tr.s));
      tr.stump.visible = tr.s < 0.3;
      tr.shake = Math.max(0, tr.shake - dt * 2.5);
      tr.top.rotation.z = Math.sin(t * 40) * 0.08 * tr.shake;
    }
    for (const v of this.buildings.values()) {
      const goal = v.planned ? 0.02 : 0.04 + 0.96 * v.target;
      v.shown += (goal - v.shown) * (1 - Math.exp(-4 * dt));
      v.body.scale.y = v.shown;
      if (v.pop > 0) {
        v.pop = Math.max(0, v.pop - dt * 1.6);
        const k = Math.sin(v.pop * Math.PI * 3) * v.pop * 0.12;
        v.body.scale.set(1 + k, v.shown * (1 - k), 1 + k);
      }
      if (v.flame) {
        v.flame.scale.set(1 + Math.sin(t * 13) * 0.08, 1 + Math.sin(t * 17 + 1) * 0.15 + this.night * 0.25, 1 + Math.cos(t * 11) * 0.08);
        v.light.intensity = (0.5 + this.night * 5) * (0.9 + Math.sin(t * 15) * 0.1);
      }
    }
    windowMat.emissiveIntensity = this.night * 1.4;
    this.water.scale.setScalar(this.drought ? 0.62 : 1);
    for (const m of [...this.puffs]) {
      m.userData.life -= dt * 1.1;
      m.position.addScaledVector(m.userData.v, dt);
      m.scale.setScalar(1 + (1 - m.userData.life) * 1.6);
      m.material.opacity = Math.max(0, m.userData.life) * 0.8;
      if (m.userData.life <= 0) { this.land.remove(m); m.geometry.dispose(); m.material.dispose(); this.puffs.splice(this.puffs.indexOf(m), 1); }
    }
    for (const c of this.crystals) c.rotation.y += dt * 0.6;
  }
}
