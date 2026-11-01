import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { JellyWorld } from './physics.js';
import { createSkin } from './skin.js';
import { SPECIES, buildAnimal } from './animals.js';
import { createFace } from './face.js';
import * as sfx from './audio.js';
import { createEffects, createDizzyStars } from './effects.js';
import { addFuzz, fuzzGlow } from './materials.js';
import { yarnMaterial } from './knit.js';
import { createComb } from './comb.js';
import { createRoom } from './room.js';
import { createProps } from './props.js';

// ?cam=x,y,z 指定机位；?n=数量 初始动物数；?time=day|night 固定白天或夜晚
const params = new URLSearchParams(location.search);
const vec = (s) => s && new THREE.Vector3(...s.split(',').map(Number));

const HALF_X = 3, HALF_Z = 2, WALL_T = 0.26, MAX_ANIMALS = 30, MIN_ANIMALS = 8;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.25;

// 窗边木桌：白天午后阳光，晚上台灯。按电脑时间切换，换的时候慢慢过渡
const room = createRoom({ scene, renderer });
const props = createProps({ scene, renderer });
const timeTarget = () => {
  if (params.get('time') === 'day') return 0;
  if (params.get('time') === 'night') return 1;
  const h = new Date().getHours();
  return h >= 7 && h < 18 ? 0 : 1;
};
let dayNight = timeTarget();

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 100);
const camHome = vec(params.get('cam')) ?? new THREE.Vector3(0, 5.4, 7.6);
camera.position.copy(camHome);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.2, 0);
// 左键留给戳和拖，右键转镜头
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.enablePan = false;
controls.enableDamping = true;
controls.minDistance = 5;
controls.maxDistance = 20;
controls.maxPolarAngle = Math.PI * 0.42;

// ---------- 奶油色针织小筐 ----------
function buildBox() {
  const group = new THREE.Group();
  // 粗毛线，一针约 0.22：平针一块贴图 4 针 × 5 行
  const knit = (w, h, stitch = 'stockinette') => yarnMaterial({ color: '#f3e7d3', stitch, repeat: [Math.max(1, Math.round(w / 0.88)), Math.max(1, Math.round(h / 1.1))] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), knit(HALF_X * 2, HALF_Z * 2));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  floor.receiveShadow = true;
  group.add(floor);

  const T = WALL_T, H = 0.5;
  const walls = [
    [HALF_X * 2 + T * 2, H, T, 0, -HALF_Z - T / 2],
    [HALF_X * 2 + T * 2, H, T, 0, HALF_Z + T / 2],
    [T, H, HALF_Z * 2 + T * 2, -HALF_X - T / 2, 0],
    [T, H, HALF_Z * 2 + T * 2, HALF_X + T / 2, 0],
  ];
  for (const [w, h, d, x, z] of walls) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, 0.12), knit(Math.max(w, d), h));
    m.position.set(x, h / 2 - 0.02, z);
    m.castShadow = m.receiveShadow = true;
    m.userData.rim = true;
    group.add(m);
  }
  const base = new THREE.Mesh(new RoundedBoxGeometry(HALF_X * 2 + T * 2, 0.16, HALF_Z * 2 + T * 2, 4, 0.07), knit(HALF_X * 2, 0.3));
  base.position.y = -0.08;
  base.receiveShadow = true;
  group.add(base);

  return { group, rims: group.children.filter((m) => m.userData.rim) };
}

// 桌子不动，筐子和里面的东西都放在 tray 里，倾斜时整组转
const tray = new THREE.Group();
scene.add(tray);
const basket = buildBox();
tray.add(basket.group);
const trayInv = new THREE.Matrix4();

// ---------- animals ----------
const world = new JellyWorld({ halfX: HALF_X, halfZ: HALF_Z, wallThickness: WALL_T });
const fx = createEffects(tray);

function dizzy(a, seconds) {
  a.face.setExpression('dizzy', seconds);
  a.dizzyUntil = performance.now() + seconds * 1000;
}
const animals = [];
const rand = (a, b) => a + Math.random() * (b - a);

function spawn(species, x, z, y = rand(2.5, 3.5)) {
  if (animals.length >= MAX_ANIMALS) return null;
  const data = buildAnimal(species, { scale: rand(0.9, 1.12) });
  const body = world.addBody({
    rest: data.rest,
    radius: data.radius,
    stiffness: rand(0.18, 0.28),
    position: { x, y, z },
    yaw: rand(-0.25, 0.25),
    velocity: { x: 0, y: -1, z: 0 },
  });
  const mesh = new THREE.Mesh(data.geometry, data.material);
  addFuzz(mesh);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  tray.add(mesh);
  const f = data.face;
  const skin = createSkin(body, data.geometry, [f.eyes[0], f.eyes[1], f.cheeks[0], f.cheeks[1], f.mouth]);
  const face = createFace(f);
  tray.add(face.object);
  const a = { data, body, mesh, skin, face, comb: createComb(data.geometry), stars: createDizzyStars(tray), dizzyUntil: 0, zTimer: rand(0, 1.5),
    head: new THREE.Vector3(), phase: rand(0, 6.28), pokes: [], squash: 0, squashing: false, nextHop: rand(3, 9),
    pet: 0, petted: false, chirpAt: 0, heartAt: 0, puff: 0, purr: null, // 撸毛
    look: null, lookUntil: 0, squished: false, squishAt: 0, calm: 0, cuddleCd: rand(4, 10), lean: null, leanUntil: 0, returnedAt: 0 }; // 互动
  body.animal = a;
  animals.push(a);
  face.setExpression('surprised', 0.6);
  return a;
}

// 从筐里翻出去的：动物多就噗地弹走，少了就从天上掉回来
function fellOut(a) {
  fx.poof(a.body.center, a.data.color);
  sfx.pop();
  if (animals.length <= MIN_ANIMALS) {
    world.place(a.body, { x: rand(-2, 2), y: rand(3.5, 4.5), z: rand(-1.2, 1.2) }, rand(-0.3, 0.3), { x: 0, y: -1, z: 0 });
    a.face.setExpression('surprised', 1);
    return;
  }
  if (press?.a === a) { world.release(); press = null; }
  if (hovered === a) hovered = null;
  world.removeBody(a.body);
  a.mesh.removeFromParent();
  a.mesh.geometry.dispose();
  for (const c of a.mesh.children) c.material.dispose();
  a.face.dispose();
  a.stars.dispose();
  a.purr?.stop();
  animals.splice(animals.indexOf(a), 1);
}

// 开场：一只一只掉进盒子
const initial = Number(params.get('n') ?? 10);
const queue = [];
for (let i = 0; i < initial; i++) queue.push(SPECIES[i % SPECIES.length]);
for (let i = 0; i < initial; i++) {
  const col = i % 5, row = Math.floor(i / 5) % 2, layer = Math.floor(i / 10);
  setTimeout(() => {
    spawn(queue[i], -2.2 + col * 1.1 + rand(-0.15, 0.15), -0.9 + row * 1.6 + rand(-0.15, 0.15), rand(2.5, 3.5) + layer * 1.2);
    sfx.pop();
  }, 250 + i * 160);
}

// ---------- sound + face reactions to impacts ----------
let soundBudget = 0;
world.onImpact = (body, speed) => {
  const a = body.animal;
  if (!a) return;
  if (speed > 7) dizzy(a, 1.2);
  // 被拎走又放回来：落地时旁边的小伙伴蹦一下欢迎
  if (a.returnedAt && performance.now() - a.returnedAt < 3000 && body.grounded) {
    a.returnedAt = 0;
    for (const b of animals) {
      if (b === a || b.body.center.distanceTo(a.body.center) > 1.9 || !b.body.grounded) continue;
      lookAtFor(b, a.head, 1.5);
      setTimeout(() => {
        addVel(b.body, 0, rand(2.2, 3), 0);
        b.face.setExpression('happy', 1.2);
      }, rand(60, 260));
    }
    setTimeout(() => fx.burst(a.head, { count: 4, kinds: ['heart'], speed: 1.6, size: 0.2 }), 250);
  }
  if (speed > 2.5 && soundBudget > 0) {
    soundBudget--;
    sfx.boing(a.data.pitch * 0.85, Math.min(1, speed / 9));
  }
};

// ---------- pointer interaction ----------
const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragPlane = new THREE.Plane();
const tmp = new THREE.Vector3();
let press = null; // { a, hit, t0, x0, y0, mode: 'press' | 'drag' | 'squash' }
let stretch = null;
let hoverPoint = null;
let lastInput = performance.now();

// 射线换算到筐子自己的坐标系：物理、表情、特效都在这个坐标系里
const localRay = new THREE.Ray();
function rayFrom(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return localRay.copy(raycaster.ray).applyMatrix4(trayInv);
}

function wakeAll() {
  const now = performance.now();
  if (now - lastInput > 20000) for (const a of animals) a.face.setExpression('surprised', 0.8);
  lastInput = now;
}

function addVel(body, x, y, z) {
  for (let i = 0; i < body.n; i++) {
    body.vel[i * 3] += x;
    body.vel[i * 3 + 1] += y;
    body.vel[i * 3 + 2] += z;
  }
}

// 眼睛暂时盯着某个点（传进来的是活的 Vector3，跟着动）
function lookAtFor(a, point, seconds) {
  a.look = point;
  a.lookUntil = performance.now() + seconds * 1000;
}

// 上半身往某个方向歪：只推重心以上的粒子，越高推得越多
function leanToward(a, target, strength, dt) {
  const b = a.body, c = b.center;
  let dx = target.x - c.x, dz = target.z - c.z;
  const l = Math.hypot(dx, dz);
  if (l < 1e-3) return;
  dx /= l; dz /= l;
  for (let i = 0; i < b.n; i++) {
    const h = b.pos[i * 3 + 1] - c.y;
    if (h <= 0) continue;
    const k = strength * dt * Math.min(1, h / 0.4);
    b.vel[i * 3] += dx * k;
    b.vel[i * 3 + 2] += dz * k;
  }
}

function poke(a, hit, dir) {
  world.poke(a.body, hit.point, dir, 4.5);
  fx.burst(hit.point.clone().addScaledVector(dir, -0.1));
  a.face.setExpression('squint', 0.45);
  a.face.setBlush(1);
  sfx.boing(a.data.pitch, 0.75);
  const now = performance.now();
  a.pokes = a.pokes.filter((t) => now - t < 2000);
  a.pokes.push(now);
  if (a.pokes.length >= 5) {
    dizzy(a, 1.6);
    fx.burst(a.head, { count: 8, kinds: ['star'], speed: 2.6 });
    a.pokes.length = 0;
  }
  // 邻居被吓一跳，扭头看它
  for (const b of animals) {
    if (b !== a && b.body.center.distanceTo(a.body.center) < 1.6) {
      b.face.setExpression('surprised', 0.5);
      lookAtFor(b, a.head, 1.2);
    }
  }
}

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  sfx.initAudio();
  wakeAll();
  const ray = rayFrom(e);
  const hit = world.pick(ray.origin, ray.direction);
  if (hit) {
    renderer.domElement.setPointerCapture(e.pointerId);
    press = { a: hit.body.animal, hit, t0: performance.now(), x0: e.clientX, y0: e.clientY, mode: 'press', dir: ray.direction.clone() };
    return;
  }
  requestPhoneTilt();
  // 抓筐边：往上拖抬起这一边，往下压放低这一边
  const rim = raycaster.intersectObjects(basket.rims, false)[0];
  if (rim) {
    const p = tray.worldToLocal(rim.point.clone());
    const dir = Math.abs(p.x) / HALF_X > Math.abs(p.z) / HALF_Z ? new THREE.Vector2(Math.sign(p.x), 0) : new THREE.Vector2(0, Math.sign(p.z));
    lift = { dir, y0: e.clientY, amount: 0 };
    renderer.domElement.setPointerCapture(e.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
    return;
  }
  // 按住空地：动物雨，跟着手走
  if (ray.intersectPlane(floorPlane, tmp)) {
    rain = { x: tmp.x, z: tmp.z, next: 0 };
    renderer.domElement.setPointerCapture(e.pointerId);
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  const ray = rayFrom(e);
  if (lift) {
    lift.amount = THREE.MathUtils.clamp((lift.y0 - e.clientY) * 0.005, -MAX_TILT, MAX_TILT);
    lastInput = performance.now();
    return;
  }
  if (rain) {
    if (ray.intersectPlane(floorPlane, tmp)) { rain.x = tmp.x; rain.z = tmp.z; }
    return;
  }
  if (!press) {
    const hit = world.pick(ray.origin, ray.direction);
    const a = hit?.body.animal ?? null;
    // 撸毛：在同一只身上移动就顺着方向梳绒毛，攒撸的量
    if (a && a === hovered && hoverPoint) {
      const delta = hit.point.clone().sub(hoverPoint);
      const d = delta.length();
      if (d > 1e-4 && d < 0.5) {
        a.comb.brush(hit.point, delta);
        a.pet = Math.min(1.5, a.pet + d * 1.3);
        lastInput = performance.now();
      }
    }
    hoverPoint = hit ? hit.point.clone() : ray.intersectPlane(floorPlane, tmp)?.clone() ?? null;
    hover(a);
    renderer.domElement.style.cursor = a ? 'pointer' : raycaster.intersectObjects(basket.rims, false).length ? 'grab' : 'default';
    return;
  }
  lastInput = performance.now();
  const moved = Math.hypot(e.clientX - press.x0, e.clientY - press.y0);
  if (press.mode === 'press' && moved > 6) {
    press.mode = 'drag';
    camera.getWorldDirection(tmp).transformDirection(trayInv);
    dragPlane.setFromNormalAndCoplanarPoint(tmp.negate(), press.hit.point);
    world.grab(press.a.body, press.hit.index, press.hit.point);
    press.a.face.setExpression('happy');
    stretch = sfx.startStretch();
    for (const b of animals) if (b !== press.a && b.body.center.distanceTo(press.a.body.center) < 1.8) b.face.setExpression('surprised', 0.6);
  }
  if (press.mode === 'drag' && ray.intersectPlane(dragPlane, tmp)) {
    tmp.x = THREE.MathUtils.clamp(tmp.x, -HALF_X + 0.2, HALF_X - 0.2);
    tmp.z = THREE.MathUtils.clamp(tmp.z, -HALF_Z + 0.2, HALF_Z - 0.2);
    tmp.y = THREE.MathUtils.clamp(tmp.y, 0.15, 2.4);
    world.moveGrab(tmp);
    const b = press.a.body;
    const p = press.hit.index * 3;
    const d = Math.hypot(b.pos[p] - tmp.x, b.pos[p + 1] - tmp.y, b.pos[p + 2] - tmp.z);
    stretch?.set(Math.min(1, d / 1.2));
    hoverPoint = tmp.clone();
  }
});

function endPress() {
  if (lift) {
    lift = null;
    renderer.domElement.style.cursor = 'grab';
  }
  rain = null;
  if (!press) return;
  const { a, mode, hit, dir } = press;
  if (mode === 'press') poke(a, hit, dir);
  if (mode === 'drag') {
    world.release();
    stretch?.stop();
    stretch = null;
    a.face.setExpression('surprised', 0.4);
    a.returnedAt = performance.now();
  }
  if (mode === 'squash') {
    // 松手弹起来，压得越久跳得越高
    a.squashing = false;
    addVel(a.body, 0, 4 + 6 * a.squash, 0);
    a.face.setExpression('happy', 1.0);
    sfx.boing(a.data.pitch * 1.5, 1);
    fx.burst(a.body.center.clone().setY(0.1), { count: 10, kinds: ['star', 'sparkle'], speed: 3.4, size: 0.3 });
  }
  press = null;
}
renderer.domElement.addEventListener('pointerup', endPress);
renderer.domElement.addEventListener('pointercancel', endPress);

let hovered = null;
function hover(a) {
  if (a === hovered) return;
  hovered = a;
  if (a) {
    a.face.setExpression('happy', 0.7);
    a.face.setBlush(0.6);
  }
}

const TILT_KEYS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('keydown', (e) => {
  if (TILT_KEYS[e.code]) {
    e.preventDefault();
    keys.add(e.code);
    lastInput = performance.now();
    return;
  }
  if (e.code !== 'Space') return;
  e.preventDefault();
  sfx.initAudio();
  wakeAll();
  world.shake(new THREE.Vector3(rand(-1.5, 1.5), 6, rand(-1, 1)));
  jolt.vy = 2.2;
  jolt.vrx += rand(-0.8, 0.8);
  jolt.vrz += rand(-1.2, 1.2);
  sfx.shakeSound();
  for (const a of animals) a.face.setExpression('surprised', 0.6);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 倾斜筐子 ----------
// 倾斜向量 = 抬起那一侧的水平方向 × 角度（弧度）。目标来自拖筐边、方向键或手机，实际值用弹簧追，松手会晃两下回平
const MAX_TILT = 1.0;  // 拖筐边能抬到这么陡，动物会从低的那边倒出去
const KEY_TILT = 0.5;  // 方向键和手机只让大家滑到一边
const TILT_K = 70, TILT_C = 6;
const tilt = { x: 0, z: 0, vx: 0, vz: 0, wasTilted: false };
// 按空格时筐子被往上颠一下：竖直方向有重力、落回桌面弹一下，同时小幅晃一晃
const JOLT_K = 260, JOLT_C = 10;
const jolt = { y: 0, vy: 0, rx: 0, vrx: 0, rz: 0, vrz: 0 };
const _joltQ = new THREE.Quaternion(), _joltE = new THREE.Euler();
const keys = new Set();
let lift = null;  // { dir: Vector2, y0, amount }
let rain = null;  // { x, z, next }
let phone = null; // { beta0, gamma0, x, z }
const GRAVITY = new THREE.Vector3(0, -12, 0);
const _axis = new THREE.Vector3(), _pivot = new THREE.Vector3(), _q = new THREE.Quaternion();
const camShift = new THREE.Vector3(), _shift = new THREE.Vector3(), _world = new THREE.Vector3();

function requestPhoneTilt() {
  if (phone || typeof DeviceOrientationEvent === 'undefined') return;
  phone = { beta0: null, gamma0: null, x: 0, z: 0 };
  const listen = () => addEventListener('deviceorientation', (e) => {
    if (e.beta == null) return;
    if (phone.beta0 == null) { phone.beta0 = e.beta; phone.gamma0 = e.gamma; }
    const k = Math.PI / 180;
    phone.x = THREE.MathUtils.clamp(-(e.gamma - phone.gamma0) * k, -KEY_TILT, KEY_TILT);
    phone.z = THREE.MathUtils.clamp(-(e.beta - phone.beta0) * k, -KEY_TILT, KEY_TILT);
  });
  if (DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().then((r) => r === 'granted' && listen()).catch(() => {});
  else listen();
}

function updateTilt(dt) {
  let tx = 0, tz = 0;
  if (lift) { tx = lift.dir.x * lift.amount; tz = lift.dir.y * lift.amount; }
  else if (keys.size) for (const k of keys) { tx += TILT_KEYS[k][0] * KEY_TILT; tz += TILT_KEYS[k][1] * KEY_TILT; }
  else if (phone) { tx = phone.x; tz = phone.z; }
  const h = dt / 2;
  for (let i = 0; i < 2; i++) {
    tilt.vx += (TILT_K * (tx - tilt.x) - TILT_C * tilt.vx) * h;
    tilt.vz += (TILT_K * (tz - tilt.z) - TILT_C * tilt.vz) * h;
    tilt.x += tilt.vx * h;
    tilt.z += tilt.vz * h;
    jolt.vy -= 12 * h;
    jolt.y += jolt.vy * h;
    if (jolt.y < 0) { jolt.y = 0; jolt.vy = jolt.vy < -0.3 ? -jolt.vy * 0.3 : 0; }
    jolt.vrx += (-JOLT_K * jolt.rx - JOLT_C * jolt.vrx) * h;
    jolt.vrz += (-JOLT_K * jolt.rz - JOLT_C * jolt.vrz) * h;
    jolt.rx += jolt.vrx * h;
    jolt.rz += jolt.vrz * h;
  }
  const angle = Math.min(MAX_TILT * 1.15, Math.hypot(tilt.x, tilt.z));
  if (angle < 1e-4) {
    tray.position.set(0, 0, 0);
    tray.quaternion.identity();
  } else {
    // 绕着低的那一边的底边转，筐子不会插进桌子里
    const ux = tilt.x / Math.hypot(tilt.x, tilt.z), uz = tilt.z / Math.hypot(tilt.x, tilt.z);
    const ex = HALF_X + 0.26, ez = HALF_Z + 0.26;
    const reach = Math.min(ex / Math.max(Math.abs(ux), 1e-6), ez / Math.max(Math.abs(uz), 1e-6));
    _pivot.set(-ux * reach, -0.16, -uz * reach);
    tray.quaternion.setFromAxisAngle(_axis.set(-uz, 0, ux), angle);
    tray.position.copy(_pivot).sub(_pivot.clone().applyQuaternion(tray.quaternion));
  }
  // 镜头只跟倾斜走，不跟颠簸走，这样看得出筐子在动
  tray.updateMatrixWorld();
  _shift.set(0, 0.2, 0).applyMatrix4(tray.matrixWorld);
  tray.position.y += jolt.y;
  tray.quaternion.multiply(_joltQ.setFromEuler(_joltE.set(jolt.rx, 0, jolt.rz)));
  tray.updateMatrixWorld();
  trayInv.copy(tray.matrixWorld).invert();
  world.gravity.copy(GRAVITY).applyQuaternion(_q.copy(tray.quaternion).invert());

  // 镜头跟着筐子中心走，并稍微拉远，抬起来的那一边不出画
  _shift.y -= 0.2;
  _shift.multiplyScalar(0.85);
  camera.position.add(_shift).sub(camShift);
  controls.target.add(_shift).sub(camShift);
  camShift.copy(_shift);
  camera.zoom = 1 / (1 + 0.6 * angle);
  camera.updateProjectionMatrix();

  // 抬起来时大家吓一跳；放平那一下筐子磕在桌上，所有动物被颠起来
  if (!tilt.wasTilted && angle > 0.28) {
    tilt.wasTilted = true;
    for (const a of animals) a.face.setExpression('surprised', 1);
    sfx.shakeSound();
  }
  // 抬得很陡时大家慌得乱蹦，堆在上面的就翻出筐去了
  if (angle > 0.65) for (const a of animals) {
    if (!a.body.grounded || press?.a === a || Math.random() > dt * 2) continue;
    addVel(a.body, rand(-0.5, 0.5), rand(2.5, 4), rand(-0.5, 0.5));
    a.face.setExpression('surprised', 0.8);
  }
  const speed = Math.hypot(tilt.vx, tilt.vz);
  if (tilt.wasTilted && angle < 0.05 && speed > 1.2) {
    tilt.wasTilted = false;
    world.shake(new THREE.Vector3(0, Math.min(5, speed * 1.6), 0));
    sfx.shakeSound();
    for (const a of animals) a.face.setExpression('happy', 0.8);
  }
  if (tilt.wasTilted && angle < 0.05 && speed < 0.3) tilt.wasTilted = false;
}

function updateRain(dt) {
  if (!rain) return;
  rain.next -= dt;
  if (rain.next > 0 || animals.length >= MAX_ANIMALS) return;
  rain.next = 0.09;
  const x = THREE.MathUtils.clamp(rain.x + rand(-0.45, 0.45), -HALF_X + 0.5, HALF_X - 0.5);
  const z = THREE.MathUtils.clamp(rain.z + rand(-0.45, 0.45), -HALF_Z + 0.5, HALF_Z - 0.5);
  const a = spawn(SPECIES[Math.floor(Math.random() * SPECIES.length)], x, z, rand(3.2, 4.2));
  if (a) {
    a.face.setExpression('happy', 1);
    sfx.pop();
  }
}

// ---------- 撸毛的反应 ----------
const PET_ON = 0.35, PET_OFF = 0.12;
function updatePet(a, dt, now) {
  a.pet = Math.max(0, a.pet - dt * 0.35);
  a.puff = Math.max(0, a.puff - dt * 0.5);
  const beingStroked = a === hovered && !press;
  if (!a.petted && a.pet > PET_ON) {
    a.petted = true;
    a.face.setExpression('happy', 1);
  } else if (a.petted && a.pet < PET_OFF) {
    a.petted = false;
  }
  if (a.petted) {
    a.face.setExpression('happy', 0.6); // 撸着就一直眯眼
    a.face.setBlush(0.5 + 0.5 * Math.min(1, a.pet));
    // 往手的方向蹭
    if (beingStroked && hoverPoint) leanToward(a, hoverPoint, 2.2 * Math.min(1, a.pet), dt);
    if (a.pet > 0.7 && now - a.heartAt > 2200) {
      a.heartAt = now;
      fx.burst(a.head, { count: 3, kinds: ['heart'], speed: 1.4, size: 0.18 });
      if (a.data.species === 'chick') a.puff = 1;
    }
    if (a.data.species !== 'cat' && beingStroked && now - a.chirpAt > rand(700, 1400)) {
      a.chirpAt = now;
      sfx.petChirp(a.data.pitch);
    }
  }
  // 猫被撸会呼噜
  if (a.data.species === 'cat') {
    if (a.petted && !a.purr) a.purr = sfx.startPurr();
    a.purr?.set(a.petted ? Math.min(1, a.pet) : 0);
    if (!a.petted && a.purr && a.pet < 0.05) {
      a.purr.stop();
      a.purr = null;
    }
  }
}

// ---------- 小动物之间的互动 ----------
const flat = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
function updateSocial(dt, now) {
  for (const a of animals) {
    const c = a.body.center;
    // 被别的压在身上：委屈地挤着眼
    let under = false;
    for (const b of animals) if (b !== a && b.body.center.y - c.y > 0.3 && flat(b.body.center, c) < 0.55) under = true;
    if (under && (!a.squished || now - a.squishAt > 500)) {
      a.squishAt = now;
      a.face.setExpression('squint', 0.7);
      a.face.setBlush(0.9);
    } else if (!under && a.squished) {
      a.face.setExpression('surprised', 0.4);
    }
    a.squished = under;

    // 安安静静待着的时间；被戳、被拎、被压就清零
    const still = a.body.grounded && a.body.velocity.length() < 0.35 && press?.a !== a && !under;
    a.calm = still ? a.calm + dt : 0;
    a.cuddleCd -= dt;

    // 贴贴：挨着待久了，两只互相靠过去
    if (a.calm > 2.5 && a.cuddleCd <= 0) {
      let best = null, bd = 1.05;
      for (const b of animals) {
        if (b === a || b.calm < 1 || b.cuddleCd > 0) continue;
        const d = flat(b.body.center, c);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) {
        for (const [p, q] of [[a, best], [best, a]]) {
          p.lean = q;
          p.leanUntil = now + 900;
          p.cuddleCd = rand(12, 24);
          p.face.setExpression('happy', 1.8);
          p.face.setBlush(0.9);
          lookAtFor(p, q.head, 1.8);
        }
        setTimeout(() => fx.burst(a.head.clone().lerp(best.head, 0.5), { count: 2, kinds: ['heart'], speed: 1, size: 0.2 }), 350);
        sfx.petChirp(a.data.pitch);
      }
    }
    if (a.lean && now < a.leanUntil) leanToward(a, a.lean.body.center, 3, dt);
    else a.lean = null;
  }
}

// ---------- loop ----------
const camLocal = new THREE.Vector3();
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 1 / 30);
  const t = timer.getElapsed();
  soundBudget = Math.min(4, soundBudget + dt * 14);

  dayNight += THREE.MathUtils.clamp(timeTarget() - dayNight, -dt / 4, dt / 4);
  room.setTime(dayNight);
  props.setTime(dayNight);
  props.update(dt);
  fuzzGlow.value = THREE.MathUtils.lerp(0.35, 0.14, dayNight);
  updateTilt(dt);
  updateRain(dt);
  // 翻出筐外、落到桌面的（筐子斜着时按世界高度算）
  for (const a of [...animals]) {
    const c = a.body.center;
    const out = Math.abs(c.x) > HALF_X + 0.3 || Math.abs(c.z) > HALF_Z + 0.3;
    if ((out && _world.copy(c).applyMatrix4(tray.matrixWorld).y < 0.2) || c.y < -2.5) fellOut(a);
  }

  // 按住不动超过 0.3 秒：开始压扁
  if (press?.mode === 'press' && performance.now() - press.t0 > 300) {
    press.mode = 'squash';
    press.a.squashing = true;
    press.a.face.setExpression('squint');
    stretch = null;
  }

  const now0 = performance.now();
  const sleepy = now0 - lastInput > 25000;
  for (const a of animals) {
    const b = a.body;
    a.squash = THREE.MathUtils.damp(a.squash, a.squashing ? 1 : 0, a.squashing ? 3 : 14, dt);
    if (a.squashing) a.face.setBlush(0.4 + 0.6 * a.squash);
    // 呼吸 + 压扁，体积大致守恒
    const breathe = 1 + 0.03 * Math.sin(t * (sleepy ? 1.2 : 2.2) + a.phase);
    const sy = breathe * (1 - 0.5 * a.squash);
    const sxz = 1 / Math.sqrt(sy);
    const puff = 1 + 0.1 * a.puff; // 小鸡被撸舒服了会炸毛
    b.restScale.set(sxz * puff, sy * puff, sxz * puff);

    // 偶尔自己蹦一下
    a.nextHop -= dt;
    if (a.nextHop < 0) {
      a.nextHop = rand(4, 12);
      if (!sleepy && b.grounded && press?.a !== a) {
        addVel(b, rand(-0.6, 0.6), rand(2.5, 3.8), rand(-0.6, 0.6));
        a.face.setExpression('happy', 0.6);
      }
    }
    if (sleepy && Math.random() < dt * 0.3) a.face.setExpression('sleepy', 4);
    updatePet(a, dt, now0);
  }
  updateSocial(dt, now0);

  world.step(dt);

  const now = performance.now();
  camLocal.copy(camera.position).applyMatrix4(trayInv);
  for (const a of animals) {
    a.skin.update();
    a.comb.update(dt);
    const dragged = press?.mode === 'drag' && press.a !== a ? press.a.head : null;
    a.face.lookAt(dragged ?? (now < a.lookUntil ? a.look : null) ?? hoverPoint ?? camLocal);
    a.face.update(a.skin.anchorPos, a.skin.anchorNormal, dt);
    // 头顶 = 两眼中点往上一点
    const ap = a.skin.anchorPos;
    a.head.set((ap[0] + ap[3]) / 2, (ap[1] + ap[4]) / 2 + 0.32, (ap[2] + ap[5]) / 2);
    a.stars.update(a.head, t, now < a.dizzyUntil);
    if (sleepy && (a.zTimer -= dt) < 0) {
      a.zTimer = rand(1.2, 2.2);
      fx.zzz(a.head);
    }
  }
  fx.update(dt);

  controls.update(dt);
  renderer.render(scene, camera);
});

// 调试和自动截图用
window.__jelly = { world, animals, camera, renderer, scene, spawn, poke: (i) => {
  const a = animals[i];
  const c = a.body.center;
  poke(a, { point: c.clone().add(new THREE.Vector3(0, 0.3, 0.3)) }, new THREE.Vector3(0, -0.5, -1).normalize());
} };
