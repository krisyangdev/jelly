import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TABLE_TOP = -0.16;
const WALL_Z = -5.2;
const SUN_INTENSITY = 5;
// 窗洞：x 从 -2.5 到 4.5，y 从 0.35 到 6.5
const OPEN = { x0: -2.5, x1: 4.5, y0: 0.35, y1: 6.5 };

const canvas = (size) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
};

// 灰泥墙：奶油底色加细噪点和几块很淡的色斑
function plasterTexture(renderer) {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#efe2cf';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    const x = 50 + Math.random() * (S - 100), y = 50 + Math.random() * (S - 100), r = 30 + Math.random() * 20;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(150,110,70,0.04)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 6, 1 / 6); // ShapeGeometry 的 uv 就是世界坐标，6 个单位一块
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// 窗光 gobo：2x2 窗格是亮的软边矩形，窗棂和四周是黑的，格子里有极淡的叶影
function windowCookie() {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const margin = S * 0.12, bar = S * 0.05, pane = (S - margin * 2 - bar) / 2;
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      const x = margin + i * (pane + bar), y = margin + j * (pane + bar);
      // 由外向内叠半透明矩形，边缘变软
      for (let r = 10; r >= 0; r--) {
        const e = (r - 5) * 1.6;
        g.fillStyle = 'rgba(255,246,232,0.22)';
        g.fillRect(x - e, y - e, pane + e * 2, pane + e * 2);
      }
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = margin + Math.random() * (S - margin * 2), y = margin + Math.random() * (S - margin * 2), r = 18 + Math.random() * 24;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(0,0,0,0.14)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRoom({ scene, renderer }) {
  const group = new THREE.Group();
  scene.add(group);

  const loader = new THREE.TextureLoader();
  const loadTex = (name) => {
    const t = loader.load(`/tex/${name}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };

  // ---------- 桌子：木纹整张只贴一次，木板沿 x ----------
  const TW = 20, TD = 10.5, TH = 0.3;
  const tableGeo = new RoundedBoxGeometry(TW, TH, TD, 4, 0.06);
  const pos = tableGeo.attributes.position, uv = tableGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + TW / 2) / TW, 1 - (pos.getZ(i) + TD / 2) / TD);
  }
  const table = new THREE.Mesh(tableGeo, new THREE.MeshStandardMaterial({ map: loadTex('wood'), roughness: 0.55 }));
  table.position.set(0, TABLE_TOP - TH / 2, (-5.0 + 5.5) / 2);
  table.receiveShadow = true;
  group.add(table);

  // 低机位往下看不到空洞
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#7d6650', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.5;
  group.add(floor);

  // ---------- 后墙：外框带窗洞的 Shape ----------
  const shape = new THREE.Shape();
  shape.moveTo(-16, -3.5);
  shape.lineTo(16, -3.5);
  shape.lineTo(16, 9);
  shape.lineTo(-16, 9);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(OPEN.x0, OPEN.y0);
  hole.lineTo(OPEN.x0, OPEN.y1);
  hole.lineTo(OPEN.x1, OPEN.y1);
  hole.lineTo(OPEN.x1, OPEN.y0);
  hole.closePath();
  shape.holes.push(hole);
  const wall = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ map: plasterTexture(renderer), roughness: 0.95 }),
  );
  wall.position.z = WALL_Z;
  wall.receiveShadow = true;
  group.add(wall);

  // ---------- 窗框：全部不投影，让窗光穿过 ----------
  const wood = new THREE.MeshStandardMaterial({ color: '#f3eee4', roughness: 0.55 });
  const box = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.025), wood);
    m.position.set(x, y, z);
    group.add(m);
  };
  const cx = (OPEN.x0 + OPEN.x1) / 2; // 洞中心 x = 1
  const jamb = 0.4, headH = 0.4;
  const frameH = OPEN.y1 + headH / 2 - OPEN.y0, frameMid = (OPEN.y0 + OPEN.y1 + headH / 2) / 2;
  box(OPEN.x1 - OPEN.x0 + 0.6, 0.12, 0.75, cx, OPEN.y0 - 0.06, WALL_Z - 0.125); // 窗台，前沿伸出墙面 0.25
  box(jamb, frameH, 0.4, OPEN.x0, frameMid, WALL_Z);
  box(jamb, frameH, 0.4, OPEN.x1, frameMid, WALL_Z);
  box(OPEN.x1 - OPEN.x0 + 0.4, headH, 0.4, cx, OPEN.y1, WALL_Z);
  // 窗棂：洞内净高从窗台顶到横梁底
  const clearH = OPEN.y1 - headH / 2 - OPEN.y0, midY = OPEN.y0 + clearH / 2;
  box(0.14, clearH, 0.12, cx, midY, WALL_Z - 0.05);
  box(OPEN.x1 - OPEN.x0 - jamb, 0.14, 0.12, cx, midY, WALL_Z - 0.05);

  // ---------- 窗外：白天和夜晚两张图淡入淡出 ----------
  const outside = (name, z, transparent) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 11),
      new THREE.MeshBasicMaterial({ map: loadTex(name), toneMapped: false, transparent }),
    );
    m.position.set(cx, (OPEN.y0 + OPEN.y1) / 2, z);
    group.add(m);
    return m;
  };
  outside('outside-night', -6.6, false);
  const outsideDay = outside('outside-day', -6.5, true);

  // ---------- 灯光 ----------
  const sun = new THREE.SpotLight('#ffe2b8', SUN_INTENSITY, 0, 0.27, 0.05, 0);
  sun.position.set(-3, 11, -15);
  sun.target.position.set(0.5, 0, 0.5);
  sun.map = windowCookie();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.06; // 绒毛壳层一层层叠着，偏移小了会满身白点
  sun.shadow.radius = 3;
  sun.shadow.camera.near = 12;
  sun.shadow.camera.far = 32;
  group.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight();
  const moon = new THREE.DirectionalLight('#9db4e8', 0);
  moon.position.set(1, 6, -10);
  const bounce = new THREE.DirectionalLight('#ffb27a', 0);
  bounce.position.set(-2, 4, 9);
  group.add(hemi, moon, bounce);

  const bg = new THREE.Color();
  scene.background = bg;

  const DAY = { sky: new THREE.Color('#fde8d2'), ground: new THREE.Color('#8a6a52'), bg: new THREE.Color('#f1dcc4'), hemi: 0.6, env: 0.25 };
  const NIGHT = { sky: new THREE.Color('#3a4a7a'), ground: new THREE.Color('#1d1712'), bg: new THREE.Color('#141a2e'), hemi: 0.25, env: 0.08 };

  // t: 0 白天，1 夜晚
  function setTime(t) {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    sun.intensity = SUN_INTENSITY * (1 - k);
    sun.castShadow = sun.intensity > 0.001; // 关灯后不再渲染阴影图
    hemi.color.lerpColors(DAY.sky, NIGHT.sky, k);
    hemi.groundColor.lerpColors(DAY.ground, NIGHT.ground, k);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, k);
    moon.intensity = 0.25 * k;
    bounce.intensity = 0.45 * k;
    bg.lerpColors(DAY.bg, NIGHT.bg, k);
    scene.environmentIntensity = THREE.MathUtils.lerp(DAY.env, NIGHT.env, k);
    outsideDay.material.opacity = 1 - k;
    outsideDay.visible = k < 1;
  }
  setTime(0);

  return { group, sun, setTime };
}
