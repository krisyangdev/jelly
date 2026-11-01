import * as THREE from 'three';

// 抚摸：每个顶点存一个世界空间的倒伏向量（长度 0..1），绒毛壳读它顺着手势躺倒，之后慢慢蓬回来。

const GAIN = 1 / 0.08; // 手移动 0.08 就刷满
const DECAY = 1.3; // 每秒衰减率，约 2 秒蓬回
const EPS = 0.01;

export function createComb(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const attr = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('comb', attr);
  const comb = attr.array;
  let active = false;

  function brush(point, delta, radius = 0.22) {
    const pos = position.array;
    const nor = normal.array;
    const r2 = radius * radius;
    for (let i = 0, n = position.count; i < n; i++) {
      const k = i * 3;
      const dx = pos[k] - point.x;
      const dy = pos[k + 1] - point.y;
      const dz = pos[k + 2] - point.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;

      // 去掉沿法线的分量，只留贴着表面的部分
      const nx = nor[k], ny = nor[k + 1], nz = nor[k + 2];
      const dn = delta.x * nx + delta.y * ny + delta.z * nz;
      const t = Math.sqrt(d2) / radius;
      const s = (1 - t * t * (3 - 2 * t)) * GAIN;
      let cx = comb[k] + (delta.x - dn * nx) * s;
      let cy = comb[k + 1] + (delta.y - dn * ny) * s;
      let cz = comb[k + 2] + (delta.z - dn * nz) * s;
      const len2 = cx * cx + cy * cy + cz * cz;
      if (len2 > 1) {
        const inv = 1 / Math.sqrt(len2);
        cx *= inv; cy *= inv; cz *= inv;
      }
      comb[k] = cx; comb[k + 1] = cy; comb[k + 2] = cz;
    }
    attr.needsUpdate = true;
    active = true;
  }

  function update(dt) {
    if (!active) return;
    const f = Math.exp(-dt * DECAY);
    let max2 = 0;
    for (let k = 0, n = comb.length; k < n; k += 3) {
      const x = comb[k] * f, y = comb[k + 1] * f, z = comb[k + 2] * f;
      comb[k] = x; comb[k + 1] = y; comb[k + 2] = z;
      const l2 = x * x + y * y + z * z;
      if (l2 > max2) max2 = l2;
    }
    if (max2 < EPS * EPS) {
      comb.fill(0);
      active = false;
    }
    attr.needsUpdate = true;
  }

  return { brush, update };
}
