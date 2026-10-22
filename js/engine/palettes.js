// Built-in palettes plus parsers for common palette files (GIMP .gpl, JASC .pal, .hex lists).
export const PALETTES = {
  'PixelPaint': ['#000000', '#3c3f47', '#8c93a5', '#ffffff', '#ff3b47', '#ff8a3d', '#ffd23f', '#9be15d', '#17c06b', '#1fb5a8',
    '#84cee0', '#3b7bff', '#5b4bff', '#a445ff', '#ff5fa2', '#7a4a2e', '#c89f7c', '#f5deb3', '#2e4a7a', '#233d2b'],
  'Pyxl': ['#c8413c', '#e8c33a', '#2f9a88', '#3d78d8', '#4a3a3f', '#f6e2cf', '#26212a', '#8a5a3c', '#ffffff', '#9bd0c6'],
  'DawnBringer 32': ['#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a', '#fbf236', '#99e550', '#6abe30',
    '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74', '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7',
    '#847e87', '#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30'],
  'PICO-8': ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27',
    '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  'Game Boy': ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  'Skin tones': ['#ffe0c7', '#f6c9a6', '#e8b08a', '#d2956b', '#b67651', '#8d5a3b', '#6a4029', '#46291a'],
};

const hex2 = v => (+v).toString(16).padStart(2, '0');
export function parsePalette(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const hex = line.match(/^\s*#?([0-9a-f]{6})\b/i);
    const rgb = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/);
    if (hex) out.push(`#${hex[1].toLowerCase()}`);
    else if (rgb) out.push(`#${hex2(rgb[1])}${hex2(rgb[2])}${hex2(rgb[3])}`);
  }
  return [...new Set(out)];
}

// Maps every visible pixel of an ImageData to the nearest palette colour, in place. Distance is
// measured in OKLab, where equal steps look equally different (plain RGB distance sends a near-black
// blue to dark green). Alpha is kept; each distinct colour is looked up once.
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export function oklab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function snapToPalette(img, colors) {
  const pal = colors.map(c => { const rgb = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); return { rgb, lab: oklab(...rgb) }; });
  if (!pal.length) return img;
  const d = img.data, memo = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let best = memo.get(key);
    if (!best) {
      const [L, A, B] = oklab(d[i], d[i + 1], d[i + 2]);
      let bd = Infinity;
      for (const p of pal) { const dist = (L - p.lab[0]) ** 2 + (A - p.lab[1]) ** 2 + (B - p.lab[2]) ** 2; if (dist < bd) { bd = dist; best = p.rgb; } }
      memo.set(key, best);
    }
    d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2];
  }
  return img;
}
