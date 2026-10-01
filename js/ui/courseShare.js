import { idb } from '../core/storage.js';
import { normalizeCourse } from './raceCourse.js';

// Your race courses: kept on this device (IndexedDB), and shared as a .course file or as a link
// that carries the whole course in its #hash (deflated + base64url — nothing is uploaded anywhere).
export const COURSE_FORMAT = 'pixelpaint-course';
const KEY = 'pyxl-courses', LINK_MAX = 7000;   // longer links get cut off by some apps: send a file then
const uid = () => Math.random().toString(36).slice(2, 10);

export const listCourses = async () => (await idb.get(KEY).catch(() => null)) ?? [];
export async function saveCourse(course, id = null) {
  const all = await listCourses(), at = all.findIndex(e => e.id === id), entry = { id: id ?? uid(), saved: Date.now(), course: normalizeCourse(course) };
  if (at >= 0) all[at] = entry; else all.unshift(entry);
  await idb.set(KEY, all);
  return entry.id;
}
export async function deleteCourse(id) { await idb.set(KEY, (await listCourses()).filter(e => e.id !== id)); }

// ---------------------------------------------------------------- .course files
export const courseFile = course => new Blob([JSON.stringify({ format: COURSE_FORMAT, ...normalizeCourse(course) })], { type: 'application/json' });
export const fileName = course => `${(course.name || 'course').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'course'}.course`;
export function readCourseFile(text) {
  let data; try { data = JSON.parse(text); } catch { return null; }
  return data?.format === COURSE_FORMAT ? normalizeCourse(data) : null;
}

// ---------------------------------------------------------------- links
const b64url = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

// The course as a share link, or null if it's too big for one (share the file instead).
export async function courseLink(course) {
  const c = normalizeCourse(course), packed = [c.v, c.name, c.w, c.h, c.segs.flat(), c.water.flat(), c.hazards.flat(), c.takes.flat(), c.start, c.finish];
  const data = b64url(await pipe(new TextEncoder().encode(JSON.stringify(packed)), new CompressionStream('deflate-raw')));
  const url = `${location.origin}${location.pathname}#course=${data}`;
  return url.length > LINK_MAX ? null : url;
}
const groups = (a, n) => (Array.isArray(a) ? Array.from({ length: Math.floor(a.length / n) }, (_, i) => a.slice(i * n, i * n + n)) : []);
export async function readCourseLink(hash = location.hash) {
  const m = /^#course=([\w-]+)$/.exec(hash);
  if (!m) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(await pipe(unb64url(m[1]), new DecompressionStream('deflate-raw'))));
    if (!Array.isArray(p)) return null;
    const [v, name, w, h, segs, water, hazards, takes, start, finish] = p;
    return normalizeCourse({ v, name, w, h, segs: groups(segs, 4), water: groups(water, 4), hazards: groups(hazards, 4), takes: groups(takes, 2), start, finish });
  } catch { return null; }
}
