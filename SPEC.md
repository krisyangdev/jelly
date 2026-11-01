# 果冻动物园 Jelly Zoo — v1 spec

A knitted basket packed with 10 (8–30) chubby needle-felted animals. Everything is soft-body.
The point is delight: every touch gets a squishy physical reaction, a face reaction and a sound.

Stack: three.js 0.186 (WebGLRenderer), Vite, plain ES modules, no other deps.
World units: box interior x ∈ [-3, 3], z ∈ [-2, 2], floor y = 0. Animals are ~0.9–1.2 units tall.
Rest frame of every animal: y up, face looks toward +z, origin = center of mass of its particles.

## Interactions (implemented in main.js, listed so module authors know what is needed)
- Quick click on an animal → poke: impulse into the body at the hit point, it dents and wobbles, neighbours wobble through contact. Face squints `> <`, cheeks blush, boing sound pitched by species.
- Press + drag → grab: the grabbed spot follows the cursor, the body stretches like mochi, release throws it.
- Press + hold still → squash: body flattens (restScale y↓, xz↑), release → it springs up into the air.
- Press and hold on empty floor → animal rain: a random animal drops in every 0.09 s around the cursor (follows the cursor),
  happy face + pop each, up to 30 (`MAX_ANIMALS`).
- Tilt the basket: drag a rim up (up to 1.0 rad, 0.005 rad/px), arrow keys (0.5 rad), or phone tilt (0.5 rad, requested on
  first touch). All basket content lives in a `tray` group that rotates about the low side's bottom edge; physics stays in
  the box frame with gravity rotated by the inverse tray rotation. Tilt follows its target through a spring (K 70, C 6), so
  letting go rocks it flat. Camera follows the tray center and zooms out with the angle so the lifted side stays in frame.
  Past 0.28 rad everyone looks surprised; past 0.65 rad they panic-hop, and the ones on top tumble over the low rim.
  Landing back flat fast slams the basket: everyone is bounced up and looks happy.
- An animal whose center leaves the footprint and reaches table height falls out: poof of tinted fluff + pop, removed;
  at 8 animals (`MIN_ANIMALS`) it drops back in from the sky instead.
- Space → shake the whole box: the basket is tossed up a little (falls back with gravity, small bounce) and wobbles (spring), the camera does not follow the toss; everyone hops.
- Hover → animal looks surprised/happy, all eyes look toward the cursor.
- Hard landing → dizzy spiral eyes for ~1.2 s.
- Stroke the cursor across an animal (no button) → petting: fuzz lies down along the stroke (`comb.js`, per-vertex `comb`
  attribute read by the fuzz shells) and fluffs back over ~2 s; the animal closes its eyes, blushes, leans into the hand,
  pops small hearts, coos (`petChirp`); the cat purrs (`startPurr`), the chick puffs up.
- Social: poked animal's neighbours flinch and turn to look; everyone watches a dragged animal; when it lands back,
  nearby friends hop to welcome it; an animal with another on top squints; two that sit still side by side for a while
  lean into each other with a heart.

## Module interfaces

### src/physics.js (agent A)
```js
export class JellyWorld {
  constructor({ halfX = 3, halfZ = 2, floorY = 0, wallHeight = 0.5, wallThickness = 0.26, gravity = -12, substeps = 6, friction = 0.5 })
  bodies: Body[]
  gravity: THREE.Vector3          // main rotates it into the box frame while the basket is tilted
  onImpact: null | ((body, speed) => void)   // set by main; called when a body hits floor/wall/another body with normal speed > 1.2, per-body cooldown 0.1 s
  addBody({ rest: Float32Array /* n*3, rest frame */, radius, stiffness = 0.25, beta = 0.35, damping = 0.995,
            position: {x,y,z}, yaw = 0, velocity = {x,y,z} }) -> Body
  removeBody(body)
  place(body, position, yaw = 0, velocity) // reset to rest shape at a new spot
  step(dt)                       // clamp dt to 1/30, run substeps
  pick(origin, dir)              // ray (THREE.Vector3s) vs particle spheres (radius*1.5) -> { body, index, point: Vector3, distance } | null
  grab(body, index, target)      // start drag constraint on particle index toward target (Vector3)
  moveGrab(target)
  release()                      // velocities preserved -> throw; cap speed at 14
  poke(body, point, dir, strength) // add velocity dir*strength*falloff to particles of body within 0.45 of point (smooth falloff)
  shake(dv)                      // add velocity vector dv to every particle (plus small random per body)
}
Body = {
  id, n, radius,
  pos: Float32Array n*3 (world, current), vel: Float32Array n*3,
  rest: Float32Array n*3 (centered rest positions q_i),
  center: THREE.Vector3,          // current center of mass
  velocity: THREE.Vector3,        // average velocity
  M: THREE.Matrix3,               // current goal deformation matrix = (beta*A_normalized + (1-beta)*R) * diag(restScale)
  R: THREE.Matrix3,               // rotation part
  restScale: THREE.Vector3(1,1,1),// main animates this for breathing / squash; goals use diag(restScale)*q_i
  stiffness, beta,
  impact: number,                 // decaying max contact speed (for faces)
  grounded: boolean,
}
```
Method: position based dynamics with meshless shape matching (Müller 2005), per substep:
v += g h (g is a vector); p = x + v h; grab constraint; shape matching (goal = c + M q_i, per-substep stiffness k_s = 1-(1-k)^(1/substeps));
particle–particle collisions between different bodies via spatial hash (cell = 2r), all particles take part (a surface-only shell lets a body sink into another and stay stuck), push apart to 2r along the pair direction, or along the center-to-center direction when either particle is interior, tangential friction;
floor only inside the footprint, 4 solid walls `wallThickness` (0.26, same as the basket mesh) thick and `wallHeight` tall: a particle coming from above lands on the rim top, which rises toward the outside (slope 1) so bodies landing on it slide back in, a particle entering from a side is pushed back out of that side, so no part of a body sits inside or pokes through a wall, and bodies can still go over the rim and fall off the table edge; with friction; v = (p - x)/h; v *= damping.
Rotation: Müller 2016 "A Robust Method to Extract the Rotational Part of Deformations" (quaternion kept per body between steps).
A = Apq * Aqq^-1 (Aqq^-1 precomputed), normalize by cbrt(det); if det <= 1e-6 use R.
Robustness: if any NaN or a particle leaves |x|>20 or y<-30, reset that body to its rest shape at (0, 2.5, 0).

### src/skin.js (agent A)
```js
export function createSkin(body, geometry /* indexed BufferGeometry in rest frame */, anchors /* [{pos:[x,y,z], normal:[x,y,z]}] */)
  -> { update(), anchorPos: Float32Array k*3 (world), anchorNormal: Float32Array k*3 (world, unit) }
```
Binding at creation: every vertex and anchor binds to its 4 nearest rest particles, weights ∝ 1/(d+0.02)^2 normalized, stores offsets o_k = v0 - q_k.
update(): v = Σ w_k (x_k + M o_k); write into geometry position attribute (geometry is in world space; mesh stays at identity transform),
computeVertexNormals(), computeBoundingSphere(); anchors the same, normals = normalize(M^-T n0).

### src/animals.js + src/materials.js
```js
export const SPECIES = ['bear','bunny','cat','frog','chick','pig','penguin','seal']
export function buildAnimal(species, { scale = 1 } = {}) -> {
  species, geometry /* indexed, vertex colors */, rest, radius, color, material /* shared feltMaterial */,
  face: { eyes: [anchor, anchor], cheeks: [anchor, anchor], mouth: anchor, size, mouthStyle /* bear|cat|frog|pig|none */, whiskers },
  pitch,
}
```
Style: 胖墩 (the first version's proportions). Big body plus a big head, thick stubby arms and legs, ears/tails/beaks/flippers
as extra primitives, local color patches as vertex colors. 10 animals at scale 0.9–1.12 nearly fill the box, so a poke
shoves the neighbours too. Needle-felted wool look (concept `refs/style-felt-a-needle.png`), muted earthy palette fixed per species: one shared
`feltMaterial()` (matte, sheen, mottled tone from 3D noise) plus `addFuzz(mesh)` shells (6 instanced layers pushed out
along the normal, fibers picked in 3D cells of the rest-pose `fiber`/`fiberN` attributes so they follow deformation
without seams). Face decals sit 0.03 off the surface so the beads look set into the fuzz. The box is a knitted basket
(`knit.js`, copied from the yarn project). Sounds are soft plush puffs, wool rustle and pentatonic squeaks.
Particles: lattice spacing 0.11, offset picked from 27 candidates to cover every primitive.

### src/face.js + src/audio.js (agent C)
```js
export function createFace(faceSpec /* from buildAnimal().face */) -> {
  object: THREE.Group,                 // add to scene (world space)
  update(anchorPos, anchorNormal, dt), // anchor order: eyes[0], eyes[1], cheeks[0], cheeks[1], mouth (same as skin anchors)
  setExpression(name, holdSeconds = 0),// 'idle' | 'squint' | 'happy' | 'dizzy' | 'surprised' | 'sleepy'; after hold returns to idle
  lookAt(worldPoint | null),           // pupils/highlights shift toward the point in idle/surprised
  setBlush(0..1),
}
```
Decals are small planes with MeshBasicMaterial + shared CanvasTexture atlases drawn in code (crisp, kawaii sticker look: glossy black eyes with
white highlight, `> <` squint, `^ ^` happy, rotating spiral dizzy, big round surprised eyes, `— —` sleepy; small mouth that changes per
expression: `ω` / `u` / `o`; pink soft blush ovals). Oriented to the surface normal with up ≈ world up projected; offset 0.012 along normal;
transparent, depthWrite false. Random blinking in idle every 2–5 s. Expression changes get a tiny scale pop.

```js
export function initAudio()            // call on first user gesture; safe to call repeatedly
export function boing(pitch, strength) // poke/landing: pitch-dropping rubbery boing with wobble vibrato + short wet squelch noise
export function pop()                  // new animal spawned
export function startStretch() -> { set(amount 0..1), stop() } // rubbery creak while dragging, pitch rises with stretch
export function shakeSound()
```
All synthesized with WebAudio, no files. Quantize boing pitches to a major pentatonic scale so random poking sounds musical.
Master: DynamicsCompressor + small generated reverb. Limit to 12 simultaneous voices. Volume pleasant, never harsh.

### src/room.js + src/props.js (the room around the basket)
The basket stands on a light oak table by a window (concepts `refs/scene/a-window.png` day, `d-night.png` night).
`createRoom({ scene, renderer }) -> { group, sun, setTime(t) }`: table (one oak texture across the top), floor, back wall with
a 2x2-pane window and the outside view (`public/tex/outside-day.jpg` / `outside-night.jpg`), all global lights and the
background. Day: a SpotLight behind the window with a pane cookie throws window light over the basket and table.
Night: dim blue hemisphere, faint moon, warm bounce from the camera side.
`createProps({ scene, renderer }) -> { group, lampLight, setTime(t), update(dt) }`: every prop is crocheted / knitted yarn
(concept `refs/scene2/a-props-yarn.png`; the table, wall and window stay real): pothos with plump knitted leaves, two yarn
balls with needles (wound strands like the yarn project), knitted check napkin, crochet coaster; day: crocheted tea cup
with flower appliqués and steam; night: crocheted cocoa mug with bear appliqués, desk lamp (wooden stand, knitted shade,
shadow-casting spot, shade in the top-left of the frame), knitted books, crocheted candle with a real flame and flicker.
knit.js is the yarn project's full version (colorwork: `color2` + `pattern`).
t = 0 day, 1 night, from the local clock (7:00–18:00 day, `?time=day|night` to force), eased over 4 s in main.
The shared fuzz rim glow (`fuzzGlow` in materials.js) follows it (0.35 → 0.14) so fuzz does not sparkle in the dark.
Shadow normalBias 0.06 on both spots: the fuzz shells speckle with less.

### src/main.js (main agent)
Renderer, scene, lights, the candy box, camera, interactions, glue.
