import { bus } from '../core/bus.js';
import { makeCanvas, toBlob } from '../core/util.js';
import { flatten } from './compositor.js';
import { encodeGIF } from './gif.js';
import { zip } from './zip.js';

export const DIRECTIONS = [['forward', 'Forward'], ['reverse', 'Reverse'], ['pingpong', 'Ping-pong']];

// Plays the document's frames with per-frame durations over the whole timeline or one tag.
export class Player {
  constructor(app) { Object.assign(this, { app, playing: false, tag: -1, dir: 1, speed: 1 }); }
  get doc() { return this.app.doc; }
  range() {
    const d = this.doc, t = d.tags[this.tag];
    return t ? [t.from, t.to, t.dir] : [0, d.frames.length - 1, this.app.opts.playDir ?? 'forward'];
  }
  toggle() { this.playing ? this.stop() : this.play(); }
  play() {
    if (this.doc.frames.length < 2) return;
    this.playing = true;
    this.dir = this.range()[2] === 'reverse' ? -1 : 1;
    bus.emit('play', true);
    this.timer = setTimeout(() => this.tick(), this.doc.frames[this.doc.frame].duration / this.speed);
  }
  stop() { clearTimeout(this.timer); if (this.playing) { this.playing = false; bus.emit('play', false); } }
  tick() {
    const d = this.doc, [a, b, mode] = this.range();
    let f = d.frame, n = f + this.dir;
    if (f < a || f > b) n = this.dir > 0 ? a : b;
    else if (n > b || n < a) {
      if (mode === 'pingpong' && a !== b) { this.dir = -this.dir; n = f + this.dir; }
      else n = this.dir > 0 ? a : b;
    }
    d.setFrame(n);
    this.timer = setTimeout(() => this.tick(), d.frames[n].duration / this.speed);
  }
  step(k) { this.stop(); const d = this.doc; d.setFrame((d.frame + k + d.frames.length) % d.frames.length); }
}

// Rendered, optionally scaled frames of the doc for export.
export function renderFrames(doc, from, to, scale = 1) {
  const out = [];
  for (let f = from; f <= to; f++) {
    const src = flatten(doc, f), c = makeCanvas(Math.max(1, Math.round(doc.w * scale)), Math.max(1, Math.round(doc.h * scale))), ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = scale < 1 || !Number.isInteger(scale);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    out.push({ canvas: c, duration: doc.frames[f].duration });
  }
  return out;
}

export const exportGIF = frames => encodeGIF(frames.map(f => f.canvas.getContext('2d').getImageData(0, 0, f.canvas.width, f.canvas.height)), frames.map(f => f.duration));

export async function exportPNGSequence(frames, name) {
  return zip(await Promise.all(frames.map(async (f, i) => ({ name: `${name}_${String(i).padStart(3, '0')}.png`, data: await toBlob(f.canvas) }))), 'application/zip');
}

// Sprite sheet PNG + Aseprite-compatible JSON (hash format with frameTags), zipped together.
export async function exportSpriteSheet(frames, name, layout, tags, from) {
  const n = frames.length, fw = frames[0].canvas.width, fh = frames[0].canvas.height;
  const cols = layout === 'vertical' ? 1 : layout === 'grid' ? Math.ceil(Math.sqrt(n)) : n, rows = Math.ceil(n / cols);
  const sheet = makeCanvas(cols * fw, rows * fh), ctx = sheet.getContext('2d'), json = { frames: {}, meta: {} };
  frames.forEach((f, i) => {
    const x = (i % cols) * fw, y = Math.floor(i / cols) * fh;
    ctx.drawImage(f.canvas, x, y);
    json.frames[`${name} ${i}.png`] = { frame: { x, y, w: fw, h: fh }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh }, duration: f.duration };
  });
  json.meta = {
    app: 'https://pixelpaint.net', version: '1', image: `${name}.png`, format: 'RGBA8888', size: { w: sheet.width, h: sheet.height }, scale: '1',
    frameTags: tags.filter(t => t.from >= from && t.to < from + n).map(t => ({ name: t.name, from: t.from - from, to: t.to - from, direction: t.dir })),
  };
  return zip([{ name: `${name}.png`, data: await toBlob(sheet) }, { name: `${name}.json`, data: JSON.stringify(json, null, 1) }], 'application/zip');
}

// Real-time capture through MediaRecorder (WebM); takes as long as the animation plays.
export function exportVideo(frames, loops = 1) {
  return new Promise((res, rej) => {
    const c = makeCanvas(frames[0].canvas.width, frames[0].canvas.height), ctx = c.getContext('2d');
    const stream = c.captureStream(30), chunks = [];
    const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    if (!type) return rej(new Error('Video recording is not supported in this browser'));
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => res(new Blob(chunks, { type: type.split(';')[0] }));
    rec.start();
    let i = 0;
    const next = () => {
      if (i >= frames.length * loops) return rec.stop();
      const f = frames[i++ % frames.length];
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(f.canvas, 0, 0);
      setTimeout(next, f.duration);
    };
    next();
  });
}
