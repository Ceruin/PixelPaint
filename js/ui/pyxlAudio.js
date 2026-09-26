// Pyxl's radio: endless lofi made on the spot with WebAudio — warm electric-piano chords, a round
// bass, soft swung drums, a lazy pentatonic melody and vinyl crackle, all under a tape-warm filter.
// Every track is a recipe (tempo, key, chords, groove), so nothing is downloaded. Plus a few toy sounds.

import { local } from '../core/storage.js';

const CHORDS = { maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], sus: [0, 5, 7, 10] };
// name, bpm, key (MIDI of the chord root), chords [semitones above the key, quality], kick / snare patterns (16 steps), swing
const TRACKS = [
  ['Rainy Window', 72, 53, [[2, 'm9'], [7, 'dom7'], [0, 'maj7'], [9, 'm7']], 'x.........x.....', '....x.......x...', 0.55],
  ['Sketchbook', 80, 55, [[0, 'maj7'], [4, 'm7'], [5, 'maj9'], [7, 'sus']], 'x......x..x.....', '....x.......x..x', 0.5],
  ['Night Bus', 68, 50, [[0, 'm9'], [5, 'm7'], [10, 'dom7'], [3, 'maj7']], 'x.......x.x.....', '....x.......x...', 0.6],
  ['Pixel Garden', 86, 57, [[5, 'maj7'], [4, 'm7'], [2, 'm9'], [0, 'maj9']], 'x...x.....x.....', '....x.......x...', 0.45],
  ['Sleepy Cat', 64, 52, [[0, 'maj9'], [9, 'm7'], [5, 'maj7'], [7, 'sus']], 'x.........x..x..', '....x.......x...', 0.6],
  ['Coffee & Ink', 76, 48, [[9, 'm9'], [2, 'm7'], [7, 'dom7'], [0, 'maj7']], 'x......x.x......', '....x.......x...', 0.5],
  ['Last Train', 70, 51, [[0, 'm7'], [8, 'maj7'], [3, 'maj9'], [10, 'dom7']], 'x.........x.....', '....x..x....x...', 0.55],
];
const PENTA = [0, 2, 4, 7, 9];
const hz = m => 440 * 2 ** ((m - 69) / 12);

let ctx, master, crackle, timer, noise, lfo;
const state = { on: false, index: 0, volume: local.get('pp.pyxlVolume', 0.6) };

function audio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 2600; warm.Q.value = 0.4;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
  master = ctx.createGain(); master.gain.value = 0;
  master.connect(warm).connect(comp).connect(ctx.destination);
  // one second of white noise, shared by the drums, the crackle and the TV
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // tape wow: every chord voice drifts a few cents together
  lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
  const depth = ctx.createGain(); depth.gain.value = 7; lfo.connect(depth); lfo.start();
  lfo.out = depth;
  return ctx;
}

// Vinyl: a quiet hiss with sparse pops, looped.
function vinyl() {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.012 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.6 : 0);
  const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = b; src.loop = true; hp.type = 'highpass'; hp.frequency.value = 900; g.gain.value = 0.5;
  src.connect(hp).connect(g).connect(master); src.start();
  return src;
}

const env = (g, t, a, peak, dec, end = 0.0001) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(end, t + a + dec); };

function keys(m, t, len, vel = 0.06) {
  const g = ctx.createGain(), a = ctx.createOscillator(), b = ctx.createOscillator(), bg = ctx.createGain();
  a.type = 'sine'; b.type = 'triangle'; a.frequency.value = hz(m); b.frequency.value = hz(m) * 2; bg.gain.value = 0.18;
  lfo.out.connect(a.detune); lfo.out.connect(b.detune);
  a.connect(g); b.connect(bg).connect(g); g.connect(master);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + 0.02); g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  a.onended = () => { lfo.out.disconnect(a.detune); lfo.out.disconnect(b.detune); };
  a.start(t); b.start(t); a.stop(t + len + 0.05); b.stop(t + len + 0.05);
}
function bass(m, t, len) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = hz(m); o.connect(g).connect(master);
  env(g, t, 0.02, 0.22, len);
  o.start(t); o.stop(t + len + 0.05);
}
function kick(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  o.connect(g).connect(master); env(g, t, 0.004, 0.5, 0.28);
  o.start(t); o.stop(t + 0.35);
}
function hiss(t, type, f, peak, dec, q = 0.8, out = master) {
  const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  s.connect(fl).connect(g).connect(out); env(g, t, 0.003, peak, dec);
  s.start(t, Math.random() * 0.5); s.stop(t + dec + 0.05);
}
const snare = t => hiss(t, 'bandpass', 1700, 0.16, 0.2, 0.6);
const hat = (t, v = 0.035) => hiss(t, 'highpass', 7000, v, 0.04);

// A tiny seeded random, so each track's melody is its own (and repeats like a real loop).
const rng = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function melody(track) {
  const r = rng(track[2] * 97 + track[1]), out = [];
  for (let bar = 0; bar < 4; bar++) for (let st = 0; st < 16; st += 2) {
    if (r() < (st % 8 === 0 ? 0.55 : 0.28)) out.push([bar * 16 + st, track[2] + 12 + PENTA[Math.floor(r() * 5)] + (r() < 0.25 ? 12 : 0), 2 + Math.floor(r() * 3) * 2]);
  }
  return out;
}

function start(i) {
  audio();
  ctx.resume?.();
  clearInterval(timer);
  const tr = TRACKS[i], [, bpm, key, prog, kp, sp, swing] = tr, step = 60 / bpm / 4, mel = melody(tr);
  let n = 0, next = ctx.currentTime + 0.1;
  timer = setInterval(() => {
    while (next < ctx.currentTime + 0.25) {
      const s = n % 16, bar = Math.floor(n / 16), t = next + (s % 2 ? swing * step * 0.5 : 0), [deg, q] = prog[bar % prog.length];
      if (s === 0) CHORDS[q].forEach((iv, j) => keys(key + deg + iv, t + j * 0.018, step * 15.5));
      if (s === 0 || s === 8) bass(key + deg - 12, t, step * 6);
      if (s === 14 && bar % 2) bass(key + prog[(bar + 1) % prog.length][0] - 13, t, step * 2);
      if (kp[s] === 'x') kick(t);
      if (sp[s] === 'x') snare(t);
      if (s % 2 === 0) hat(t, s % 4 ? 0.022 : 0.035);
      if (bar >= 2) for (const [at, m, len] of mel) if (at === n % 64) keys(m, t, step * len, 0.045);
      n++; next += step;
    }
  }, 60);
  crackle ??= vinyl();
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(0.9 * state.volume, ctx.currentTime, 0.4);
}

export const radio = {
  tracks: TRACKS.map(t => t[0]),
  get on() { return state.on; },
  get index() { return state.index; },
  get name() { return TRACKS[state.index][0]; },
  // One volume for the radio and every toy and game sound (0 mutes them all).
  get volume() { return state.volume; },
  setVolume(v) {
    state.volume = Math.max(0, Math.min(1, v)); local.set('pp.pyxlVolume', state.volume);
    if (state.on) master.gain.setTargetAtTime(0.9 * state.volume, ctx.currentTime, 0.05);
  },
  play(i = state.index) { state.index = (i + TRACKS.length) % TRACKS.length; state.on = true; start(state.index); },
  next(d = 1) { this.play(state.index + d); },
  stop() {
    if (!state.on) return;
    state.on = false; clearInterval(timer);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => { if (!state.on) { crackle?.stop(); crackle = null; ctx.suspend?.(); } }, 900);
  },
};

// Little sound effects for her toys and games.
export function sfx(name) {
  if (!state.volume) return;
  audio(); ctx.resume?.();
  const t = ctx.currentTime + 0.01, out = ctx.createGain();
  out.gain.value = state.volume * 1.4; out.connect(ctx.destination);
  const beep = (f, at, len, type = 'square', v = 0.04) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, at);
    o.connect(g).connect(out); env(g, at, 0.005, v, len); o.start(at); o.stop(at + len + 0.05);
    return o;
  };
  if (name === 'tv') {   // switching on: a burst of static, then a flat, tired jingle
    hiss(t, 'bandpass', 3000, 0.12, 0.7, 0.3, out);
    [523, 494, 440, 392].forEach((f, i) => beep(f, t + 0.75 + i * 0.16, 0.14));
  } else if (name === 'pop') beep(880, t, 0.08, 'sine', 0.12).frequency.exponentialRampToValueAtTime(1760, t + 0.08);
  else if (name === 'boing') { const o = beep(300, t, 0.16, 'sine', 0.07); o.frequency.exponentialRampToValueAtTime(620, t + 0.05); o.frequency.exponentialRampToValueAtTime(380, t + 0.16); }
  else if (name === 'bonk') beep(220, t, 0.12, 'triangle', 0.14).frequency.exponentialRampToValueAtTime(90, t + 0.12);
  else if (name === 'draw') beep(1200, t, 0.18, 'sine', 0.05).frequency.exponentialRampToValueAtTime(2400, t + 0.18);
  else if (name === 'win') [523, 659, 784, 1047].forEach((f, i) => beep(f, t + i * 0.1, 0.16, 'triangle', 0.08));
  else if (name === 'chime') [784, 1047].forEach((f, i) => beep(f, t + i * 0.14, 0.4, 'sine', 0.08));
}
