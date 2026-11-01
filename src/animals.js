import * as THREE from 'three';
import { feltMaterial } from './materials.js';

export const SPECIES = ['bear', 'bunny', 'cat', 'frog', 'chick', 'pig', 'penguin', 'seal'];

/* ---------- SDF primitives (rest frame, y up, face +z, feet at y=0) ---------- */
const S = (c, r, k = 0.1) => ({ t: 0, c, r, k }); // sphere
const E = (c, r, k = 0.1) => ({ t: 1, c, r, k }); // ellipsoid, r = [rx,ry,rz]
const C = (a, b, r, k = 0.1) => ({ t: 2, a, b, r, k }); // capsule
const R = (a, b, r1, r2, k = 0.1) => ({ t: 3, a, b, r1, r2, k }); // round cone
const fx = (v) => [-v[0], v[1], v[2]];
const mir = (p) => ({ ...p, c: p.c && fx(p.c), a: p.a && fx(p.a), b: p.b && fx(p.b) });
const sym = (...ps) => ps.flatMap((p) => [p, mir(p)]);

const len = Math.hypot;
function primDist(p, x, y, z) {
  switch (p.t) {
    case 0:
      return len(x - p.c[0], y - p.c[1], z - p.c[2]) - p.r;
    case 1: {
      const qx = x - p.c[0], qy = y - p.c[1], qz = z - p.c[2], r = p.r;
      const k0 = len(qx / r[0], qy / r[1], qz / r[2]);
      const k1 = len(qx / (r[0] * r[0]), qy / (r[1] * r[1]), qz / (r[2] * r[2]));
      return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
    }
    case 2: {
      const pax = x - p.a[0], pay = y - p.a[1], paz = z - p.a[2];
      const bax = p.b[0] - p.a[0], bay = p.b[1] - p.a[1], baz = p.b[2] - p.a[2];
      const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
      return len(pax - bax * h, pay - bay * h, paz - baz * h) - p.r;
    }
    default: {
      // iq round cone
      const pax = x - p.a[0], pay = y - p.a[1], paz = z - p.a[2];
      const bax = p.b[0] - p.a[0], bay = p.b[1] - p.a[1], baz = p.b[2] - p.a[2];
      const l2 = bax * bax + bay * bay + baz * baz, rr = p.r1 - p.r2, a2 = l2 - rr * rr, il2 = 1 / l2;
      const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
      const wx = pax * l2 - bax * yy, wy = pay * l2 - bay * yy, wz = paz * l2 - baz * yy;
      const x2 = wx * wx + wy * wy + wz * wz, y2 = yy * yy * l2, z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - p.r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - p.r1;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - p.r1;
    }
  }
}

function sdf(prims, x, y, z) {
  let d = primDist(prims[0], x, y, z);
  for (let i = 1; i < prims.length; i++) {
    const p = prims[i], e = primDist(p, x, y, z);
    const h = Math.max(p.k - Math.abs(d - e), 0) / p.k; // polynomial smooth min
    d = Math.min(d, e) - h * h * p.k * 0.25;
  }
  return d;
}

/* ---------- species: 羊毛毡胖墩，大身子加大头，粗短的胳膊腿，盒子里挤满时互相碰得到 ----------
   face.eye = [yaw, pitch, origin?]  (origin = right eye ray origin, mirrored for the left; default head)
   face.cheek = [yaw, pitch], face.mouth = [origin|null, pitch, style]
   patches = 局部换色：[形状, 颜色]，顶点落在形状里就染成那个颜色，边缘柔和过渡 */
const tint = (shapes, color) => shapes.map((p) => [p, color]);

const DEFS = {
  bear: {
    pitch: 220, color: '#dcc4a3',
    prims: [
      E([0, 0.34, 0], [0.31, 0.34, 0.27], 0.12),
      S([0, 0.71, 0.03], 0.26, 0.12),
      ...sym(S([0.19, 0.93, -0.01], 0.11, 0.08)), // 耳朵
      E([0, 0.65, 0.24], [0.11, 0.075, 0.09], 0.06), // 嘴套
      ...sym(R([0.26, 0.52, 0.03], [0.42, 0.38, 0.1], 0.11, 0.1, 0.1)), // 胳膊
      ...sym(C([0.17, 0.12, 0], [0.19, 0.12, 0.2], 0.12, 0.1)), // 腿
    ],
    patches: [...tint(sym(S([0.2, 0.95, 0.07], 0.065)), '#e6ab9b'), [E([0, 0.65, 0.3], [0.12, 0.085, 0.07]), '#f3e9d8']],
    face: { head: [0, 0.71, 0.03], eye: [26, 10], cheek: [50, -14], mouth: [[0, 0.65, 0.24], 0, 'bear'], size: 0.1 },
  },
  bunny: { // 垂耳兔：灰棕豆子身，奶白嘴套和肚皮，长耳朵垂在脸两边
    pitch: 330, color: '#9c8b7d',
    prims: [
      E([0, 0.38, 0], [0.38, 0.38, 0.33], 0.12),
      E([0, 0.58, 0.05], [0.36, 0.28, 0.3], 0.14),
      E([0, 0.13, -0.03], [0.28, 0.13, 0.25], 0.1), // 扁屁股，坐得稳
      ...sym(R([0.31, 0.76, 0.07], [0.4, 0.36, 0.11], 0.09, 0.11, 0.03)), // 垂耳贴着脸两侧往下垂，和头之间留一道缝
      S([0, 0.24, -0.33], 0.09, 0.06), // 尾巴
      ...sym(E([0.2, 0.1, 0.21], [0.12, 0.1, 0.13], 0.08)), // 前脚
    ],
    patches: [
      [E([0, 0.56, 0.3], [0.15, 0.1, 0.08]), '#efe4d2'], // 嘴套
      [E([0, 0.3, 0.29], [0.24, 0.22, 0.1]), '#efe4d2'], // 肚皮
      [S([0, 0.24, -0.4], 0.09), '#efe4d2'],
    ],
    face: { head: [0, 0.58, 0.05], eye: [30, 8], cheek: [52, -12], mouth: [[0, 0.56, 0.3], 0, 'bear'], size: 0.135 },
  },
  cat: { // 橘猫：橘色豆子身，额头几道深橘条纹，奶白嘴套和肚皮，小三角耳
    pitch: 294, color: '#dc975a',
    prims: [
      E([0, 0.38, 0], [0.37, 0.38, 0.32], 0.12),
      E([0, 0.6, 0.04], [0.37, 0.27, 0.29], 0.14),
      E([0, 0.13, -0.03], [0.28, 0.13, 0.25], 0.1), // 扁屁股
      ...sym(R([0.23, 0.8, 0], [0.28, 0.97, -0.01], 0.11, 0.035, 0.06)), // 小三角耳
      C([0.1, 0.12, -0.3], [0.3, 0.12, -0.2], 0.07, 0.06), // 尾巴
      ...sym(E([0.2, 0.1, 0.22], [0.11, 0.1, 0.12], 0.08)), // 前爪
    ],
    patches: [
      [E([0, 0.57, 0.3], [0.15, 0.1, 0.08]), '#f3e6cf'], // 嘴套
      [E([0, 0.32, 0.28], [0.23, 0.24, 0.1]), '#f3e6cf'], // 肚皮
      [E([0, 0.83, 0.17], [0.035, 0.09, 0.1]), '#b8682f'], // 额头条纹
      ...tint(sym(E([0.1, 0.81, 0.18], [0.03, 0.08, 0.1])), '#b8682f'),
      ...tint(sym(E([0.37, 0.5, 0], [0.08, 0.035, 0.18]), E([0.38, 0.37, 0], [0.08, 0.035, 0.2])), '#b8682f'), // 身侧条纹
      ...tint(sym(S([0.26, 0.88, 0.05], 0.045)), '#e8a99a'), // 耳朵里
    ],
    face: { head: [0, 0.6, 0.04], eye: [30, 8], cheek: [54, -12], mouth: [null, -14, 'cat'], size: 0.135 },
  },
  frog: {
    pitch: 185, color: '#97ab7c',
    prims: [
      E([0, 0.3, 0], [0.36, 0.3, 0.32], 0.12),
      E([0, 0.5, 0.08], [0.38, 0.26, 0.3], 0.12),
      ...sym(S([0.2, 0.74, 0.12], 0.15, 0.08)), // 眼睛鼓包
      ...sym(E([0.3, 0.15, -0.08], [0.14, 0.15, 0.2], 0.1)), // 后腿
      ...sym(E([0.26, 0.11, 0.25], [0.11, 0.11, 0.14], 0.08)), // 前脚
    ],
    patches: [[E([0, 0.22, 0.3], [0.22, 0.16, 0.1]), '#ebe5cc']], // 白肚皮
    face: { head: [0, 0.5, 0.08], eye: [16, 12, [0.2, 0.74, 0.12]], cheek: [55, -10], mouth: [null, -14, 'frog'], size: 0.11 },
  },
  chick: { // 蛋壳小鸡：奶黄豆子身坐在半个蛋壳里，小橙嘴，小翅膀搭在壳沿上
    pitch: 440, color: '#efd27a',
    prims: [
      E([0, 0.43, 0], [0.36, 0.43, 0.32], 0.12),
      E([0, 0.68, 0.04], [0.33, 0.26, 0.28], 0.14),
      E([0, 0.23, 0], [0.42, 0.23, 0.38], 0.05), // 蛋壳鼓出来一圈，底是平的
      E([0, 0.4, 0], [0.42, 0.05, 0.38], 0.04), // 壳口一圈凸边
      E([0, 0.65, 0.3], [0.08, 0.045, 0.07], 0.04), // 嘴
      ...sym(E([0.35, 0.5, 0.03], [0.08, 0.11, 0.1], 0.06)), // 小翅膀
    ],
    patches: [
      [E([0, 0, 0], [2, 0.44, 2]), '#f7f2e8'], // 蛋壳
      ...Array.from({ length: 10 }, (_, i) => { // 壳沿的锯齿
        const a = (i / 10) * Math.PI * 2;
        return [S([0.42 * Math.sin(a), 0.47, 0.38 * Math.cos(a)], 0.08), '#f7f2e8'];
      }),
      [E([0, 0.65, 0.33], [0.1, 0.06, 0.08]), '#e69a4a'],
    ],
    face: { head: [0, 0.68, 0.04], eye: [30, 10], cheek: [54, -12], mouth: [[0, 0.65, 0.3], 0, 'none'], size: 0.13 },
  },
  pig: { // 桃粉小猪：豆子身，扁圆猪鼻贴在脸上，耳朵往前耷拉，奶白肚皮
    pitch: 165, color: '#eeb2a2',
    prims: [
      E([0, 0.36, 0], [0.38, 0.36, 0.33], 0.12),
      E([0, 0.56, 0.05], [0.38, 0.26, 0.3], 0.14),
      E([0, 0.54, 0.33], [0.12, 0.08, 0.05], 0.03), // 扁鼻子
      E([0, 0.13, -0.03], [0.28, 0.13, 0.25], 0.1), // 扁屁股
      ...sym(E([0.27, 0.79, 0.12], [0.13, 0.05, 0.13], 0.04)), // 耳朵：扁扁的一片往前盖在头角上
      S([0, 0.3, -0.33], 0.07, 0.05), // 尾巴
      ...sym(E([0.2, 0.1, 0.22], [0.12, 0.1, 0.12], 0.08)), // 前脚
    ],
    patches: [
      [E([0, 0.54, 0.38], [0.13, 0.09, 0.05]), '#e5978a'], // 鼻子
      [E([0, 0.3, 0.28], [0.24, 0.2, 0.1]), '#f6e8d6'], // 肚皮
    ],
    face: { head: [0, 0.56, 0.05], eye: [30, 12], cheek: [55, -12], mouth: [[0, 0.54, 0.33], 0, 'pig'], size: 0.135 },
  },
  penguin: {
    pitch: 247, color: '#7d8bad',
    prims: [
      E([0, 0.45, 0], [0.36, 0.45, 0.32], 0.12),
      E([0, 0.76, 0.03], [0.28, 0.22, 0.26], 0.15),
      E([0, 0.7, 0.26], [0.09, 0.055, 0.09], 0.04), // 嘴
      ...sym(R([0.33, 0.6, 0], [0.5, 0.4, 0.04], 0.1, 0.08, 0.08)), // 鳍
      ...sym(E([0.14, 0.06, 0.15], [0.12, 0.06, 0.17], 0.06)), // 脚
    ],
    patches: [
      ...tint(sym(E([0.1, 0.74, 0.22], [0.16, 0.17, 0.15])), '#f3ecdf'), // 心形白脸
      [E([0, 0.36, 0.26], [0.26, 0.28, 0.12]), '#f3ecdf'], // 白肚皮
      [E([0, 0.7, 0.3], [0.1, 0.07, 0.09]), '#e2a43c'],
      ...tint(sym(E([0.14, 0.05, 0.16], [0.14, 0.07, 0.19])), '#e2a43c'),
    ],
    face: { head: [0, 0.76, 0.03], eye: [28, 10], cheek: [55, -14], mouth: [[0, 0.7, 0.26], 0, 'none'], size: 0.1 },
  },
  seal: {
    pitch: 196, color: '#cdc8d4',
    prims: [
      C([0, 0.28, -0.38], [0, 0.34, 0.1], 0.28, 0.1),
      S([0, 0.62, 0.3], 0.26, 0.12),
      E([0, 0.55, 0.5], [0.12, 0.08, 0.1], 0.05), // 嘴套
      ...sym(R([0.06, 0.2, -0.55], [0.2, 0.2, -0.8], 0.11, 0.09, 0.06)), // 尾鳍
      ...sym(R([0.25, 0.28, 0.1], [0.42, 0.14, 0.2], 0.1, 0.08, 0.08)), // 前鳍
    ],
    patches: [[E([0, 0.55, 0.56], [0.13, 0.09, 0.08]), '#f3ecdf'], ...tint(sym(E([0.14, 0.2, -0.75], [0.15, 0.1, 0.14])), '#bdb6c6')],
    face: { head: [0, 0.62, 0.3], eye: [26, 18], cheek: [50, -12], mouth: [[0, 0.55, 0.5], 0, 'cat'], size: 0.1, whiskers: true },
  },
};

/* ---------- meshing: surface nets on the SDF grid, vertices projected onto the surface ---------- */
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

function gradient(f, x, y, z, e = 0.004) {
  return [
    (f(x + e, y, z) - f(x - e, y, z)) / (2 * e),
    (f(x, y + e, z) - f(x, y - e, z)) / (2 * e),
    (f(x, y, z + e) - f(x, y, z - e)) / (2 * e),
  ];
}

function surfaceNets(f, lo, hi, h) {
  const N = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a]) / h) + 1);
  const [nx, ny, nz] = N;
  const stride = [1, nx, nx * ny];
  const F = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) F[i + nx * (j + ny * k)] = f(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);

  const cv = new Int32Array(F.length).fill(-1);
  const P = [];
  const f8 = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          const v = F[i + (c & 1) + nx * (j + ((c >> 1) & 1) + ny * (k + (c >> 2)))];
          f8[c] = v;
          if (v < 0) neg++;
        }
        if (neg === 0 || neg === 8) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of EDGES) {
          const fa = f8[a], fb = f8[b];
          if (fa < 0 === fb < 0) continue;
          const t = fa / (fa - fb);
          sx += (a & 1) + t * ((b & 1) - (a & 1));
          sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          sz += (a >> 2) + t * ((b >> 2) - (a >> 2));
          cnt++;
        }
        let x = lo[0] + (i + sx / cnt) * h, y = lo[1] + (j + sy / cnt) * h, z = lo[2] + (k + sz / cnt) * h;
        for (let it = 0; it < 3; it++) {
          const d = f(x, y, z), g = gradient(f, x, y, z), gl = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
          if (gl < 1e-9) break;
          x -= (g[0] * d) / gl; y -= (g[1] * d) / gl; z -= (g[2] * d) / gl;
        }
        cv[i + nx * (j + ny * k)] = P.length / 3;
        P.push(x, y, z);
      }

  // one quad per grid edge that crosses the surface, wound so normals point outward (inside = f < 0)
  const I = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const pos = [i, j, k], base = i + nx * (j + ny * k);
        for (let a = 0; a < 3; a++) {
          const u = (a + 1) % 3, v = (a + 2) % 3;
          if (pos[a] >= N[a] - 1 || pos[u] < 1 || pos[v] < 1 || pos[u] > N[u] - 2 || pos[v] > N[v] - 2) continue;
          const f0 = F[base], f1 = F[base + stride[a]];
          if (f0 < 0 === f1 < 0) continue;
          const q0 = cv[base - stride[u] - stride[v]], q1 = cv[base - stride[v]], q2 = cv[base], q3 = cv[base - stride[u]];
          if (f0 < 0) I.push(q0, q1, q2, q0, q2, q3);
          else I.push(q0, q2, q1, q0, q3, q2);
        }
      }
  return { pos: new Float32Array(P), index: new Uint32Array(I) };
}

/* ---------- particles ---------- */
const SPACING = 0.11, TH = SPACING * 0.25;

// Lattice offset (27 candidates) that puts the most particles into every primitive, thin parts included.
function lattice(prims, f, lo, hi) {
  let best = null, bestScore = -1;
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      for (let c = 0; c < 3; c++) {
        const pts = [];
        for (let x = lo[0] + (a / 3) * SPACING; x <= hi[0]; x += SPACING)
          for (let y = lo[1] + (b / 3) * SPACING; y <= hi[1]; y += SPACING)
            for (let z = lo[2] + (c / 3) * SPACING; z <= hi[2]; z += SPACING) if (f(x, y, z) < -TH) pts.push(x, y, z);
        let score = 0;
        for (const p of prims) {
          let n = 0;
          for (let i = 0; i < pts.length && n < 3; i += 3) if (primDist(p, pts[i], pts[i + 1], pts[i + 2]) < -TH) n++;
          score += n;
        }
        if (score > bestScore) { bestScore = score; best = pts; }
      }
  return new Float32Array(best);
}

/* ---------- face anchors ---------- */
function surfacePoint(f, o, yawDeg, pitchDeg) {
  const ya = (yawDeg * Math.PI) / 180, pi = (pitchDeg * Math.PI) / 180;
  const d = [Math.sin(ya) * Math.cos(pi), Math.sin(pi), Math.cos(ya) * Math.cos(pi)];
  const at = (t) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  let lo = 0, hi = 0.02;
  while (f(...at(hi)) < 0 && hi < 2) { lo = hi; hi += 0.02; }
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (f(...at(m)) < 0) lo = m; else hi = m;
  }
  const pos = at((lo + hi) / 2), g = gradient(f, ...pos), gl = Math.hypot(...g);
  return { pos, normal: g.map((v) => v / gl) };
}

/* ---------- build + cache ---------- */
const cache = new Map();

function build(name) {
  const def = DEFS[name], prims = def.prims, face = def.face;
  const f = (x, y, z) => sdf(prims, x, y, z);

  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of prims) {
    const pts = p.t < 2 ? [p.c] : [p.a, p.b];
    const r = p.t === 0 ? p.r : p.t === 1 ? Math.max(...p.r) : p.t === 2 ? p.r : Math.max(p.r1, p.r2);
    for (const q of pts) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a] - r); hi[a] = Math.max(hi[a], q[a] + r); }
  }
  for (let a = 0; a < 3; a++) { lo[a] -= 0.1; hi[a] += 0.1; }

  const { pos, index } = surfaceNets(f, lo, hi, 0.045);
  const rest = lattice(prims, f, lo, hi);

  const [eyeYaw, eyePitch, eyeOrg] = face.eye;
  const eo = (s) => (eyeOrg ? [s * eyeOrg[0], eyeOrg[1], eyeOrg[2]] : face.head);
  const anchors = [
    surfacePoint(f, eo(-1), -eyeYaw, eyePitch),
    surfacePoint(f, eo(1), eyeYaw, eyePitch),
    surfacePoint(f, face.head, -face.cheek[0], face.cheek[1]),
    surfacePoint(f, face.head, face.cheek[0], face.cheek[1]),
    surfacePoint(f, face.mouth[0] ?? face.head, 0, face.mouth[1]),
  ];

  // 顶点颜色：底色 + 局部花色
  const base = new THREE.Color(def.color), tmp = new THREE.Color(), col = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    tmp.copy(base);
    for (const [shape, c] of def.patches) {
      const d = primDist(shape, pos[i], pos[i + 1], pos[i + 2]);
      const w = Math.min(1, Math.max(0, 0.5 - d / 0.03));
      if (w > 0) tmp.lerp(new THREE.Color(c), w);
    }
    col[i] = tmp.r; col[i + 1] = tmp.g; col[i + 2] = tmp.b;
  }

  // center on the particle mean
  const m = [0, 0, 0], n = rest.length / 3;
  for (let i = 0; i < rest.length; i++) m[i % 3] += rest[i] / n;
  for (let i = 0; i < rest.length; i++) rest[i] -= m[i % 3];
  for (let i = 0; i < pos.length; i++) pos[i] -= m[i % 3];
  for (const a of anchors) a.pos = a.pos.map((v, i) => v - m[i]);

  return { pos, index, rest, anchors, col, face, pitch: def.pitch, color: def.color };
}

let felt = null; // 所有动物共用一份材质，颜色走顶点色

export function buildAnimal(species, { scale = 1 } = {}) {
  if (!DEFS[species]) throw new Error(`unknown species: ${species}`);
  let b = cache.get(species);
  if (!b) cache.set(species, (b = build(species)));

  const s = scale;
  const pos = b.pos.map((v) => v * s);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(b.col.slice(), 3));
  geometry.setIndex(new THREE.BufferAttribute(b.index.slice(), 1));
  geometry.computeVertexNormals();

  // 绒毛按静止姿态的坐标和法线长，形变时跟着表面走
  geometry.setAttribute('fiber', new THREE.BufferAttribute(pos.slice(), 3));
  geometry.setAttribute('fiberN', new THREE.BufferAttribute(geometry.attributes.normal.array.slice(), 3));

  const anchor = (a) => ({ pos: a.pos.map((v) => v * s), normal: [...a.normal] });
  const color = new THREE.Color(b.color);
  return {
    species,
    geometry,
    rest: b.rest.map((v) => v * s),
    radius: SPACING * s * 0.5,
    color,
    material: (felt ??= feltMaterial()),
    face: {
      eyes: [anchor(b.anchors[0]), anchor(b.anchors[1])],
      cheeks: [anchor(b.anchors[2]), anchor(b.anchors[3])],
      mouth: anchor(b.anchors[4]),
      size: b.face.size * s,
      mouthStyle: b.face.mouth[2],
      whiskers: !!b.face.whiskers,
    },
    pitch: b.pitch,
  };
}
