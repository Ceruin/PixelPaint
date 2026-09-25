export const hexToRgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const rgbToHex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);

export function hsvToRgb(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  const h = d === 0 ? 0 : v === r ? ((g - b) / d + 6) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, v ? d / v : 0, v];
}

// Little-endian RGBA packed for Uint32Array views of ImageData.
export const hexToU32 = hex => { const [r, g, b] = hexToRgb(hex); return (0xff000000 | b << 16 | g << 8 | r) >>> 0; };
