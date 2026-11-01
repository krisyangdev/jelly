import * as THREE from 'three';

// Soft bodies by meshless shape matching (Müller 2005) with position-based projection.
// Hot loops use plain typed arrays and scalars; nothing is allocated per frame.

const MAX_SPEED = 25;      // per-particle speed cap
const THROW_SPEED = 14;    // cap on release
const GRAB_RADIUS = 2.2;   // in spacings
const GRAB_PULL = 0.7;     // per-substep pull fraction on the grabbed particle
const GRAB_STEP = 0.06;    // max displacement per substep from the grab
const IMPACT_MIN = 1.2;
const IMPACT_COOLDOWN = 0.1;
const COLLISION_ITERS = 2;
const RIM_SLOPE = 1;        // rim top rises toward the outside so bodies landing on it slide back in
const WALL_EPS = 1e-3;     // float32 slack when testing whether a particle was inside a wall bound

const Aq = new Float64Array(9);  // scratch: Apq, then A (row-major)
const nextPow2 = (n) => { let t = 1; while (t < n) t <<= 1; return t; };


export class JellyWorld {
  constructor({ halfX = 3, halfZ = 2, floorY = 0, wallHeight = 0.5, wallThickness = 0.26, gravity = -12, substeps = 6, friction = 0.5 } = {}) {
    this.halfX = halfX; this.halfZ = halfZ; this.floorY = floorY; this.wallHeight = wallHeight; this.wallThickness = wallThickness;
    this.gravity = new THREE.Vector3(0, gravity, 0); this.substeps = substeps; this.friction = friction;
    this.bodies = [];
    this.onImpact = null;
    this._nextId = 1;
    this._grab = null;
    // per-body stats (indexed by position in bodies)
    this._sCap = 0;
    this._impSum = null; this._impCnt = null; this._impMax = null; this._floorCnt = null;
    this._posArrs = []; this._oldArrs = []; this._innerArrs = []; this._cenArrs = []; this._rad = null; this._ks = null;
    this._fireB = []; this._fireS = [];
    // spatial hash
    this._rCap = 0; this._tSize = 0;
    this._refBody = null; this._refIdx = null; this._refKey = null; this._sorted = null;
    this._cellStart = null; this._fillPos = null;
    this._cellInv = 1;
  }

  addBody({ rest, radius, stiffness = 0.25, beta = 0.35, damping = 0.995,
            position = { x: 0, y: 1, z: 0 }, yaw = 0, velocity = { x: 0, y: 0, z: 0 } }) {
    const n = (rest.length / 3) | 0;
    const body = {
      id: this._nextId++, n, radius,
      pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
      rest: Float32Array.from(rest),
      center: new THREE.Vector3(), velocity: new THREE.Vector3(),
      M: new THREE.Matrix3(), R: new THREE.Matrix3(),
      restScale: new THREE.Vector3(1, 1, 1),
      stiffness, beta, damping, impact: 0, grounded: false,
      _old: new Float32Array(n * 3),
      _inv: new Float64Array(6),   // Aqq^-1 (symmetric): 00 01 02 11 12 22
      _q: new Float64Array([0, 0, 0, 1]),
      _cool: 0, _i: 0,
    };
    // Aqq = sum q q^T, inverted via cofactors (with a small ridge for flat lattices)
    const q = body.rest;
    let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0;
    for (let i = 0; i < n * 3; i += 3) {
      const x = q[i], y = q[i + 1], z = q[i + 2];
      a += x * x; b += x * y; c += x * z; d += y * y; e += y * z; f += z * z;
    }
    const ridge = 1e-6 * (a + d + f) / 3 + 1e-12;
    a += ridge; d += ridge; f += ridge;
    const i00 = d * f - e * e, i01 = c * e - b * f, i02 = b * e - c * d;
    const det = a * i00 + b * i01 + c * i02;
    const k = 1 / det;
    body._inv.set([i00 * k, i01 * k, i02 * k, (a * f - c * c) * k, (b * c - a * e) * k, (a * d - b * b) * k]);
    // every particle collides, so a body pressed into another meets solid filling instead of a hollow shell;
    // interior particles (all 6 lattice neighbours present) are flagged so contacts with them push center-to-center
    const sp = 2 * radius, lim = (sp * 1.2) ** 2;
    body._inner = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let nbrs = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = q[j * 3] - q[i * 3], dy = q[j * 3 + 1] - q[i * 3 + 1], dz = q[j * 3 + 2] - q[i * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < lim) nbrs++;
      }
      body._inner[i] = nbrs >= 6 ? 1 : 0;
    }
    this._place(body, position, yaw, velocity);
    this.bodies.push(body);
    return body;
  }

  removeBody(body) {
    const i = this.bodies.indexOf(body);
    if (i < 0) return;
    if (this._grab && this._grab.body === body) this._grab = null;
    this.bodies.splice(i, 1);
  }

  // Put the body at its rest shape (rotated by yaw) at `pos` with uniform velocity `vel`.
  _place(body, pos, yaw, vel) {
    const { n, rest, pos: p, vel: v } = body;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const vx = vel.x, vy = vel.y, vz = vel.z;
    for (let i = 0; i < n * 3; i += 3) {
      const x = rest[i], y = rest[i + 1], z = rest[i + 2];
      p[i] = pos.x + c * x + s * z; p[i + 1] = pos.y + y; p[i + 2] = pos.z - s * x + c * z;
      v[i] = vx; v[i + 1] = vy; v[i + 2] = vz;
    }
    body._old.set(p);
    body._q[0] = 0; body._q[1] = Math.sin(yaw * 0.5); body._q[2] = 0; body._q[3] = Math.cos(yaw * 0.5);
    const re = body.R.elements, me = body.M.elements, S = body.restScale;
    re[0] = c; re[1] = 0; re[2] = -s; re[3] = 0; re[4] = 1; re[5] = 0; re[6] = s; re[7] = 0; re[8] = c;
    for (let j = 0; j < 3; j++) {
      const sc = j === 0 ? S.x : j === 1 ? S.y : S.z;
      for (let r = 0; r < 3; r++) me[j * 3 + r] = re[j * 3 + r] * sc;
    }
    body.center.set(pos.x, pos.y, pos.z);
    body.velocity.set(vx, vy, vz);
    body.impact = 0; body.grounded = false;
  }

  // Public: release any grab on the body, reset its scale, and put it at rest shape at `position`.
  place(body, position, yaw = 0, velocity = { x: 0, y: 0, z: 0 }) {
    if (this._grab && this._grab.body === body) this._grab = null;
    body.restScale.set(1, 1, 1);
    this._place(body, position, yaw, velocity);
  }

  _resetBody(body) {
    this.place(body, { x: 0, y: 2.5, z: 0 });
  }

  step(dt) {
    dt = Math.min(dt, 1 / 30);
    const bodies = this.bodies, nb = bodies.length;
    if (!(dt > 0) || nb === 0) return;
    const S = this.substeps, h = dt / S;
    this._ensureStats(nb);
    let maxR = 0;
    for (let bi = 0; bi < nb; bi++) {
      const b = bodies[bi];
      b._i = bi; b._cool -= dt;
      this._posArrs[bi] = b.pos; this._oldArrs[bi] = b._old; this._innerArrs[bi] = b._inner; this._cenArrs[bi] = b.center;
      this._rad[bi] = b.radius; if (b.radius > maxR) maxR = b.radius;
      this._ks[bi] = 1 - Math.pow(1 - b.stiffness, 1 / S);  // per-substep stiffness
      this._impMax[bi] = 0;
    }
    this._cellInv = 1 / (2 * maxR);
    this._ff = Math.min(0.9, this.friction * 0.25);         // tangential damping per contact per substep
    const g = this.gravity, gxh = g.x * h, gyh = g.y * h, gzh = g.z * h;

    for (let s = 0; s < S; s++) {
      // integrate
      for (let bi = 0; bi < nb; bi++) {
        const b = bodies[bi], p = b.pos, v = b.vel, o = b._old, n3 = b.n * 3;
        for (let i = 0; i < n3; i += 3) {
          v[i] += gxh; v[i + 1] += gyh; v[i + 2] += gzh;
          const x = p[i], y = p[i + 1], z = p[i + 2];
          o[i] = x; o[i + 1] = y; o[i + 2] = z;
          p[i] = x + v[i] * h; p[i + 1] = y + v[i + 1] * h; p[i + 2] = z + v[i + 2] * h;
        }
      }
      this._applyGrab();
      for (let bi = 0; bi < nb; bi++) this._shapeMatch(bodies[bi], this._ks[bi]);

      this._impSum.fill(0); this._impCnt.fill(0); this._floorCnt.fill(0);
      for (let it = 0; it < COLLISION_ITERS; it++) {
        const stats = it === 0;
        if (nb > 1) {
          if (stats) this._buildHash();
          this._collide(h, stats);
        }
        for (let bi = 0; bi < nb; bi++) this._bounds(bodies[bi], bi, h, stats);
      }

      // velocities from position change; reset bodies that blew up
      for (let bi = 0; bi < nb; bi++) {
        const b = bodies[bi];
        if (!this._updateVel(b, h)) this._resetBody(b);
        // contact speed of this substep: mean inward speed over contacting particles (>= 3 to ignore jiggle)
        if (this._impCnt[bi] >= 3) {
          const sp = this._impSum[bi] / this._impCnt[bi];
          if (sp > this._impMax[bi]) this._impMax[bi] = sp;
        }
        b.grounded = this._floorCnt[bi] > 0;
      }
    }

    // averages, impact decay, callbacks
    const decay = Math.exp(-dt * 3);
    this._fireB.length = 0; this._fireS.length = 0;
    for (let bi = 0; bi < nb; bi++) {
      const b = bodies[bi], p = b.pos, v = b.vel, n3 = b.n * 3;
      let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
      for (let i = 0; i < n3; i += 3) {
        cx += p[i]; cy += p[i + 1]; cz += p[i + 2];
        vx += v[i]; vy += v[i + 1]; vz += v[i + 2];
      }
      const rn = 1 / b.n;
      b.center.set(cx * rn, cy * rn, cz * rn);
      b.velocity.set(vx * rn, vy * rn, vz * rn);
      const m = this._impMax[bi];
      b.impact *= decay;
      if (m > b.impact) b.impact = m;
      if (m > IMPACT_MIN && b._cool <= 0) {
        b._cool = IMPACT_COOLDOWN;
        this._fireB.push(b); this._fireS.push(m);
      }
    }
    if (this.onImpact) for (let i = 0; i < this._fireB.length; i++) this.onImpact(this._fireB[i], this._fireS[i]);
  }

  _ensureStats(nb) {
    if (this._sCap >= nb) return;
    const cap = Math.max(nb, 32);
    this._sCap = cap;
    this._impSum = new Float32Array(cap); this._impCnt = new Int32Array(cap);
    this._impMax = new Float32Array(cap); this._floorCnt = new Int32Array(cap);
    this._rad = new Float32Array(cap); this._ks = new Float64Array(cap);
  }

  // Grabbed particle and its neighbours are pulled toward target + R * (offset at grab time).
  _applyGrab() {
    const g = this._grab;
    if (!g) return;
    const b = g.body, p = b.pos, e = b.R.elements, t = g.target;
    const e0 = e[0], e1 = e[1], e2 = e[2], e3 = e[3], e4 = e[4], e5 = e[5], e6 = e[6], e7 = e[7], e8 = e[8];
    const off = g.off, ids = g.ids, w = g.w, max2 = GRAB_STEP * GRAB_STEP;
    for (let k = 0; k < g.count; k++) {
      const j = ids[k] * 3, ox = off[k * 3], oy = off[k * 3 + 1], oz = off[k * 3 + 2];
      const f = GRAB_PULL * w[k];
      let dx = (t.x + e0 * ox + e3 * oy + e6 * oz - p[j]) * f;
      let dy = (t.y + e1 * ox + e4 * oy + e7 * oz - p[j + 1]) * f;
      let dz = (t.z + e2 * ox + e5 * oy + e8 * oz - p[j + 2]) * f;
      const l2 = dx * dx + dy * dy + dz * dz;
      if (l2 > max2) { const s = GRAB_STEP / Math.sqrt(l2); dx *= s; dy *= s; dz *= s; }
      p[j] += dx; p[j + 1] += dy; p[j + 2] += dz;
    }
  }

  _shapeMatch(b, ks) {
    const n = b.n, n3 = n * 3, p = b.pos, q = b.rest, inv = b._inv, S = b.restScale, Q = b._q;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n3; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
    const rn = 1 / n; cx *= rn; cy *= rn; cz *= rn;

    // Apq = sum (p-c) q^T  (row-major in Aq)
    let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
    for (let i = 0; i < n3; i += 3) {
      const x = p[i] - cx, y = p[i + 1] - cy, z = p[i + 2] - cz, qx = q[i], qy = q[i + 1], qz = q[i + 2];
      a00 += x * qx; a01 += x * qy; a02 += x * qz;
      a10 += y * qx; a11 += y * qy; a12 += y * qz;
      a20 += z * qx; a21 += z * qy; a22 += z * qz;
    }
    // A = Apq * Aqq^-1 * diag(1/restScale): the transform relative to the scaled rest shape
    const i00 = inv[0], i01 = inv[1], i02 = inv[2], i11 = inv[3], i12 = inv[4], i22 = inv[5];
    const sx = 1 / Math.max(S.x, 0.2), sy = 1 / Math.max(S.y, 0.2), sz = 1 / Math.max(S.z, 0.2);
    const A = Aq;
    A[0] = (a00 * i00 + a01 * i01 + a02 * i02) * sx; A[1] = (a00 * i01 + a01 * i11 + a02 * i12) * sy; A[2] = (a00 * i02 + a01 * i12 + a02 * i22) * sz;
    A[3] = (a10 * i00 + a11 * i01 + a12 * i02) * sx; A[4] = (a10 * i01 + a11 * i11 + a12 * i12) * sy; A[5] = (a10 * i02 + a11 * i12 + a12 * i22) * sz;
    A[6] = (a20 * i00 + a21 * i01 + a22 * i02) * sx; A[7] = (a20 * i01 + a21 * i11 + a22 * i12) * sy; A[8] = (a20 * i02 + a21 * i12 + a22 * i22) * sz;
    const A0 = A[0], A1 = A[1], A2 = A[2], A3 = A[3], A4 = A[4], A5 = A[5], A6 = A[6], A7 = A[7], A8 = A[8];

    // Rotation extraction (Müller 2016), warm-started from the previous quaternion
    let qx = Q[0], qy = Q[1], qz = Q[2], qw = Q[3];
    let r00, r01, r02, r10, r11, r12, r20, r21, r22;
    for (let it = 0; it < 4; it++) {
      const xx = qx * qx, yy = qy * qy, zz = qz * qz;
      r00 = 1 - 2 * (yy + zz); r01 = 2 * (qx * qy - qz * qw); r02 = 2 * (qx * qz + qy * qw);
      r10 = 2 * (qx * qy + qz * qw); r11 = 1 - 2 * (xx + zz); r12 = 2 * (qy * qz - qx * qw);
      r20 = 2 * (qx * qz - qy * qw); r21 = 2 * (qy * qz + qx * qw); r22 = 1 - 2 * (xx + yy);
      // omega = sum_j R_j x A_j / |sum_j R_j . A_j|
      let ox = (r10 * A6 - r20 * A3) + (r11 * A7 - r21 * A4) + (r12 * A8 - r22 * A5);
      let oy = (r20 * A0 - r00 * A6) + (r21 * A1 - r01 * A7) + (r22 * A2 - r02 * A8);
      let oz = (r00 * A3 - r10 * A0) + (r01 * A4 - r11 * A1) + (r02 * A5 - r12 * A2);
      const dn = Math.abs(r00 * A0 + r10 * A3 + r20 * A6 + r01 * A1 + r11 * A4 + r21 * A7 + r02 * A2 + r12 * A5 + r22 * A8) + 1e-9;
      ox /= dn; oy /= dn; oz /= dn;
      const w = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (w < 1e-9) break;
      const sn = Math.sin(w * 0.5) / w, dx = ox * sn, dy = oy * sn, dz = oz * sn, dw = Math.cos(w * 0.5);
      const nw = dw * qw - dx * qx - dy * qy - dz * qz;
      const nx = dw * qx + dx * qw + dy * qz - dz * qy;
      const ny = dw * qy - dx * qz + dy * qw + dz * qx;
      const nz = dw * qz + dx * qy - dy * qx + dz * qw;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
      qx = nx * il; qy = ny * il; qz = nz * il; qw = nw * il;
    }
    Q[0] = qx; Q[1] = qy; Q[2] = qz; Q[3] = qw;
    {
      const xx = qx * qx, yy = qy * qy, zz = qz * qz;
      r00 = 1 - 2 * (yy + zz); r01 = 2 * (qx * qy - qz * qw); r02 = 2 * (qx * qz + qy * qw);
      r10 = 2 * (qx * qy + qz * qw); r11 = 1 - 2 * (xx + zz); r12 = 2 * (qy * qz - qx * qw);
      r20 = 2 * (qx * qz - qy * qw); r21 = 2 * (qy * qz + qx * qw); r22 = 1 - 2 * (xx + yy);
    }

    // volume-normalised A (falls back to R when degenerate or inverted)
    const det = A0 * (A4 * A8 - A5 * A7) - A1 * (A3 * A8 - A5 * A6) + A2 * (A3 * A7 - A4 * A6);
    let n00, n01, n02, n10, n11, n12, n20, n21, n22;
    if (det > 1e-6) {
      const f = 1 / Math.cbrt(det);
      n00 = A0 * f; n01 = A1 * f; n02 = A2 * f; n10 = A3 * f; n11 = A4 * f; n12 = A5 * f; n20 = A6 * f; n21 = A7 * f; n22 = A8 * f;
    } else {
      n00 = r00; n01 = r01; n02 = r02; n10 = r10; n11 = r11; n12 = r12; n20 = r20; n21 = r21; n22 = r22;
    }
    // M = (beta*A + (1-beta)*R) * diag(restScale)
    const be = b.beta, ib = 1 - be, ssx = Math.max(S.x, 0.2), ssy = Math.max(S.y, 0.2), ssz = Math.max(S.z, 0.2);
    const m00 = (be * n00 + ib * r00) * ssx, m01 = (be * n01 + ib * r01) * ssy, m02 = (be * n02 + ib * r02) * ssz;
    const m10 = (be * n10 + ib * r10) * ssx, m11 = (be * n11 + ib * r11) * ssy, m12 = (be * n12 + ib * r12) * ssz;
    const m20 = (be * n20 + ib * r20) * ssx, m21 = (be * n21 + ib * r21) * ssy, m22 = (be * n22 + ib * r22) * ssz;

    const me = b.M.elements, re = b.R.elements;   // column-major
    me[0] = m00; me[1] = m10; me[2] = m20; me[3] = m01; me[4] = m11; me[5] = m21; me[6] = m02; me[7] = m12; me[8] = m22;
    re[0] = r00; re[1] = r10; re[2] = r20; re[3] = r01; re[4] = r11; re[5] = r21; re[6] = r02; re[7] = r12; re[8] = r22;
    b.center.set(cx, cy, cz);

    // pull toward goals c + M q
    for (let i = 0; i < n3; i += 3) {
      const qx_ = q[i], qy_ = q[i + 1], qz_ = q[i + 2];
      p[i] += ks * (cx + m00 * qx_ + m01 * qy_ + m02 * qz_ - p[i]);
      p[i + 1] += ks * (cy + m10 * qx_ + m11 * qy_ + m12 * qz_ - p[i + 1]);
      p[i + 2] += ks * (cz + m20 * qx_ + m21 * qy_ + m22 * qz_ - p[i + 2]);
    }
  }

  // v = (p - x)/h * damping, speed-capped. Returns false if the body left the valid range / went NaN.
  _updateVel(b, h) {
    const p = b.pos, o = b._old, v = b.vel, n3 = b.n * 3, ih = 1 / h, d = b.damping;
    const max2 = MAX_SPEED * MAX_SPEED;
    for (let i = 0; i < n3; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (!(x > -20 && x < 20 && z > -20 && z < 20 && y > -30 && y < 60)) return false;
      let vx = (x - o[i]) * ih * d, vy = (y - o[i + 1]) * ih * d, vz = (z - o[i + 2]) * ih * d;
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > max2) { const s = MAX_SPEED / Math.sqrt(s2); vx *= s; vy *= s; vz *= s; }
      v[i] = vx; v[i + 1] = vy; v[i + 2] = vz;
    }
    return true;
  }

  // Floor inside the footprint and four solid walls of thickness wallThickness, with tangential damping as friction.
  // Bodies can rest on and slide over the rim top and fall off the table edge; outside the footprint there is no floor.
  _bounds(b, bi, h, stats) {
    const p = b.pos, o = b._old, n3 = b.n * 3, r = b.radius, ff = this._ff, ih = 1 / h;
    const hX = this.halfX, hZ = this.halfZ;
    const minX = -hX + r, maxX = hX - r, minZ = -hZ + r, maxZ = hZ - r, minY = this.floorY + r;
    const T = this.wallThickness, outX = hX + T + r, outZ = hZ + T + r, midX = hX + T / 2, midZ = hZ + T / 2, top = this.floorY + this.wallHeight + r;
    let sum = 0, cnt = 0, fl = 0;
    for (let i = 0; i < n3; i += 3) {
      let x = p[i], y = p[i + 1], z = p[i + 2];
      const ox = o[i], oz = o[i + 2];
      if (y < minY && x >= -hX && x <= hX && z >= -hZ && z <= hZ) {
        const v = (y - o[i + 1]) * ih;
        if (stats) { fl++; if (v < -0.5) { sum -= v; cnt++; } }
        y = minY; x -= (x - ox) * ff; z -= (z - oz) * ff;
      }
      // 墙是厚 T 的实心块：墙顶朝筐里斜，从上面落下的粒子顺着滑回筐里；从侧面进墙的粒子推回它进来的那一面
      if (y < top + RIM_SLOPE * (T + 2 * r)) {
        const ax = Math.abs(x);
        if (ax > maxX && ax < outX && Math.abs(z) < outZ) {
          const s = x < 0 ? -1 : 1, oy = o[i + 1];
          if (oy >= top + RIM_SLOPE * Math.max(0, Math.abs(ox) - maxX) - WALL_EPS) { y = Math.max(y, top + RIM_SLOPE * (ax - maxX)); x -= (x - ox) * ff; z -= (z - oz) * ff; }
          else {
            const v = (x - ox) * ih * -s;
            if (stats && v < -0.5) { sum -= v; cnt++; }
            x = Math.abs(ox) < midX ? s * maxX : s * outX; y -= (y - oy) * ff; z -= (z - oz) * ff;
          }
        }
        const az = Math.abs(z);
        if (az > maxZ && az < outZ && Math.abs(x) < outX) {
          const s = z < 0 ? -1 : 1, oy = o[i + 1];
          if (oy >= top + RIM_SLOPE * Math.max(0, Math.abs(oz) - maxZ) - WALL_EPS) { y = Math.max(y, top + RIM_SLOPE * (az - maxZ)); x -= (x - ox) * ff; z -= (z - oz) * ff; }
          else {
            const v = (z - oz) * ih * -s;
            if (stats && v < -0.5) { sum -= v; cnt++; }
            z = Math.abs(oz) < midZ ? s * maxZ : s * outZ; y -= (y - oy) * ff; x -= (x - ox) * ff;
          }
        }
      }
      if (y < minY && x >= -hX && x <= hX && z >= -hZ && z <= hZ) y = minY;
      p[i] = x; p[i + 1] = y; p[i + 2] = z;
    }
    if (stats) { this._impSum[bi] += sum; this._impCnt[bi] += cnt; this._floorCnt[bi] += fl; }
  }

  // Counting-sort spatial hash over every particle of every body (cell = 2 * max radius).
  _buildHash() {
    const bodies = this.bodies, nb = bodies.length;
    let N = 0;
    for (let bi = 0; bi < nb; bi++) N += bodies[bi].n;
    if (N > this._rCap) {
      const cap = nextPow2(N), t = Math.max(16384, nextPow2(cap * 16));
      this._rCap = cap; this._tSize = t;
      this._refBody = new Int32Array(cap); this._refIdx = new Int32Array(cap);
      this._refKey = new Int32Array(cap); this._sorted = new Int32Array(cap);
      this._cellStart = new Int32Array(t + 1); this._fillPos = new Int32Array(t);
    }
    const T = this._tSize, mask = T - 1, inv = this._cellInv;
    const refBody = this._refBody, refIdx = this._refIdx, refKey = this._refKey, sorted = this._sorted;
    const cellStart = this._cellStart, fillPos = this._fillPos;
    cellStart.fill(0);
    // broadphase: body AABBs grown by one contact distance; a particle enters the hash only
    // if it lies inside some other body's box
    if (!this._box || this._box.length < nb * 6) this._box = new Float32Array(nb * 6);
    const box = this._box, pad = 2 / inv;
    for (let bi = 0; bi < nb; bi++) {
      const p = bodies[bi].pos, n3 = bodies[bi].n * 3;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < n3; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      box.set([x0 - pad, y0 - pad, z0 - pad, x1 + pad, y1 + pad, z1 + pad], bi * 6);
    }
    let k = 0;
    for (let bi = 0; bi < nb; bi++) {
      const b = bodies[bi], p = b.pos;
      // other bodies whose box overlaps ours
      const near = this._near ?? (this._near = []);
      near.length = 0;
      for (let bj = 0; bj < nb; bj++) {
        if (bj === bi) continue;
        if (box[bj * 6] > box[bi * 6 + 3] || box[bj * 6 + 3] < box[bi * 6] ||
            box[bj * 6 + 1] > box[bi * 6 + 4] || box[bj * 6 + 4] < box[bi * 6 + 1] ||
            box[bj * 6 + 2] > box[bi * 6 + 5] || box[bj * 6 + 5] < box[bi * 6 + 2]) continue;
        near.push(bj * 6);
      }
      if (!near.length) continue;
      for (let i = 0; i < b.n; i++) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        let inside = false;
        for (let m = 0; m < near.length; m++) {
          const o = near[m];
          if (x >= box[o] && x <= box[o + 3] && y >= box[o + 1] && y <= box[o + 4] && z >= box[o + 2] && z <= box[o + 5]) { inside = true; break; }
        }
        if (!inside) continue;
        const key = (Math.imul(Math.floor(p[i * 3] * inv), 73856093) ^
                     Math.imul(Math.floor(p[i * 3 + 1] * inv), 19349663) ^
                     Math.imul(Math.floor(p[i * 3 + 2] * inv), 83492791)) & mask;
        refBody[k] = bi; refIdx[k] = i; refKey[k] = key;
        cellStart[key + 1]++;
        k++;
      }
    }
    for (let t = 0; t < T; t++) cellStart[t + 1] += cellStart[t];
    fillPos.set(cellStart.subarray(0, T));
    for (let j = 0; j < k; j++) sorted[fillPos[refKey[j]]++] = j;
    this._refCount = k;
  }

  // Push particles of different bodies apart to r_a + r_b, half each, with tangential friction.
  _collide(h, stats) {
    const N = this._refCount, mask = this._tSize - 1, inv = this._cellInv, ih = 1 / h;
    const refBody = this._refBody, refIdx = this._refIdx, sorted = this._sorted, cellStart = this._cellStart;
    const posA = this._posArrs, oldA = this._oldArrs, rad = this._rad, innerA = this._innerArrs, cenA = this._cenArrs;
    const impSum = this._impSum, impCnt = this._impCnt, ff5 = this._ff * 0.5;
    for (let k = 0; k < N; k++) {
      const bk = refBody[k], pa = posA[bk], oa = oldA[bk], ia = refIdx[k] * 3, ra = rad[bk];
      let x = pa[ia], y = pa[ia + 1], z = pa[ia + 2];
      const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
      for (let dz = -1; dz <= 1; dz++) {
        const hz = Math.imul(cz + dz, 83492791);
        for (let dy = -1; dy <= 1; dy++) {
          const hy = Math.imul(cy + dy, 19349663) ^ hz;
          for (let dx = -1; dx <= 1; dx++) {
            const key = (Math.imul(cx + dx, 73856093) ^ hy) & mask;
            const end = cellStart[key + 1];
            for (let s = cellStart[key]; s < end; s++) {
              const m = sorted[s];
              if (m <= k) continue;
              const bm = refBody[m];
              if (bm === bk) continue;
              const pb = posA[bm], ib = refIdx[m] * 3;
              let ex = x - pb[ib], ey = y - pb[ib + 1], ez = z - pb[ib + 2];
              const sr = ra + rad[bm], d2 = ex * ex + ey * ey + ez * ez;
              if (d2 >= sr * sr) continue;
              const dist = Math.sqrt(d2);
              let nx = 0, ny = 1, nz = 0;
              if (innerA[bk][refIdx[k]] || innerA[bm][refIdx[m]]) {
                // already past the other body's skin: the particle pair's direction is noise, push the bodies apart
                const ca = cenA[bk], cb = cenA[bm];
                const gx = ca.x - cb.x, gy = ca.y - cb.y, gz = ca.z - cb.z, gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
                if (gl > 1e-6) { nx = gx / gl; ny = gy / gl; nz = gz / gl; }
              } else if (dist > 1e-6) { const id = 1 / dist; nx = ex * id; ny = ey * id; nz = ez * id; }
              const ob = oldA[bm];
              if (stats) {
                const vrel = ((x - oa[ia] - pb[ib] + ob[ib]) * nx + (y - oa[ia + 1] - pb[ib + 1] + ob[ib + 1]) * ny +
                              (z - oa[ia + 2] - pb[ib + 2] + ob[ib + 2]) * nz) * ih;
                if (vrel < -0.5) { impSum[bk] -= vrel; impCnt[bk]++; impSum[bm] -= vrel; impCnt[bm]++; }
              }
              const hp = 0.5 * (sr - dist);
              x += nx * hp; y += ny * hp; z += nz * hp;
              pb[ib] -= nx * hp; pb[ib + 1] -= ny * hp; pb[ib + 2] -= nz * hp;
              // friction: remove part of the relative tangential displacement this substep
              const rx = x - oa[ia] - pb[ib] + ob[ib], ry = y - oa[ia + 1] - pb[ib + 1] + ob[ib + 1], rz = z - oa[ia + 2] - pb[ib + 2] + ob[ib + 2];
              const rn = rx * nx + ry * ny + rz * nz;
              const tx = (rx - rn * nx) * ff5, ty = (ry - rn * ny) * ff5, tz = (rz - rn * nz) * ff5;
              x -= tx; y -= ty; z -= tz;
              pb[ib] += tx; pb[ib + 1] += ty; pb[ib + 2] += tz;
            }
          }
        }
      }
      pa[ia] = x; pa[ia + 1] = y; pa[ia + 2] = z;
    }
  }

  // Ray (THREE.Vector3s) vs particle spheres of radius*1.5.
  pick(origin, dir) {
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    let best = Infinity, bb = null, bi = -1;
    for (const b of this.bodies) {
      const p = b.pos, R = b.radius * 1.5, R2 = R * R;
      for (let i = 0; i < b.n; i++) {
        const ox = p[i * 3] - origin.x, oy = p[i * 3 + 1] - origin.y, oz = p[i * 3 + 2] - origin.z;
        const t = ox * dx + oy * dy + oz * dz;
        if (t < -R) continue;
        const d2 = ox * ox + oy * oy + oz * oz - t * t;
        if (d2 > R2) continue;
        const th = Math.max(0, t - Math.sqrt(R2 - d2));
        if (th < best) { best = th; bb = b; bi = i; }
      }
    }
    if (!bb) return null;
    return { body: bb, index: bi, distance: best,
             point: new THREE.Vector3(origin.x + dx * best, origin.y + dy * best, origin.z + dz * best) };
  }

  grab(body, index, target) {
    this.release();
    const p = body.pos, e = body.R.elements, gi = index * 3;
    const gx = p[gi], gy = p[gi + 1], gz = p[gi + 2];
    const dmax = GRAB_RADIUS * 2 * body.radius, dmax2 = dmax * dmax;
    const ids = [], w = [], off = [];
    for (let j = 0; j < body.n; j++) {
      const dx = p[j * 3] - gx, dy = p[j * 3 + 1] - gy, dz = p[j * 3 + 2] - gz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= dmax2) continue;
      const t = 1 - Math.sqrt(d2) / dmax;
      ids.push(j); w.push(t * t * (3 - 2 * t));
      // offset in the body frame: R^T * d
      off.push(e[0] * dx + e[1] * dy + e[2] * dz, e[3] * dx + e[4] * dy + e[5] * dz, e[6] * dx + e[7] * dy + e[8] * dz);
    }
    this._grab = { body, target: target.clone(), count: ids.length,
                   ids: Int32Array.from(ids), w: Float32Array.from(w), off: Float32Array.from(off) };
  }

  moveGrab(target) {
    if (this._grab) this._grab.target.copy(target);
  }

  release() {
    const g = this._grab;
    if (!g) return;
    this._grab = null;
    const v = g.body.vel, n3 = g.body.n * 3, max2 = THROW_SPEED * THROW_SPEED;
    for (let i = 0; i < n3; i += 3) {
      const s2 = v[i] * v[i] + v[i + 1] * v[i + 1] + v[i + 2] * v[i + 2];
      if (s2 > max2) { const s = THROW_SPEED / Math.sqrt(s2); v[i] *= s; v[i + 1] *= s; v[i + 2] *= s; }
    }
  }

  poke(body, point, dir, strength) {
    const p = body.pos, v = body.vel, R = 0.45;
    for (let i = 0; i < body.n * 3; i += 3) {
      const dx = p[i] - point.x, dy = p[i + 1] - point.y, dz = p[i + 2] - point.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= R) continue;
      const t = 1 - d / R, f = t * t * (3 - 2 * t) * strength;
      v[i] += dir.x * f; v[i + 1] += dir.y * f; v[i + 2] += dir.z * f;
    }
  }

  shake(dv) {
    const rs = 0.3 * Math.sqrt(dv.x * dv.x + dv.y * dv.y + dv.z * dv.z);
    for (const b of this.bodies) {
      const rx = (Math.random() - 0.5) * rs, ry = Math.random() * rs * 0.5, rz = (Math.random() - 0.5) * rs;
      const v = b.vel;
      for (let i = 0; i < b.n * 3; i += 3) { v[i] += dv.x + rx; v[i + 1] += dv.y + ry; v[i + 2] += dv.z + rz; }
    }
  }
}
