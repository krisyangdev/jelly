import * as THREE from 'three';

// ---------- shared atlas (premultiplied alpha so mipmaps have no dark fringes) ----------
const CELL = 256, COLS = 6, ROWS = 4;
const INK = '#1f1517', MOUTH = '#3b2326', TONGUE = '#ff8fab';
const CELLS = {
  eyeOpen: [0, 0], eyeSurprised: [1, 0], eyeSquintL: [2, 0], eyeSquintR: [3, 0], eyeHappy: [4, 0], eyeSleepy: [5, 0],
  eyeDizzy: [0, 1], hlIdle: [1, 1], hlSurprised: [2, 1], cheek: [3, 1],
  mouthHappy: [1, 2], mouthSquint: [2, 2], mouthSurprised: [3, 2], mouthDizzy: [4, 2], mouthSleepy: [5, 2],
  mouthBear: [0, 3], mouthCat: [1, 3], mouthFrog: [2, 3], mouthPig: [3, 3], cheekWL: [4, 3], cheekWR: [5, 3],
};

function stroke(g, w, color = INK) {
  g.lineWidth = w; g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
}
// 黑豆豆眼：一颗亮面的小黑珠子
function bead(g, r) {
  const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
  gr.addColorStop(0, '#3a2a2c'); gr.addColorStop(1, '#120b0c');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
}
function blushOval(g) {
  g.save(); g.scale(1, 0.62);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 70);
  gr.addColorStop(0, 'rgba(255,130,150,0.9)'); gr.addColorStop(0.5, 'rgba(255,140,160,0.5)'); gr.addColorStop(1, 'rgba(255,150,170,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 70, 0, Math.PI * 2); g.fill();
  g.restore();
}
function whiskers(g, dir) {
  g.beginPath();
  for (const a of [-0.22, 0.08]) { g.moveTo(dir * 66, -6 + a * 40); g.lineTo(dir * 118, -6 + a * 120); }
  stroke(g, 6, '#6e5a55');
}
function dot(g, x, y, r) {
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function wave(g, amp, periods, lw) {
  g.beginPath();
  for (let x = -70; x <= 70; x += 3) {
    const y = -amp * Math.sin((x / 70) * Math.PI * periods);
    x === -70 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  stroke(g, lw, MOUTH);
}
function openMouthPath(g) {
  g.beginPath(); g.moveTo(-64, -34); g.lineTo(64, -34);
  g.bezierCurveTo(60, 30, 30, 70, 0, 70); g.bezierCurveTo(-30, 70, -60, 30, -64, -34); g.closePath();
}

const PAINT = {
  eyeOpen: (g) => bead(g, 60),
  eyeSurprised: (g) => bead(g, 74),
  eyeSquintL: (g) => { g.beginPath(); g.moveTo(-48, -54); g.lineTo(42, 0); g.lineTo(-48, 54); stroke(g, 20); },
  eyeSquintR: (g) => { g.beginPath(); g.moveTo(48, -54); g.lineTo(-42, 0); g.lineTo(48, 54); stroke(g, 20); },
  eyeHappy: (g) => { g.beginPath(); g.arc(0, 30, 50, Math.PI, Math.PI * 2); stroke(g, 18); },
  eyeSleepy: (g) => { g.beginPath(); g.moveTo(-56, -6); g.quadraticCurveTo(0, 34, 56, -6); stroke(g, 16); },
  eyeDizzy: (g) => {
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const t = i / 120, a = t * Math.PI * 6.4, r = 6 + t * 84;
      i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(r, 0);
    }
    stroke(g, 14);
  },
  hlIdle: (g) => { dot(g, -20, -22, 15); dot(g, 18, 20, 6); },
  hlSurprised: (g) => { dot(g, -26, -28, 16); dot(g, 22, 26, 7); },
  cheek: blushOval,
  cheekWL: (g) => { blushOval(g); whiskers(g, -1); },
  cheekWR: (g) => { blushOval(g); whiskers(g, 1); },
  // 小熊嘴：鼻头加一个小小的「人」字
  mouthBear: (g) => {
    g.fillStyle = MOUTH; g.beginPath(); g.ellipse(0, -22, 15, 11, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 4);
    g.moveTo(-30, 16); g.quadraticCurveTo(-6, 20, 0, 4); g.quadraticCurveTo(6, 20, 30, 16);
    stroke(g, 10, MOUTH);
  },
  mouthCat: (g) => {
    g.beginPath(); g.arc(-18, -4, 18, 0, Math.PI); g.moveTo(36, -4); g.arc(18, -4, 18, 0, Math.PI);
    stroke(g, 10, MOUTH);
  },
  mouthFrog: (g) => { g.beginPath(); g.moveTo(-58, -12); g.quadraticCurveTo(0, 34, 58, -12); stroke(g, 9, MOUTH); },
  mouthPig: (g) => {
    g.fillStyle = '#e4838f';
    for (const x of [-26, 26]) { g.beginPath(); g.ellipse(x, 0, 13, 20, 0, 0, Math.PI * 2); g.fill(); }
  },
  mouthHappy: (g) => {
    g.save(); openMouthPath(g); g.clip();
    g.fillStyle = MOUTH; g.fillRect(-100, -100, 200, 200);
    g.fillStyle = TONGUE; g.beginPath(); g.ellipse(0, 64, 38, 28, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    openMouthPath(g); stroke(g, 16, MOUTH);
  },
  mouthSquint: (g) => wave(g, 13, 2, 20),
  mouthDizzy: (g) => wave(g, 22, 1, 20),
  mouthSurprised: (g) => {
    g.save(); g.beginPath(); g.ellipse(0, 0, 24, 30, 0, 0, Math.PI * 2); g.clip();
    g.fillStyle = MOUTH; g.fillRect(-40, -40, 80, 80);
    g.fillStyle = TONGUE; g.beginPath(); g.ellipse(0, 28, 16, 12, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.beginPath(); g.ellipse(0, 0, 24, 30, 0, 0, Math.PI * 2); stroke(g, 12, MOUTH);
  },
  mouthSleepy: (g) => { g.beginPath(); g.moveTo(-24, -4); g.quadraticCurveTo(0, 26, 24, -4); stroke(g, 20, MOUTH); },
};

const atlas = (() => {
  const c = document.createElement('canvas');
  c.width = CELL * COLS; c.height = CELL * ROWS;
  const g = c.getContext('2d');
  for (const [name, [col, row]] of Object.entries(CELLS)) {
    g.save();
    g.beginPath(); g.rect(col * CELL, row * CELL, CELL, CELL); g.clip();
    g.translate(col * CELL + CELL / 2, row * CELL + CELL / 2);
    PAINT[name](g);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
})();

function setCell(mesh, name) {
  const [col, row] = CELLS[name];
  const u0 = col / COLS, u1 = (col + 1) / COLS, v1 = 1 - row / ROWS, v0 = 1 - (row + 1) / ROWS;
  const uv = mesh.geometry.attributes.uv;
  uv.array.set([u0, v1, u1, v1, u0, v0, u1, v0]); // PlaneGeometry order: TL TR BL BR
  uv.needsUpdate = true;
}

// ---------- expressions ----------
const EXPR = {
  idle: { eye: () => 'eyeOpen', hl: 'hlIdle', mouth: null },
  surprised: { eye: () => 'eyeSurprised', hl: 'hlSurprised', mouth: 'mouthSurprised' },
  squint: { eye: (s) => (s === 'L' ? 'eyeSquintL' : 'eyeSquintR'), mouth: 'mouthSquint' },
  happy: { eye: () => 'eyeHappy', mouth: 'mouthHappy' },
  dizzy: { eye: () => 'eyeDizzy', mouth: 'mouthDizzy' },
  sleepy: { eye: () => 'eyeSleepy', mouth: null },
};

const POP = 0.15, BLINK = 0.08, BLUSH_BASE = 0.6, BLUSH_DECAY = 1.5;
const EYE_K = 1.6, MOUTH_K = 1.5, CHEEK_K = 2.2; // plane size relative to the eye decal size
const Z = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qz = new THREE.Quaternion();

export function createFace(spec) {
  const size = spec.size ?? 0.14;
  const group = new THREE.Group();
  group.visible = false; // until the first update places it
  const leftEye = spec.eyes[0].pos[0] <= spec.eyes[1].pos[0] ? 0 : 1; // screen-left eye (camera looks down -z)
  const sideOf = (i) => (i === leftEye ? 'L' : 'R');

  const part = (anchor, cell, k, offset, order) => {
    const mat = new THREE.MeshBasicMaterial({
      map: atlas, transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, // premultiplied
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = order;
    setCell(mesh, cell);
    group.add(mesh);
    return { mesh, anchor, base: size * k, offset, roll: 0 };
  };
  const eyes = [0, 1].map((i) => part(i, 'eyeOpen', EYE_K, 0.03, 1001));
  const hls = [0, 1].map((i) => part(i, 'hlIdle', EYE_K, 0.0302, 1002));
  const cheeks = [0, 1].map((i) => part(2 + i, spec.whiskers ? (sideOf(i) === 'L' ? 'cheekWL' : 'cheekWR') : 'cheek', CHEEK_K, 0.028, 1000));
  // 嘴的样式：小熊「人」字、猫和海豹 ω、青蛙微笑、小猪鼻孔、有喙的不画嘴
  const style = spec.mouthStyle ?? 'cat';
  const idleMouth = { bear: 'mouthBear', cat: 'mouthCat', frog: 'mouthFrog', pig: 'mouthPig' }[style];
  const mouth = part(4, idleMouth ?? 'mouthCat', MOUTH_K, 0.03, 1001);
  mouth.mesh.visible = style !== 'none';
  const parts = [...eyes, ...hls, ...cheeks, mouth];
  const look = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

  let expr = 'idle', holdT = 0, popT = POP, t = Math.random() * 10;
  let blinkT = -1, nextBlink = 1 + Math.random() * 4, blush = 0, target = null;

  function apply(name) {
    const e = EXPR[name] ?? EXPR.idle;
    expr = EXPR[name] ? name : 'idle';
    eyes.forEach((p, i) => setCell(p.mesh, e.eye(sideOf(i))));
    hls.forEach((p) => { p.mesh.visible = !!e.hl; if (e.hl) setCell(p.mesh, e.hl); });
    if (style !== 'none' && style !== 'pig') setCell(mouth.mesh, e.mouth ?? idleMouth);
    popT = 0;
  }

  function place(p, ap, an, sx, sy, scaleX, scaleY) {
    const k = p.anchor;
    _n.set(an[k * 3], an[k * 3 + 1], an[k * 3 + 2]).normalize();
    _u.set(0, 1, 0).addScaledVector(_n, -_n.y); // world up projected onto the tangent plane
    if (_u.lengthSq() < 0.04) { _u.set(0, 0, 1).addScaledVector(_n, -_n.z); if (_u.lengthSq() < 1e-4) _u.set(0, 1, 0); }
    _u.normalize();
    _r.crossVectors(_u, _n);
    p.mesh.position.set(ap[k * 3], ap[k * 3 + 1], ap[k * 3 + 2])
      .addScaledVector(_n, p.offset).addScaledVector(_r, sx).addScaledVector(_u, sy);
    _m.makeBasis(_r, _u, _n);
    _q.setFromRotationMatrix(_m);
    if (p.roll) _q.multiply(_qz.setFromAxisAngle(Z, p.roll));
    p.mesh.quaternion.copy(_q);
    p.mesh.scale.set(p.base * scaleX, p.base * scaleY, 1);
  }

  return {
    object: group,

    setExpression(name, holdSeconds = 0) {
      if (name !== expr) apply(name);
      holdT = name === 'idle' ? 0 : holdSeconds;
    },

    lookAt(point) {
      target = point ? (target ?? new THREE.Vector3()).copy(point) : null;
    },

    setBlush(v) {
      blush = v <= 0 ? 0 : Math.max(blush, Math.min(1, v));
    },

    update(ap, an, dt) {
      group.visible = true;
      t += dt;
      if (holdT > 0 && (holdT -= dt) <= 0) { holdT = 0; apply('idle'); }
      popT = Math.min(POP, popT + dt);
      const pop = 1 + 0.25 * Math.sin(Math.PI * (popT / POP));

      // blink (idle only)
      let blinkY = 1;
      if (expr === 'idle') {
        if (blinkT < 0 && (nextBlink -= dt) <= 0) { blinkT = 0; nextBlink = 2 + Math.random() * 3; }
      } else blinkT = -1;
      if (blinkT >= 0) {
        blinkT += dt;
        const p = blinkT / BLINK;
        if (p >= 1) blinkT = -1; else blinkY = 1 - 0.92 * Math.sin(Math.PI * p);
      }

      blush = Math.max(0, blush - dt / BLUSH_DECAY);
      const op = Math.min(1, BLUSH_BASE + 0.9 * blush);
      for (const c of cheeks) { c.mesh.material.opacity = op; c.mesh.material.color.setScalar(op); }

      // eyes: shift toward the look target in the decal plane, highlights stay fixed
      const track = target && (expr === 'idle' || expr === 'surprised');
      const kLook = 1 - Math.exp(-10 * dt);
      for (let i = 0; i < 2; i++) {
        const k = i;
        _n.set(an[k * 3], an[k * 3 + 1], an[k * 3 + 2]).normalize();
        _u.set(0, 1, 0).addScaledVector(_n, -_n.y);
        if (_u.lengthSq() < 0.04) _u.set(0, 0, 1).addScaledVector(_n, -_n.z);
        _u.normalize(); _r.crossVectors(_u, _n);
        let tx = 0, ty = 0;
        if (track) {
          _d.set(target.x - ap[k * 3], target.y - ap[k * 3 + 1], target.z - ap[k * 3 + 2]);
          const len = Math.max(_d.length(), 0.01);
          tx = (_d.dot(_r) / len) * 1.6; ty = (_d.dot(_u) / len) * 1.6;
          const m = Math.hypot(tx, ty);
          if (m > 1) { tx /= m; ty /= m; }
        }
        look[i].x += (tx - look[i].x) * kLook; look[i].y += (ty - look[i].y) * kLook;
        const maxShift = 0.15 * size;
        const spin = expr === 'dizzy' ? (i === leftEye ? 1 : -1) * t * 9 : 0;
        eyes[i].roll = spin;
        place(eyes[i], ap, an, look[i].x * maxShift, look[i].y * maxShift, pop, pop * blinkY);
        place(hls[i], ap, an, 0, 0, pop, pop * blinkY);
        place(cheeks[i], ap, an, 0, 0, 1, 1);
      }
      mouth.roll = expr === 'squint' || expr === 'dizzy' ? 0.1 * Math.sin(t * 22) : 0;
      place(mouth, ap, an, 0, 0, pop, pop);
    },

    dispose() {
      for (const p of parts) { p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
      group.removeFromParent();
    },
  };
}
