import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { yarnMaterial } from './knit.js';

const TABLE = -0.16;
const TAU = Math.PI * 2;
const LAMP_I = 40, CANDLE_I = 3, SHADE_I = 2.2;
const smooth = THREE.MathUtils.smoothstep;

let aniso = 4; // createProps 里按显卡能力改

// ---------- 通用小工具 ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw?.(c.getContext('2d'), w, h);
  return c;
}

function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function put(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function at(group, x, z, rotY = 0) {
  group.position.set(x, TABLE, z);
  group.rotation.y = rotY;
  return group;
}

// 剖面线 (半径, 高度) 先样条平滑再旋转；v 按弧长均匀；radiusAt(y) 查外壁半径，方便往杯壁上贴装饰
function lathe(pts, n = 120) {
  const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  const sp = curve.getSpacedPoints(n);
  const iTop = sp.reduce((b, p, i) => (p.y > sp[b].y ? i : b), 0);
  const outer = sp.slice(0, iTop + 1);
  const radiusAt = (y) => {
    const j = outer.findIndex((p) => p.y >= y);
    if (j <= 0) return outer[0].x;
    const a = outer[j - 1], b = outer[j];
    return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1);
  };
  return { geo: new THREE.LatheGeometry(sp, 64), len: curve.getLength(), radiusAt };
}

const yarnCache = new Map();
function yarn(color, stitch, repeat, color2, pattern) {
  const key = `${color}|${stitch}|${repeat}|${color2 ?? ''}|${pattern ?? ''}`;
  let m = yarnCache.get(key);
  if (!m) yarnCache.set(key, (m = yarnMaterial({ color, color2, pattern, stitch, repeat })));
  return m;
}
const qn = (n, q) => Math.max(q, Math.round(n / q) * q);
// 一块毛线贴图约 4 针 = 0.4 单位；strand 一块是两圈捻，捻距 0.2
const sphereRep = (r) => [qn((TAU * r) / 0.4, 4), qn((Math.PI * r) / 0.5, 2)];
const strandRep = (len, q = 8) => [qn(len / 0.4, q), 1];

// 一块贴图的针数 [列, 行]；fit 按表面展开的宽 w、高 h 算重复数，一针约 0.075 宽、0.065 高（整数，绕一圈才接得上）
const TILE = { stockinette: [4, 5], rib: [4, 5], garter: [4, 6], seed: [8, 8], cable: [8, 8], boucle: [7, 7] };
const fit = (stitch, w, h) => {
  const [c, r] = TILE[stitch];
  return [Math.max(1, Math.round(w / (c * 0.075))), Math.max(1, Math.round(h / (r * 0.065)))];
};

// 毛线绳：沿曲线的粗线管，捻距随线径放大
function rope(parent, curve, radius, color, closed = false) {
  const len = curve.getLength();
  const geo = new THREE.TubeGeometry(curve, Math.max(24, Math.round(len / 0.035)), radius, 8, closed);
  return put(parent, geo, yarn(color, 'strand', strandRep((len * 0.035) / radius, 2)));
}

// 水平绳圈
function ring(parent, R, y, tube, color) {
  const m = put(parent, new THREE.TorusGeometry(R, tube, 10, 64), yarn(color, 'strand', strandRep((TAU * R * 0.035) / tube, 2)));
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}

// 平面螺旋：一根粗线从中心盘到边缘，像钩出来的圆片；底下垫一层同色布挡缝
function spiral(parent, R, tube, color, y) {
  const r0 = 0.02, rMax = R - tube, turns = (rMax - r0) / (tube * 1.8);
  const n = Math.ceil(turns * 36), pts = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * turns * TAU, r = r0 + ((rMax - r0) * i) / n;
    pts.push(new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
  }
  rope(parent, new THREE.CatmullRomCurve3(pts), tube, color).position.y = y;
  const under = put(parent, new THREE.CircleGeometry(R - 0.01, 40), yarn(color, 'stockinette', fit('stockinette', 2 * R, 2 * R)), 0, y - tube * 0.4, 0);
  under.rotation.x = -Math.PI / 2;
}

// 单位球按比例压扁，做花瓣、熊耳、珠子这类小件
const UNIT = new THREE.SphereGeometry(1, 16, 12);
function blob(parent, mat, x, y, z, sx, sy = sx, sz = sx) {
  const m = put(parent, UNIT, mat, x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

const beadMat = new THREE.MeshStandardMaterial({ color: '#1c1210', roughness: 0.25 });

function glowTexture() {
  return tex(canvas(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }));
}

// ---------- 1. 钩织绿萝 ----------
// 心形叶：极坐标网格铺满轮廓（单位叶宽约 1，叶柄凹口在原点），上下两层鼓成枕头，边缘合拢后由绳边盖住
const SPOKES = 64, RINGS = 8, THICK = 0.12, HEART_CY = 0.2, HEART_TIP = 0.756;
const HEART = Array.from({ length: SPOKES }, (_, i) => {
  const t = (i / SPOKES) * TAU;
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return [0.5 * Math.sin(t) ** 3, ((12 - y) * 1.1) / 32 - 0.2406];
});
const cup = (x, y) => -0.6 * x * x - 0.3 * y * y; // 叶面微微下弯

function leafSurface(S, sign) {
  const pos = [0, HEART_CY, cup(0, HEART_CY) + sign * THICK];
  const uv = [0, HEART_CY * S]; // uv 按世界尺寸铺，所有叶子的针脚一样大
  for (let j = 1; j <= RINGS; j++) {
    const k = j / RINGS, h = THICK * Math.sqrt(1 - k * k);
    for (const [hx, hy] of HEART) {
      const x = hx * k, y = HEART_CY + (hy - HEART_CY) * k;
      pos.push(x, y, cup(x, y) + sign * h);
      uv.push(x * S, y * S);
    }
  }
  const idx = [];
  const v = (j, i) => 1 + (j - 1) * SPOKES + (i % SPOKES);
  const tri = (a, b, c) => (sign > 0 ? idx.push(a, b, c) : idx.push(a, c, b));
  for (let i = 0; i < SPOKES; i++) tri(0, v(1, i), v(1, i + 1));
  for (let j = 2; j <= RINGS; j++) {
    for (let i = 0; i < SPOKES; i++) {
      tri(v(j - 1, i), v(j, i), v(j, i + 1));
      tri(v(j - 1, i), v(j, i + 1), v(j - 1, i + 1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const LEAF_KINDS = [
  { color: '#6aad4f', stitch: 'seed' },
  { color: '#4a9446', stitch: 'seed' },
  { color: '#3a7f44', stitch: 'garter' },
  { color: '#4f9a46', stitch: 'seed', color2: '#d8e48e', pattern: 'stripe' }, // 带淡黄绿条的斑叶
];
const LEAF_ORDER = [0, 1, 0, 2, 1, 3, 0, 2, 1, 0, 3, 2];
const LEAF_EDGE = '#2e6a3a';

function leafMat({ color, stitch, color2, pattern }) {
  const [c, r] = TILE[stitch];
  return yarn(color, stitch, [1 / (c * 0.075), 1 / (r * 0.065)], color2, pattern);
}

// m：叶子的摆放矩阵（含缩放）；叶面、轮廓绳边、中脉绳都按它变换
function addLeaf(group, m, S, kind) {
  put(group, mergeGeometries([leafSurface(S, 1), leafSurface(S, -1)]).applyMatrix4(m), leafMat(kind));
  const to = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
  rope(group, new THREE.CatmullRomCurve3(HEART.map(([x, y]) => to(x, y, cup(x, y))), true), 0.03, LEAF_EDGE, true);
  const rib = [];
  for (let n = 0; n <= 8; n++) {
    const y = 0.02 + (0.62 * n) / 8;
    const k = y < HEART_CY ? (HEART_CY - y) / HEART_CY : (y - HEART_CY) / (HEART_TIP - HEART_CY);
    rib.push(to(0, y, cup(0, y) + THICK * Math.sqrt(1 - k * k)));
  }
  rope(group, new THREE.CatmullRomCurve3(rib), 0.022, LEAF_EDGE);
}

function buildPlant() {
  const rand = rng(11);
  const group = at(new THREE.Group(), -2.9, -3.9);

  const OAT = '#d8c7a0';
  const pot = lathe([[0.001, 0], [0.36, 0], [0.4, 0.03], [0.5, 0.3], [0.58, 0.62], [0.62, 0.8], [0.665, 0.84], [0.67, 0.88], [0.645, 0.9], [0.615, 0.88], [0.585, 0.82], [0.52, 0.6], [0.001, 0.55]], 100);
  put(group, pot.geo, yarn(OAT, 'stockinette', fit('stockinette', TAU * 0.55, pot.len)));
  ring(group, 0.64, 0.86, 0.06, OAT);
  ring(group, 0.395, 0.05, 0.05, OAT);
  const soil = put(group, new THREE.CircleGeometry(0.58, 40), yarn('#4a3224', 'boucle', [3, 3]), 0, 0.74, 0);
  soil.rotation.x = -Math.PI / 2;

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const curves = [];
  // 往上长再弯下来的枝
  const upCount = 6;
  const sets = [[0.72, 1], [0.68, 1], [0.7, 1], [1], [1], [1]];
  for (let i = 0; i < upCount; i++) {
    const a = (i / upCount) * TAU + rand() * 0.5, c = Math.cos(a), s = Math.sin(a);
    const hi = 1.35 + rand() * 0.45; // 最高约 1.8
    curves.push(new THREE.CatmullRomCurve3([
      V(c * 0.15, 0.72, s * 0.15),
      V(c * 0.2, 1.2, s * 0.2),
      V(c * (0.45 + rand() * 0.15), hi * 0.85 + 0.1, s * (0.45 + rand() * 0.15)),
      V(c * (0.8 + rand() * 0.25), hi, s * (0.8 + rand() * 0.25)),
      V(c * (1.1 + rand() * 0.2), hi - 0.2, s * (1.1 + rand() * 0.2)),
    ]));
  }
  // 两根越过盆沿垂下来
  for (const [a, ts] of [[Math.PI * 0.9, [0.55, 0.98]], [Math.PI * 0.6, [0.98]]]) {
    const c = Math.cos(a), s = Math.sin(a), px = -s * 0.25, pz = c * 0.25;
    curves.push(new THREE.CatmullRomCurve3([
      V(c * 0.15, 0.72, s * 0.15),
      V(c * 0.45, 1.05, s * 0.45),
      V(c * 0.8, 1.0, s * 0.8),
      V(c * 0.9, 0.55, s * 0.9),
      V(c * 0.9 + px * 0.4, 0.15, s * 0.9 + pz * 0.4),
      V(c * 1.0 + px, 0.03, s * 1.0 + pz),
    ]));
    sets.push(ts);
  }

  const up = V(0, 1, 0);
  let n = 0;
  curves.forEach((curve, ci) => {
    rope(group, curve, 0.035, '#5b9442');
    for (const t of sets[ci]) {
      const p = curve.getPoint(t), tan = curve.getTangent(t);
      const out = V(p.x, 0, p.z).normalize();
      const d = V().addScaledVector(tan, 0.45).addScaledVector(out, 0.85).addScaledVector(up, 0.15)
        .add(V(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.5)).normalize();
      let x = V().crossVectors(d, up);
      if (x.lengthSq() < 1e-4) x.set(1, 0, 0);
      x.normalize();
      const z = V().crossVectors(x, d);
      const roll = (rand() - 0.5) * 0.9, cr = Math.cos(roll), sr = Math.sin(roll);
      const x2 = x.clone().multiplyScalar(cr).addScaledVector(z, sr);
      const z2 = z.clone().multiplyScalar(cr).addScaledVector(x, -sr);
      const size = 0.62 + rand() * 0.22;
      const m = new THREE.Matrix4().makeBasis(x2.multiplyScalar(size), d.clone().multiplyScalar(size), z2.multiplyScalar(size));
      m.setPosition(p);
      addLeaf(group, m, size, LEAF_KINDS[LEAF_ORDER[n++ % LEAF_ORDER.length]]);
    }
  });
  return group;
}

// ---------- 2. 毛线球 + 竹针 ----------
function yarnBall(R, core, palette, rand) {
  const ball = new THREE.Group();
  put(ball, new THREE.SphereGeometry(R - 0.03, 32, 22), yarn(core, 'stockinette', sphereRep(R - 0.03)));

  // 一圈圈斜着缠上去的线，按色号合并
  const lists = palette.map(() => []);
  const tubeR = 0.032 * (R / 0.55);
  for (let i = 0; i < 50; i++) {
    const a = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    const ref = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const bu = new THREE.Vector3().crossVectors(a, ref).normalize();
    const bv = new THREE.Vector3().crossVectors(a, bu);
    const r = R - 0.02 + (rand() - 0.5) * 0.04;
    const span = Math.PI * (1.5 + rand() * 0.4);
    const phi0 = rand() * TAU;
    const h0 = (rand() - 0.5) * 0.6 * r;
    const dh = (rand() - 0.5) * 0.7 * r;
    const pts = [];
    for (let k = 0; k <= 40; k++) {
      const f = k / 40, phi = phi0 + f * span;
      const h = THREE.MathUtils.clamp(h0 + dh * f, -0.85 * r, 0.85 * r);
      const rr = Math.sqrt(r * r - h * h);
      pts.push(new THREE.Vector3().addScaledVector(bu, Math.cos(phi) * rr).addScaledVector(bv, Math.sin(phi) * rr).addScaledVector(a, h));
    }
    lists[i % palette.length].push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, tubeR, 6, false));
  }
  lists.forEach((list, i) => {
    put(ball, mergeGeometries(list), yarn(palette[i], 'strand', strandRep(R * 5.3)));
    list.forEach((g) => g.dispose());
  });
  return ball;
}

const woodMat = new THREE.MeshStandardMaterial({ color: '#dfb883', roughness: 0.5 });

function addNeedles(ball, R) {
  const geo = new THREE.CylinderGeometry(0.034, 0.016, 2.2, 10);
  const knob = new THREE.SphereGeometry(0.085, 16, 12);
  const yAxis = new THREE.Vector3(0, 1, 0);
  // [入针点方向, 针的朝向]
  for (const [e, a] of [[[0.2, 0.9, 0.1], [-0.5, 0.85, 0.15]], [[0.5, 0.8, 0.3], [0.1, 0.9, 0.35]]]) {
    const dir = new THREE.Vector3(...a).normalize();
    const n = new THREE.Group();
    n.position.set(...e).normalize().multiplyScalar(R).addScaledVector(dir, 0.75); // 针尖插进去 0.35
    n.quaternion.setFromUnitVectors(yAxis, dir);
    put(n, geo, woodMat);
    put(n, knob, woodMat, 0, 1.12, 0);
    ball.add(n);
  }
}

function buildYarn() {
  const group = new THREE.Group();
  const pink = yarnBall(0.55, '#c97b84', ['#e9a0a0', '#dd8f94', '#f0b4ae'], rng(21));
  pink.position.set(4.3, TABLE + 0.55 * 0.95, -0.4);
  addNeedles(pink, 0.55);
  group.add(pink);

  const cream = yarnBall(0.5, '#cdbb9d', ['#efe4d0', '#f6ecdb', '#e3d4ba'], rng(22));
  cream.position.set(4.6, TABLE + 0.5 * 0.95, 0.95);
  group.add(cream);

  // 从奶油球垂到桌面的一小截线头
  const y = TABLE + 0.035;
  const tail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(4.38, TABLE + 0.2, 1.36), new THREE.Vector3(4.22, y + 0.04, 1.62), new THREE.Vector3(4.42, y, 1.92),
    new THREE.Vector3(4.12, y, 2.2), new THREE.Vector3(4.3, y, 2.42),
  ]);
  put(group, new THREE.TubeGeometry(tail, 80, 0.035, 6), yarn('#efe4d0', 'strand', strandRep(tail.getLength(), 4)));
  return group;
}

// ---------- 3. 针织格子餐巾 ----------
function buildNapkin() {
  const group = at(new THREE.Group(), 4.0, 3.0, THREE.MathUtils.degToRad(-20));
  const edge = yarn('#efe4d0', 'garter', [8, 1]);
  // 格子方块约 0.3 见方；check 的列数必须是 4 的倍数才接得上
  const layer = (w, d, x, y, z, rot) => {
    const plaid = yarn('#efe4d0', 'stockinette', [qn(w / 0.3, 4), qn(d / 0.3, 4)], '#d98f86', 'check');
    const m = put(group, new RoundedBoxGeometry(w, 0.09, d, 4, 0.04), [edge, edge, plaid, edge, edge, edge], x, y, z);
    m.rotation.y = rot;
  };
  layer(1.6, 1.1, 0, 0.045, 0, 0);
  layer(1.5, 0.95, 0.05, 0.135, -0.07, 0.05);
  // 折边卷成一根粗绳
  rope(group, new THREE.LineCurve3(new THREE.Vector3(-0.68, 0.1, 0.42), new THREE.Vector3(0.78, 0.1, 0.42)), 0.075, '#d98f86');
  return group;
}

// ---------- 钩针杯垫（日夜共用） ----------
function buildCoaster() {
  const group = at(new THREE.Group(), -4.3, 0.9);
  spiral(group, 0.63, 0.06, '#efe4d0', 0.06);
  ring(group, 0.66, 0.07, 0.07, '#efe4d0');
  return group;
}

// ---------- 杯子（茶杯和可可杯共用） ----------
// 钩织杯：车削杯身 + 口沿 / 杯底绳圈 + 把手，把手朝 -x（背向筐子）
function vessel(profile, { color, rim, base, handle }) {
  const { geo, len, radiusAt } = lathe(profile);
  const group = new THREE.Group();
  put(group, geo, yarn(color, 'stockinette', fit('stockinette', TAU * 0.5, len)));
  ring(group, rim[0], rim[1], 0.06, color);
  ring(group, base[0], base[1], 0.05, color);
  // 弧形粗绳，两端埋进杯壁
  const arc = Math.PI * 1.1, tube = 0.065;
  const h = put(group, new THREE.TorusGeometry(handle.r, tube, 12, 36, arc), yarn(color, 'strand', strandRep((arc * handle.r * 0.035) / tube, 2)), handle.x, handle.y, 0);
  h.rotation.z = Math.PI - arc / 2;
  return { group, radiusAt };
}

// 把贴花钉在杯外壁：phi 绕杯一圈的角度（-x 是把手），y 高度；贴花 +z 朝外，顺杯壁坡度倾斜
function stitchOn(vs, proto, phi, y) {
  const dr = (vs.radiusAt(y + 0.03) - vs.radiusAt(y - 0.03)) / 0.06, r = vs.radiusAt(y) + 0.015;
  const m = proto.clone();
  m.position.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
  m.rotation.order = 'YXZ';
  m.rotation.set(Math.atan(dr), Math.PI / 2 - phi, 0);
  vs.group.add(m);
}

// 赤陶色五瓣小花，芥末黄法式结当花心
function flowerApplique() {
  const g = new THREE.Group();
  const petal = yarn('#c4683c', 'stockinette', [2, 1]), bead = yarn('#e2a53c', 'stockinette', [1, 1]);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU;
    blob(g, petal, Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0.02, 0.07, 0.07, 0.04);
  }
  blob(g, bead, 0, 0, 0.04, 0.045, 0.045, 0.04);
  return g;
}

function bearApplique() {
  const g = new THREE.Group();
  const fur = yarn('#8a5638', 'stockinette', [3, 2]), ear = yarn('#8a5638', 'stockinette', [1, 1]), muzzle = yarn('#e8cfa8', 'stockinette', [1, 1]);
  for (const e of [-1, 1]) {
    blob(g, ear, e * 0.075, 0.075, 0.01, 0.045, 0.045, 0.03);
    blob(g, beadMat, e * 0.035, 0.015, 0.078, 0.015);
  }
  blob(g, fur, 0, 0, 0.03, 0.1, 0.092, 0.055);
  blob(g, muzzle, 0, -0.03, 0.065, 0.045, 0.036, 0.03);
  blob(g, beadMat, 0, -0.018, 0.093, 0.016, 0.012, 0.012);
  return g;
}

function steamSprites(parent) {
  const map = tex(canvas(128, 128, (g) => {
    const blob = (x, y, r, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    };
    blob(64, 64, 50, 0.7);
    blob(46, 52, 28, 0.5);
    blob(82, 74, 30, 0.5);
  }));
  const sprites = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0, rotation: i * 1.3 }));
    s.renderOrder = 5;
    parent.add(s);
    sprites.push(s);
  }
  return sprites;
}

// 杯子在 (-4.3, 0.9)，镜头在它右前方约 57°；把手（局部 -x）转 40° 到左前方露出来
const FACE_CAMERA = THREE.MathUtils.degToRad(40);

function buildTeaCup() {
  const group = new THREE.Group();
  group.position.set(-4.3, TABLE + 0.1, 0.9);
  const cup = vessel(
    [[0.001, 0], [0.26, 0], [0.33, 0.04], [0.44, 0.18], [0.5, 0.38], [0.515, 0.6], [0.505, 0.8], [0.495, 0.88], [0.47, 0.92], [0.44, 0.88], [0.45, 0.7], [0.44, 0.4], [0.36, 0.18], [0.001, 0.14]],
    { color: '#efe4d0', rim: [0.495, 0.88], base: [0.33, 0.04], handle: { r: 0.2, x: -0.5, y: 0.48 } },
  );
  // 把手转到左前方，花集中在朝镜头的半边
  cup.group.rotation.y = FACE_CAMERA;
  group.add(cup.group);
  const flower = flowerApplique();
  for (const [deg, y] of [[25, 0.45], [70, 0.62], [115, 0.45], [300, 0.6]]) stitchOn(cup, flower, THREE.MathUtils.degToRad(deg), y);
  spiral(cup.group, 0.435, 0.045, '#9a5424', 0.76); // 茶面略低于口沿
  return { group, steam: steamSprites(group) };
}

// ---------- 5. 可可杯 ----------
function buildMug() {
  const group = new THREE.Group();
  group.position.set(-4.3, TABLE + 0.1, 0.9);
  const mug = vessel(
    [[0.001, 0], [0.4, 0], [0.47, 0.05], [0.5, 0.3], [0.51, 0.75], [0.52, 1.0], [0.525, 1.04], [0.5, 1.08], [0.46, 1.04], [0.45, 0.8], [0.44, 0.3], [0.4, 0.15], [0.001, 0.13]],
    { color: '#efe4d0', rim: [0.49, 1.04], base: [0.455, 0.055], handle: { r: 0.25, x: -0.47, y: 0.55 } },
  );
  mug.group.rotation.y = FACE_CAMERA;
  group.add(mug.group);
  const bear = bearApplique();
  for (const deg of [30, 95, 300]) stitchOn(mug, bear, THREE.MathUtils.degToRad(deg), 0.55);
  spiral(mug.group, 0.44, 0.05, '#6a3a22', 0.88);

  const mallow = new RoundedBoxGeometry(0.21, 0.15, 0.21, 3, 0.06);
  const mallowMat = yarn('#fff6ea', 'stockinette', fit('stockinette', 0.21, 0.15));
  const rand = rng(41);
  for (const [x, z] of [[-0.17, 0.1], [0.15, 0.15], [-0.02, -0.15], [0.22, -0.1]]) {
    const m = put(mug.group, mallow, mallowMat, x, 0.98, z);
    m.rotation.set((rand() - 0.5) * 0.4, rand() * TAU, (rand() - 0.5) * 0.4);
  }
  return group;
}

// ---------- 6. 台灯 ----------
function buildLamp() {
  const group = new THREE.Group(); // 世界坐标直接摆
  const wood = new THREE.MeshStandardMaterial({ color: '#a8703f', roughness: 0.55 });
  const px = -6.0, pz = -2.2, topY = 2.75;
  const base = lathe([[0.001, 0], [0.5, 0], [0.55, 0.03], [0.55, 0.09], [0.48, 0.13], [0.3, 0.15], [0.001, 0.15]], 40);
  const baseMesh = put(group, base.geo, wood, px, TABLE, pz);
  const y0 = TABLE + 0.15;
  const pole = put(group, new THREE.CylinderGeometry(0.045, 0.05, topY - y0, 14), wood, px, (topY + y0) / 2, pz);
  put(group, new THREE.SphereGeometry(0.07, 14, 10), wood, px, topY, pz);
  // 斜臂越过灯罩上口，再垂一小截到灯座
  const arc = new THREE.CatmullRomCurve3([
    new THREE.Vector3(px, topY, pz), new THREE.Vector3(-5.8, 3.1, -1.9), new THREE.Vector3(-5.35, 3.3, -1.55),
    new THREE.Vector3(-4.9, 3.25, -1.3), new THREE.Vector3(-4.9, 2.95, -1.3),
  ]);
  const arm = put(group, new THREE.TubeGeometry(arc, 40, 0.035, 8), wood);
  [baseMesh, pole, arm].forEach((m) => (m.castShadow = false)); // 灯在这些东西前方，不让它们挡光

  const C = new THREE.Vector3(-4.9, 2.6, -1.3);
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffe2b0', toneMapped: false });
  const bulb = put(group, new THREE.SphereGeometry(0.2, 20, 14), bulbMat, C.x, C.y - 0.05, C.z);
  bulb.castShadow = bulb.receiveShadow = false;

  // 针织灯罩：罗纹鼓形，罩体和上下绳圈都靠自发光透出灯光
  const glowing = (m, side) => {
    m.side = side;
    m.emissive = new THREE.Color('#ffb35e');
    m.emissiveMap = m.map;
    m.emissiveIntensity = 0;
    return m;
  };
  const shadeRep = fit('rib', TAU * 0.775, 0.95);
  const shadeGeo = new THREE.CylinderGeometry(0.7, 0.85, 0.9, 56, 1, true);
  const shadeMats = [THREE.FrontSide, THREE.BackSide].map((side) => glowing(yarnMaterial({ color: '#f3e0b8', stitch: 'rib', repeat: shadeRep }), side));
  for (const m of shadeMats) {
    const shade = put(group, shadeGeo, m, C.x, C.y, C.z);
    shade.castShadow = shade.receiveShadow = false; // 灯光在罩子里，罩子不能投影
  }
  const edgeMat = glowing(yarnMaterial({ color: '#f3e0b8', stitch: 'strand', repeat: strandRep(TAU * 0.78 * 0.7, 2) }), THREE.FrontSide);
  shadeMats.push(edgeMat);
  for (const [R, dy] of [[0.7, 0.45], [0.85, -0.45]]) {
    const r = put(group, new THREE.TorusGeometry(R, 0.05, 10, 64), edgeMat, C.x, C.y + dy, C.z);
    r.rotation.x = Math.PI / 2;
    r.castShadow = r.receiveShadow = false;
  }

  const spot = new THREE.SpotLight('#ffc27a', 0, 0, 0.85, 0.8, 1);
  spot.position.set(C.x, C.y - 0.1, C.z);
  spot.target.position.set(0.2, 0, 0.2);
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = -0.0008;
  spot.shadow.normalBias = 0.06; // 绒毛壳层一层层叠着，偏移小了会满身白点
  spot.shadow.camera.near = 0.5;
  spot.shadow.camera.far = 20;
  group.add(spot);
  const glow = new THREE.PointLight('#ffb766', 0, 4, 2);
  glow.position.copy(C);
  group.add(glow);
  return { group, spot, glow, shadeMats };
}

// ---------- 7. 三本钩织书 ----------
function buildBooks() {
  const group = at(new THREE.Group(), 4.7, -2.6, 0.12);
  const pageMat = yarn('#f0e4cc', 'garter', [4, 1]); // 一行行脊线当书页边
  let y = 0;
  for (const [w, h, d, color, stitch, trim, yaw, ox, oz] of [
    [1.9, 0.32, 1.4, '#7a5238', 'stockinette', '#e6d9b8', 0.08, 0, 0],
    [1.75, 0.28, 1.28, '#e6d9b8', 'seed', '#8a6a4a', -0.1, 0.06, -0.04],
    [1.65, 0.26, 1.2, '#6f8c64', 'rib', '#efe4d0', 0.38, -0.04, 0.03],
  ]) {
    const book = new THREE.Group();
    const cover = yarn(color, stitch, fit(stitch, w, d));
    const t = 0.06;
    put(book, new RoundedBoxGeometry(w, t, d, 3, 0.025), cover, 0, h / 2 - t / 2, 0);
    put(book, new RoundedBoxGeometry(w, t, d, 3, 0.025), cover, 0, -h / 2 + t / 2, 0);
    put(book, new RoundedBoxGeometry(w, h, 0.08, 3, 0.03), cover, 0, 0, d / 2 - 0.04); // 书脊朝 +z
    put(book, new THREE.BoxGeometry(w - 0.12, h - 2 * t + 0.02, d - 0.1), pageMat, 0, 0, -0.01);
    for (const x of [-0.55, -0.45, 0.45, 0.55]) {
      const line = new THREE.LineCurve3(new THREE.Vector3(x * (w / 1.9), -h / 2 + 0.03, d / 2 + 0.005), new THREE.Vector3(x * (w / 1.9), h / 2 - 0.03, d / 2 + 0.005));
      rope(book, line, 0.025, trim);
    }
    book.position.set(ox, y + h / 2, oz);
    book.rotation.y = yaw;
    group.add(book);
    y += h;
  }
  return group;
}

// ---------- 8. 钩织蜡烛 ----------
function buildCandle() {
  const group = at(new THREE.Group(), 5.0, -1.1);
  const wax = yarnMaterial({ color: '#f4e6c8', stitch: 'rib', repeat: fit('rib', TAU * 0.4, 0.6) });
  wax.emissive = new THREE.Color('#ffb060');
  wax.emissiveIntensity = 0;
  put(group, new THREE.CylinderGeometry(0.4, 0.4, 0.6, 40), wax, 0, 0.34, 0);
  ring(group, 0.4, 0.61, 0.055, '#f4e6c8');
  ring(group, 0.4, 0.07, 0.055, '#f4e6c8');
  spiral(group, 0.38, 0.045, '#f4e6c8', 0.6); // 顶面盘成螺旋
  rope(group, new THREE.LineCurve3(new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, 0.7, 0)), 0.02, '#3a2a22');

  const flame = new THREE.Group();
  flame.position.y = 0.66;
  const teardrop = lathe([[0.001, 0], [0.03, 0.015], [0.048, 0.07], [0.042, 0.14], [0.022, 0.22], [0.001, 0.3]], 24).geo;
  const outer = new THREE.Mesh(teardrop, new THREE.MeshBasicMaterial({ color: '#ffc864', toneMapped: false }));
  const inner = new THREE.Mesh(teardrop, new THREE.MeshBasicMaterial({ color: '#fff3cf', toneMapped: false }));
  inner.scale.set(0.55, 0.6, 0.55);
  flame.add(outer, inner);
  flame.scale.setScalar(0.75);
  group.add(flame);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff9a40', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.5 }));
  halo.scale.setScalar(1.1);
  halo.position.y = 0.78;
  halo.renderOrder = 6;
  group.add(halo);

  const light = new THREE.PointLight('#ffa04a', 0, 5, 2);
  light.position.set(0, 0.85, 0);
  group.add(light);
  return { group, flame, halo, light, wax };
}

// ---------- 入口 ----------
export function createProps({ scene, renderer }) {
  aniso = renderer.capabilities.getMaxAnisotropy();
  const group = new THREE.Group();
  scene.add(group);

  group.add(buildPlant(), buildYarn(), buildNapkin(), buildCoaster());

  const day = new THREE.Group();
  const tea = buildTeaCup();
  day.add(tea.group);

  const night = new THREE.Group();
  const lamp = buildLamp();
  const candle = buildCandle();
  night.add(buildMug(), lamp.group, buildBooks(), candle.group);
  group.add(day, night, lamp.spot.target);
  night.visible = false;

  const lampLight = lamp.spot;
  let s = 0; // 夜里灯的亮度 0..1

  function setTime(t) {
    const isNight = t >= 0.5;
    s = smooth(t, 0.5, 1);
    day.visible = !isNight;
    night.visible = isNight;
    lampLight.castShadow = isNight;
    lampLight.intensity = LAMP_I * s;
    lamp.glow.intensity = SHADE_I * s;
    lamp.shadeMats[0].emissiveIntensity = 0.45 * s;
    lamp.shadeMats[1].emissiveIntensity = 0.9 * s;
    lamp.shadeMats[2].emissiveIntensity = 0.6 * s;
    candle.wax.emissiveIntensity = 0.15 * s;
  }
  setTime(0);

  let clock = 0, noise = 0, noiseTarget = 0, nextNoise = 0;
  function update(dt) {
    dt = Math.min(dt, 0.1);
    clock += dt;
    if (day.visible) {
      // 白烟：循环上升，边飘边变大变淡
      tea.steam.forEach((sp, i) => {
        const k = (clock / 4 + i / tea.steam.length) % 1;
        sp.position.set(Math.sin(k * 5 + i * 2) * 0.09 + k * 0.1, 0.95 + k * 1.6, Math.cos(k * 4 + i) * 0.05);
        sp.scale.setScalar(0.3 + k * 0.7);
        sp.material.opacity = Math.sin(k * Math.PI) ** 1.3 * 0.4;
      });
    }
    if (night.visible) {
      nextNoise -= dt;
      if (nextNoise <= 0) {
        noiseTarget = Math.random() * 2 - 1;
        nextNoise = 0.05 + Math.random() * 0.12;
      }
      noise += (noiseTarget - noise) * Math.min(1, dt * 14);
      const f = 1 + 0.07 * Math.sin(clock * 9.3) + 0.05 * Math.sin(clock * 15.7 + 1.3) + 0.04 * Math.sin(clock * 4.1 + 0.6) + 0.07 * noise;
      candle.light.intensity = CANDLE_I * s * f;
      candle.halo.material.opacity = 0.5 * (0.4 + 0.6 * s) * f;
      candle.flame.scale.set(0.75 * (1 + 0.06 * Math.sin(clock * 13) + 0.04 * noise), 0.75 * (1 + 0.5 * (f - 1)), 0.75);
      candle.flame.rotation.z = 0.06 * Math.sin(clock * 5.3) + 0.05 * noise;
    }
  }

  return { group, lampLight, setTime, update };
}
