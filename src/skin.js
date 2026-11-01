import * as THREE from 'three';

const K = 4;

// For each point: 4 nearest rest particles, weights ~ 1/(d+0.02)^2 (normalised),
// and the weighted offset O = sum w_k (p0 - q_k), so that p = sum w_k x_k + M * O.
function bind(rest, n, pts, count) {
  const idx = new Uint16Array(count * K), w = new Float32Array(count * K), off = new Float32Array(count * 3);
  const bi = new Int32Array(K), bd = new Float64Array(K);
  for (let v = 0; v < count; v++) {
    const px = pts[v * 3], py = pts[v * 3 + 1], pz = pts[v * 3 + 2];
    bd.fill(Infinity); bi.fill(0);
    for (let j = 0; j < n; j++) {
      const dx = px - rest[j * 3], dy = py - rest[j * 3 + 1], dz = pz - rest[j * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= bd[K - 1]) continue;
      let s = K - 1;                        // insertion into the sorted top-K
      while (s > 0 && bd[s - 1] > d2) { bd[s] = bd[s - 1]; bi[s] = bi[s - 1]; s--; }
      bd[s] = d2; bi[s] = j;
    }
    let sum = 0, ox = 0, oy = 0, oz = 0;
    const ws = [0, 0, 0, 0];
    for (let k = 0; k < K; k++) {
      if (bd[k] === Infinity) { bi[k] = bi[0]; bd[k] = bd[0]; }
      const d = Math.sqrt(bd[k]) + 0.02;
      ws[k] = 1 / (d * d); sum += ws[k];
    }
    for (let k = 0; k < K; k++) {
      const j = bi[k], wk = ws[k] / sum;
      idx[v * K + k] = j; w[v * K + k] = wk;
      ox += wk * (px - rest[j * 3]); oy += wk * (py - rest[j * 3 + 1]); oz += wk * (pz - rest[j * 3 + 2]);
    }
    off[v * 3] = ox; off[v * 3 + 1] = oy; off[v * 3 + 2] = oz;
  }
  return { idx, w, off };
}

export function createSkin(body, geometry, anchors) {
  const posAttr = geometry.attributes.position;
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const out = posAttr.array, vcount = posAttr.count;
  const rest = body.rest, n = body.n;

  const vb = bind(rest, n, Float32Array.from(out), vcount);

  // fast normals: area-weighted face normals accumulated on typed arrays (three's generic version is ~5x slower)
  const index = geometry.index.array;
  if (!geometry.attributes.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
  const nAttr = geometry.attributes.normal;
  nAttr.setUsage(THREE.DynamicDrawUsage);
  const nor = nAttr.array;
  let r2 = 0;
  for (let i = 0; i < vcount * 3; i += 3) r2 = Math.max(r2, out[i] ** 2 + out[i + 1] ** 2 + out[i + 2] ** 2);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.sqrt(r2) * 2);

  const ak = anchors.length;
  const apos = new Float32Array(ak * 3), anor0 = new Float32Array(ak * 3);
  for (let i = 0; i < ak; i++) {
    apos.set(anchors[i].pos, i * 3); anor0.set(anchors[i].normal, i * 3);
  }
  const ab = bind(rest, n, apos, ak);
  const anchorPos = new Float32Array(ak * 3), anchorNormal = new Float32Array(ak * 3);

  function update() {
    const x = body.pos, m = body.M.elements;
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];

    const { idx, w, off } = vb;
    for (let v = 0; v < vcount; v++) {
      const b = v * K, i0 = idx[b] * 3, i1 = idx[b + 1] * 3, i2 = idx[b + 2] * 3, i3 = idx[b + 3] * 3;
      const w0 = w[b], w1 = w[b + 1], w2 = w[b + 2], w3 = w[b + 3];
      const ox = off[v * 3], oy = off[v * 3 + 1], oz = off[v * 3 + 2];
      out[v * 3] = w0 * x[i0] + w1 * x[i1] + w2 * x[i2] + w3 * x[i3] + m0 * ox + m3 * oy + m6 * oz;
      out[v * 3 + 1] = w0 * x[i0 + 1] + w1 * x[i1 + 1] + w2 * x[i2 + 1] + w3 * x[i3 + 1] + m1 * ox + m4 * oy + m7 * oz;
      out[v * 3 + 2] = w0 * x[i0 + 2] + w1 * x[i1 + 2] + w2 * x[i2 + 2] + w3 * x[i3 + 2] + m2 * ox + m5 * oy + m8 * oz;
    }
    posAttr.needsUpdate = true;
    nor.fill(0);
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const ux = out[b] - out[a], uy = out[b + 1] - out[a + 1], uz = out[b + 2] - out[a + 2];
      const vx = out[c] - out[a], vy = out[c + 1] - out[a + 1], vz = out[c + 2] - out[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nor[a] += nx; nor[a + 1] += ny; nor[a + 2] += nz;
      nor[b] += nx; nor[b + 1] += ny; nor[b + 2] += nz;
      nor[c] += nx; nor[c + 1] += ny; nor[c + 2] += nz;
    }
    for (let i = 0; i < vcount * 3; i += 3) {
      const l = 1 / (Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1);
      nor[i] *= l; nor[i + 1] *= l; nor[i + 2] *= l;
    }
    nAttr.needsUpdate = true;
    geometry.boundingSphere.center.copy(body.center);

    // anchors: same blend; normals use the inverse transpose of M (= cofactor matrix / det)
    const c00 = m4 * m8 - m7 * m5, c01 = m7 * m2 - m1 * m8, c02 = m1 * m5 - m4 * m2;
    const c10 = m6 * m5 - m3 * m8, c11 = m0 * m8 - m6 * m2, c12 = m3 * m2 - m0 * m5;
    const c20 = m3 * m7 - m6 * m4, c21 = m6 * m1 - m0 * m7, c22 = m0 * m4 - m3 * m1;
    const sgn = (m0 * c00 + m3 * c01 + m6 * c02) < 0 ? -1 : 1;
    const { idx: ai, w: aw, off: ao } = ab;
    for (let a = 0; a < ak; a++) {
      const b = a * K, i0 = ai[b] * 3, i1 = ai[b + 1] * 3, i2 = ai[b + 2] * 3, i3 = ai[b + 3] * 3;
      const w0 = aw[b], w1 = aw[b + 1], w2 = aw[b + 2], w3 = aw[b + 3];
      const ox = ao[a * 3], oy = ao[a * 3 + 1], oz = ao[a * 3 + 2];
      anchorPos[a * 3] = w0 * x[i0] + w1 * x[i1] + w2 * x[i2] + w3 * x[i3] + m0 * ox + m3 * oy + m6 * oz;
      anchorPos[a * 3 + 1] = w0 * x[i0 + 1] + w1 * x[i1 + 1] + w2 * x[i2 + 1] + w3 * x[i3 + 1] + m1 * ox + m4 * oy + m7 * oz;
      anchorPos[a * 3 + 2] = w0 * x[i0 + 2] + w1 * x[i1 + 2] + w2 * x[i2 + 2] + w3 * x[i3 + 2] + m2 * ox + m5 * oy + m8 * oz;
      const nx0 = anor0[a * 3], ny0 = anor0[a * 3 + 1], nz0 = anor0[a * 3 + 2];
      let nx = sgn * (c00 * nx0 + c01 * ny0 + c02 * nz0);
      let ny = sgn * (c10 * nx0 + c11 * ny0 + c12 * nz0);
      let nz = sgn * (c20 * nx0 + c21 * ny0 + c22 * nz0);
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l > 1e-8) { nx /= l; ny /= l; nz /= l; } else { nx = nx0; ny = ny0; nz = nz0; }
      anchorNormal[a * 3] = nx; anchorNormal[a * 3 + 1] = ny; anchorNormal[a * 3 + 2] = nz;
    }
  }

  update();
  return { update, anchorPos, anchorNormal };
}
