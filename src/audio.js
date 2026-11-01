// Soft plush / felt / fabric WebAudio synth, no assets. All functions no-op until initAudio() ran on a user gesture.
let ctx = null, bus = null, noiseBuf = null, voices = 0;
const MAX_VOICES = 12;
const PENTA = [0, 2, 4, 7, 9]; // C major pentatonic pitch classes
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 24; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);

    // generated reverb impulse: smoothed decaying noise, 0.8 s
    const len = Math.floor(ctx.sampleRate * 0.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let y = 0;
      for (let i = 0; i < len; i++) {
        y += (Math.random() * 2 - 1 - y) * 0.35;
        d[i] = y * Math.pow(1 - i / len, 2.5);
      }
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.18;
    bus = ctx.createGain();
    bus.connect(master); bus.connect(conv); conv.connect(wet); wet.connect(master);

    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const n = noiseBuf.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== 'running') ctx.resume();
}

// Reserve a voice slot for `seconds`; false when over the limit.
function claim(seconds) {
  if (!ctx || voices >= MAX_VOICES) return false;
  voices++;
  setTimeout(() => { voices--; }, seconds * 1000 + 80);
  return true;
}

// Gain node with attack ramp then exponential decay to silence; connected to the bus via a lowpass (exposed as g.lp).
function chain(t, peak, attack, dur, cutoff, q = 0.5) {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(lp); lp.connect(bus);
  g.lp = lp;
  return g;
}

function osc(type, t, stop, dest) {
  const o = ctx.createOscillator(); o.type = type; o.connect(dest); o.start(t); o.stop(stop);
  return o;
}

// Looping noise source starting at a random offset; runs until stopped when `dur` is omitted.
function noiseSrc(t, dur) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  src.start(t, rand(0, 0.3));
  if (dur !== undefined) src.stop(t + dur);
  return src;
}

// Low-passed noise burst whose cutoff glides from `from` to `to`: cloth being squeezed or a breath of air.
function puff(t, peak, attack, dur, from, to) {
  const g = chain(t, peak, attack, dur, from);
  g.lp.frequency.setValueAtTime(from, t);
  g.lp.frequency.exponentialRampToValueAtTime(to, t + dur);
  noiseSrc(t, dur + 0.05).connect(g);
}

// Short low sine thump with a quick downward pitch drop.
function thump(t, f, peak, dur) {
  const g = chain(t, peak, 0.005, dur, 420);
  const o = osc('sine', t, t + dur + 0.05, g);
  o.frequency.setValueAtTime(f * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
}

// Soft tone with a small glide from f0 to f1.
function tone(type, t, f0, f1, peak, attack, dur, cutoff) {
  const g = chain(t, peak, attack, dur, cutoff);
  const o = osc(type, t, t + dur + 0.05, g);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
}

// Random pentatonic note near `pitch` (Hz), weighted toward the closest ones.
function quantize(pitch) {
  const m = 69 + 12 * Math.log2(Math.max(60, pitch) / 440);
  const c = Math.round(m), notes = [], w = [];
  let sum = 0;
  for (let n = c - 12; n <= c + 12; n++) {
    if (!PENTA.includes(((n % 12) + 12) % 12)) continue;
    const wt = 1 / (1 + Math.abs(n - m) / 5);
    notes.push(n); w.push(wt); sum += wt;
  }
  let r = Math.random() * sum, pick = notes[0];
  for (let i = 0; i < notes.length; i++) { if ((r -= w[i]) <= 0) { pick = notes[i]; break; } }
  return 440 * Math.pow(2, (pick - 69) / 12);
}

// Muffled "pomf": squeezed-cloth noise + low thump, with a quiet squeaky-toy chirp on top.
export function boing(pitch = 300, strength = 0.6) {
  if (!ctx) return;
  const s = clamp(strength, 0, 1);
  if (!claim(0.35)) return;
  const t = ctx.currentTime;
  puff(t, 0.12 + 0.2 * s, 0.008, 0.12 + 0.08 * s, 600 + 900 * s, 300 + 250 * s);
  thump(t, 70 + 90 * clamp((pitch - 165) / 275, 0, 1), 0.22 + 0.3 * s, 0.14 + 0.1 * s);
  const f = clamp(quantize(pitch) * 2, 260, 1400), dir = Math.random() < 0.5 ? 1.09 : 0.92;
  tone(Math.random() < 0.5 ? 'sine' : 'triangle', t + 0.012, f / dir, f * dir, 0.035 + 0.05 * s, 0.01, rand(0.06, 0.12), 2200 + 1800 * s);
}

// Soft felt "pof" (pompom on a cushion): tiny thump, breathy puff, faint high pentatonic chime.
export function pop() {
  if (!claim(0.4)) return;
  const t = ctx.currentTime;
  thump(t, rand(80, 110), 0.2, 0.13);
  puff(t, 0.12, 0.015, 0.16, 1800, 800);
  const f = 523.25 * Math.pow(2, (PENTA[Math.floor(Math.random() * PENTA.length)] + 12) / 12);
  tone('sine', t + 0.025, f, f, 0.03, 0.004, 0.2, 4500);
}

// Quiet contented coo while petting: soft sine with an up-then-down glide on a pentatonic note, plus a tiny breath.
export function petChirp(pitch = 300) {
  if (!claim(0.3)) return;
  const t = ctx.currentTime;
  const f = clamp(quantize(pitch) * 2, 300, 1200), dur = rand(0.16, 0.24);
  const g = chain(t, 0.028, 0.03, dur, 3000);
  const o = osc('sine', t, t + dur + 0.05, g);
  o.frequency.setValueAtTime(f * 0.93, t);
  o.frequency.exponentialRampToValueAtTime(f * 1.07, t + dur * 0.4);
  o.frequency.exponentialRampToValueAtTime(f * 0.96, t + dur * 0.95);
  puff(t, 0.012, 0.02, 0.1, 2200, 900);
}

const NOOP_STRETCH = { set() {}, stop() {} };

// Wool / fabric stretching: band-passed rustle plus a very quiet low creak, both following amount (0..1).
export function startStretch() {
  if (!ctx || voices >= MAX_VOICES) return NOOP_STRETCH;
  voices++;
  const t = ctx.currentTime;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.value = 450;
  const amp = ctx.createGain(); amp.gain.value = 0.75; // fibre flutter target
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.012, t + 0.08);
  const src = noiseSrc(t);
  src.connect(bp); bp.connect(amp); amp.connect(g); g.connect(bus);
  const flutter = ctx.createOscillator(); flutter.frequency.value = rand(6, 9);
  const fd = ctx.createGain(); fd.gain.value = 0.25;
  flutter.connect(fd); fd.connect(amp.gain); flutter.start(t);

  const creakLp = ctx.createBiquadFilter(); creakLp.type = 'lowpass'; creakLp.Q.value = 2; creakLp.frequency.value = 280;
  const cg = ctx.createGain(); cg.gain.setValueAtTime(0.0001, t); cg.gain.linearRampToValueAtTime(0.003, t + 0.1);
  const creak = ctx.createOscillator(); creak.type = 'sawtooth'; creak.frequency.value = 55;
  creak.connect(creakLp); creakLp.connect(cg); cg.connect(bus); creak.start(t);

  let amount = 0, done = false;
  const jitter = setInterval(() => {
    if (done) return;
    creak.frequency.setTargetAtTime((55 + 40 * amount) * (1 + rand(-0.08, 0.08)), ctx.currentTime, 0.05);
  }, 80);
  return {
    set(a) {
      if (done) return;
      amount = clamp(a, 0, 1);
      const now = ctx.currentTime;
      bp.frequency.setTargetAtTime(450 * Math.pow(4, amount), now, 0.06);
      g.gain.setTargetAtTime(0.012 + 0.07 * amount, now, 0.06);
      cg.gain.setTargetAtTime(0.003 + 0.012 * amount, now, 0.06);
    },
    stop() {
      if (done) return;
      done = true; clearInterval(jitter);
      const now = ctx.currentTime;
      for (const x of [g, cg]) { x.gain.cancelScheduledValues(now); x.gain.setTargetAtTime(0.0001, now, 0.05); }
      src.stop(now + 0.35); flutter.stop(now + 0.35); creak.stop(now + 0.35);
      setTimeout(() => {
        for (const n of [src, bp, amp, g, flutter, fd, creak, creakLp, cg]) n.disconnect();
        voices--;
      }, 450);
    },
  };
}

// Cat purr while being petted: ~25 Hz amplitude-modulated low-passed noise plus a soft 50 Hz hum, breathing every 1.6 s.
export function startPurr() {
  if (!ctx || voices >= MAX_VOICES) return NOOP_STRETCH;
  voices++;
  const t = ctx.currentTime;
  const PEAK = 0.2;
  const level = ctx.createGain(); level.gain.value = 0.0001; // set() target
  const breath = ctx.createGain(); breath.gain.value = 0.65; // in-breath peak, out-breath dip
  const breathLfo = ctx.createOscillator(); breathLfo.frequency.value = 1 / 1.6;
  const breathDepth = ctx.createGain(); breathDepth.gain.value = 0.35;
  breathLfo.connect(breathDepth); breathDepth.connect(breath.gain);

  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150; lp.Q.value = 0.7;
  const rumble = ctx.createGain(); rumble.gain.value = 5; // makeup for the narrow low-pass
  const amp = ctx.createGain(); amp.gain.value = 0.55;
  const am = ctx.createOscillator(); am.frequency.value = 25;
  const amDepth = ctx.createGain(); amDepth.gain.value = 0.45;
  const wobble = ctx.createOscillator(); wobble.frequency.value = 0.9;
  const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 1.5; // Hz of rate wobble
  am.connect(amDepth); amDepth.connect(amp.gain);
  wobble.connect(wobbleDepth); wobbleDepth.connect(am.frequency);
  const src = noiseSrc(t);
  src.connect(lp); lp.connect(rumble); rumble.connect(amp); amp.connect(breath);

  const hum = ctx.createOscillator(); hum.frequency.value = 50;
  const humGain = ctx.createGain(); humGain.gain.value = 0.35;
  hum.connect(humGain); humGain.connect(breath);

  breath.connect(level); level.connect(bus);
  for (const o of [breathLfo, am, wobble, hum]) o.start(t);

  let amount = 0, done = false;
  return {
    set(a) {
      if (done) return;
      a = clamp(a, 0, 1);
      if (Math.abs(a - amount) < 0.002) return;
      amount = a;
      level.gain.setTargetAtTime(0.0001 + PEAK * a, ctx.currentTime, 0.08);
    },
    stop() {
      if (done) return;
      done = true;
      const now = ctx.currentTime;
      level.gain.cancelScheduledValues(now);
      level.gain.setTargetAtTime(0.0001, now, 0.1);
      for (const n of [src, breathLfo, am, wobble, hum]) n.stop(now + 0.45);
      setTimeout(() => {
        for (const n of [src, lp, rumble, amp, am, amDepth, wobble, wobbleDepth, breathLfo, breathDepth, breath, hum, humGain, level]) n.disconnect();
        voices--;
      }, 550);
    },
  };
}

// Basket rustle: a longer filtered noise swish plus 3-5 soft staggered thumps.
export function shakeSound() {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  if (claim(0.9)) {
    const dur = 0.75;
    const g = chain(t0, 0.16, 0.25, dur, 2200);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(700, t0);
    bp.frequency.exponentialRampToValueAtTime(1800, t0 + 0.3);
    bp.frequency.exponentialRampToValueAtTime(900, t0 + dur);
    noiseSrc(t0, dur + 0.05).connect(bp); bp.connect(g);
  }
  const count = 3 + Math.floor(Math.random() * 3);
  let t = t0 + 0.03;
  for (let i = 0; i < count; i++, t += rand(0.07, 0.16)) {
    if (!claim(0.3)) break;
    thump(t, rand(80, 130), rand(0.12, 0.2), 0.15);
    puff(t, 0.05, 0.01, 0.09, 700, 400);
  }
}
