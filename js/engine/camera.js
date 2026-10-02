// Camera folders: a folder whose direct children are planes seen through an animated camera.
// The camera pans, zooms, rotates, shakes and dollies; with Multiplane on, each child sits at a
// depth and moves less the farther away it is (parallax) — optionally also shrinking with distance.
// It's all applied when compositing (the drawings themselves never change), so the stage can show
// the flat drawing for painting or the camera's view for previewing, and exports use the camera.
//
// group.camera = { view, multiplane, depthScale, ease, x, y, zoom, rot, dolly, shake, keys: [{ f, x, y, zoom, rot, dolly, shake }] }
// child.depth  = distance from the camera (FOCUS = moves 1:1 with the camera; bigger = farther)
export const FOCUS = 100;
export const PROPS = ['x', 'y', 'zoom', 'rot', 'dolly', 'shake'];
export const EASES = [['smooth', 'Smooth'], ['linear', 'Linear'], ['step', 'Stepped']];

export function newCamera(doc) {
  return { view: true, multiplane: true, depthScale: false, ease: 'smooth', x: doc.w / 2, y: doc.h / 2, zoom: 1, rot: 0, dolly: 0, shake: 0, keys: [] };
}
// Depths for a folder's children when it becomes a camera folder: the bottom one far back, the top
// one at the focus plane (moves with the camera).
export const defaultDepths = n => Array.from({ length: n }, (_, i) => Math.round(n < 2 ? FOCUS : 400 - (400 - FOCUS) * i / (n - 1)));

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t, kind) => (kind === 'step' ? 0 : kind === 'linear' ? t : t * t * (3 - 2 * t));
// The camera at frame f: its keys tweened (or its fixed settings when it has none).
export function camAt(cam, f) {
  const base = Object.fromEntries(PROPS.map(k => [k, cam[k] ?? 0]));
  const keys = cam.keys ?? [];
  if (!keys.length) return base;
  let i = keys.findIndex(k => k.f > f);
  if (i === 0) return { ...base, ...pick(keys[0]) };
  if (i < 0) return { ...base, ...pick(keys.at(-1)) };
  const a = keys[i - 1], b = keys[i], t = ease((f - a.f) / (b.f - a.f), cam.ease);
  return Object.fromEntries(PROPS.map(k => [k, lerp(a[k] ?? base[k], b[k] ?? base[k], t)]));
}
const pick = k => Object.fromEntries(PROPS.filter(p => k[p] != null).map(p => [p, k[p]]));
export const keyAt = (cam, f) => (cam.keys ?? []).find(k => k.f === f);
// The camera with frame f's settings stored as a key (added or updated), keys kept in order.
export function withKey(cam, f, at = camAt(cam, f)) {
  const keys = (cam.keys ?? []).filter(k => k.f !== f).concat({ f, ...Object.fromEntries(PROPS.map(p => [p, at[p]])) }).sort((a, b) => a.f - b.f);
  return { ...cam, keys };
}
export const withoutKey = (cam, f) => ({ ...cam, keys: (cam.keys ?? []).filter(k => k.f !== f) });
// A setting changed at frame f: keyed cameras record it as a key there; unkeyed ones just change.
export function edited(cam, f, patch) {
  if (!(cam.keys ?? []).length) return { ...cam, ...patch };
  return withKey(cam, f, { ...camAt(cam, f), ...patch });
}

const noise = t => Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.1 + 1.3) * 0.3 + Math.sin(t * 7.3 + 2.1) * 0.2;   // smooth, repeatable wobble
// How a plane at `depth` maps to the frame at camera settings `at`: [a, b, c, d, e, f] for setTransform.
export function planeMatrix(w, h, cam, at, depth, f = 0) {
  const cx = w / 2, cy = h / 2;
  const z = cam.multiplane ? depth ?? FOCUS : FOCUS;
  const k = FOCUS / Math.max(10, z - (at.dolly ?? 0));                       // parallax: far planes move less
  const s = at.zoom * (cam.multiplane && cam.depthScale ? k : FOCUS / Math.max(10, FOCUS - (at.dolly ?? 0)));
  const shx = at.shake ? noise(f * 0.9) * at.shake : 0, shy = at.shake ? noise(f * 1.13 + 7) * at.shake : 0;
  const tx = -k * at.zoom * (at.x - cx) + shx, ty = -k * at.zoom * (at.y - cy) + shy;
  const r = (at.rot ?? 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  const u0 = tx - s * cx, v0 = ty - s * cy;
  return [s * cs, s * sn, -s * sn, s * cs, cx + cs * u0 - sn * v0, cy + sn * u0 + cs * v0];
}

// The camera folders in a document (top-level first).
export function* cameras(doc) { for (const n of doc.nodes()) if (n.type === 'group' && n.camera) yield n; }
// Whether the stage is looking through a camera right now (then painting is paused; dragging moves the camera).
export const cameraView = doc => { for (const g of cameras(doc)) if (g.visible && g.camera.view) return g; return null; };
// The camera folder a node belongs to, if any (itself, or its nearest camera ancestor).
export function cameraFor(doc, node) {
  for (let n = node; n && n !== doc.root; n = doc.parentOf(n)) if (n.type === 'group' && n.camera) return n;
  return null;
}
// The direct child of camera folder g that contains node (its plane).
export function planeOf(doc, g, node) {
  for (let n = node; n && n !== doc.root; n = doc.parentOf(n)) if (doc.parentOf(n) === g) return n;
  return null;
}

// The camera frame on the flat drawing: the area of the focus plane the camera sees (4 corners).
export function frameCorners(w, h, cam, at, f = 0) {
  const [a, b, c, d, e, ff] = planeMatrix(w, h, { ...cam, multiplane: false, depthScale: false }, at, FOCUS, f);
  const det = a * d - b * c, inv = (x, y) => [(d * (x - e) - c * (y - ff)) / det, (-b * (x - e) + a * (y - ff)) / det];
  return [inv(0, 0), inv(w, 0), inv(w, h), inv(0, h)];
}
